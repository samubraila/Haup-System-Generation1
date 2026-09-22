from __future__ import annotations

import json
import logging
import os
import subprocess
from typing import Any

from acfworker import JobContext, PermanentJobError, WaitingForGpu, detect_gpu, run_worker

from .adapters.base import AdapterUnavailable, GenerationRequest
from .adapters.comfyui import ComfyUiAdapter
from .adapters.ltx import LtxAdapter
from .adapters.placeholder import PlaceholderAdapter
from .adapters.wan import WanAdapter

QUEUE = "video"

ADAPTERS = {
    "ltx": LtxAdapter,
    "wan": WanAdapter,
    "comfyui": ComfyUiAdapter,
    "placeholder": PlaceholderAdapter,
}

_state: dict[str, Any] = {"config": None, "adapters": {}, "default": "placeholder"}


def _probe_video(path: str) -> dict[str, Any]:
    try:
        output = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        ).stdout
        data = json.loads(output)
    except (subprocess.SubprocessError, json.JSONDecodeError, OSError):
        return {}

    video_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    return {
        "durationMs": int(float(data.get("format", {}).get("duration", 0)) * 1000),
        "width": video_stream.get("width"),
        "height": video_stream.get("height"),
        "sizeBytes": int(data.get("format", {}).get("size", 0)),
    }


def on_start(config: Any, logger: logging.Logger) -> dict[str, Any]:
    _state["config"] = config
    default_provider = os.environ.get("VIDEO_GENERATOR_PROVIDER", "placeholder")
    _state["default"] = default_provider if default_provider in ADAPTERS else "placeholder"

    gpu = detect_gpu(config.gpu_min_vram_mb)
    adapters_info: dict[str, Any] = {}

    for name, adapter_class in ADAPTERS.items():
        adapter = adapter_class()
        _state["adapters"][name] = adapter
        try:
            adapters_info[name] = adapter.prepare(config, logger)
        except Exception as exc:  # noqa: BLE001
            adapters_info[name] = {"adapter": name, "error": str(exc)}

    logger.info(
        "Video-Worker bereit",
        extra={"extra": {"gpu": gpu.to_dict(), "defaultProvider": _state["default"]}},
    )

    return {
        "gpu": gpu.to_dict(),
        "gpuMode": config.gpu_mode,
        "defaultProvider": _state["default"],
        "adapters": adapters_info,
    }


def handle(ctx: JobContext) -> dict[str, Any]:
    data = ctx.data
    config = ctx.config

    provider = str(data.get("provider") or _state["default"])
    adapter = _state["adapters"].get(provider)
    if adapter is None:
        raise PermanentJobError(f"Unbekannter Video-Adapter: {provider}")

    project_id = str(data.get("projectId") or "")
    video_id = str(data.get("videoId") or "")
    if not project_id or not video_id:
        raise PermanentJobError("projectId oder videoId fehlt im Auftrag")

    gpu = detect_gpu(config.gpu_min_vram_mb)
    needs_gpu = adapter.requires_gpu or config.gpu_mode == "force"

    if needs_gpu and not gpu.available:
        if config.gpu_mode == "off":
            raise PermanentJobError(
                "GPU_MODE=off, aber der gewaehlte Adapter braucht eine GPU. "
                "Setze VIDEO_GENERATOR_PROVIDER auf comfyui oder placeholder."
            )
        raise WaitingForGpu(
            gpu.reason or "Keine passende GPU verfuegbar",
            config.gpu_recheck_sec * 1000,
        )

    prompt = str(data.get("prompt") or "")
    if not prompt:
        raise PermanentJobError("Der Prompt ist leer")

    scene_index = int(data.get("sceneIndex") or 0)
    work_dir = ctx.storage.create_temp_dir(f"video-{video_id[:8]}")
    output_name = f"{video_id}-scene-{scene_index:02d}.mp4"
    output_path = os.path.join(work_dir, output_name)

    request = GenerationRequest(
        prompt=prompt,
        negative_prompt=str(data.get("negativePrompt") or ""),
        width=int(data.get("width") or 768),
        height=int(data.get("height") or 1344),
        fps=int(data.get("fps") or 24),
        duration_sec=float(data.get("durationSec") or 5),
        seed=int(data["seed"]) if data.get("seed") is not None else None,
        steps=int(data.get("steps") or 30),
        guidance_scale=float(data.get("guidanceScale") or 3.5),
        init_image_path=None,
        scene_index=scene_index,
        scene_count=int(data.get("sceneCount") or 1),
        output_path=output_path,
    )

    try:
        if data.get("initImagePath"):
            request.init_image_path = ctx.storage.pull(str(data["initImagePath"]), work_dir)

        ctx.report_progress(5, f"Adapter {provider} startet")

        try:
            adapter.generate(request, lambda value, message=None: ctx.report_progress(value, message), ctx.logger)
        except AdapterUnavailable as exc:
            raise PermanentJobError(str(exc)) from exc

        if not os.path.isfile(output_path) or os.path.getsize(output_path) == 0:
            raise RuntimeError("Der Adapter hat keine verwertbare Videodatei erzeugt")

        info = _probe_video(output_path)
        storage_path = ctx.storage.project_path(project_id, "videos", output_name)
        ctx.storage.push(output_path, storage_path, "video/mp4")

        media = ctx.api.register_media(
            {
                "projectId": project_id,
                "videoId": video_id,
                "kind": "video",
                "path": storage_path,
                "fileName": output_name,
                "mimeType": "video/mp4",
                "sizeBytes": info.get("sizeBytes") or os.path.getsize(output_path),
                "durationMs": info.get("durationMs"),
                "width": info.get("width"),
                "height": info.get("height"),
                "meta": {
                    "stage": "ai",
                    "sceneIndex": scene_index,
                    "provider": provider,
                    "producesAiVideo": adapter.produces_ai_video,
                    "prompt": request.prompt[:500],
                    "gpu": gpu.name,
                },
            }
        )

        return {
            "mediaId": media.get("id"),
            "path": storage_path,
            "sceneIndex": scene_index,
            "provider": provider,
            "producesAiVideo": adapter.produces_ai_video,
        }
    finally:
        ctx.storage.remove_temp_dir(work_dir)


def main() -> None:
    run_worker(
        name="video-worker",
        queue=QUEUE,
        handler=handle,
        on_start=on_start,
        default_concurrency=1,
    )


if __name__ == "__main__":
    main()
