from __future__ import annotations

import logging
import os
from typing import Any

from acfworker import JobContext, PermanentJobError, WaitingForGpu, detect_gpu, run_worker

QUEUE = "image"

_state: dict[str, Any] = {"pipeline": None, "model_path": "", "model_present": False}


def _model_path(config: Any) -> str:
    configured = os.environ.get("IMAGE_MODEL_PATH", "")
    return configured or os.path.join(config.models_dir, "sdxl")


def on_start(config: Any, logger: logging.Logger) -> dict[str, Any]:
    gpu = detect_gpu(config.gpu_min_vram_mb)
    path = _model_path(config)
    present = os.path.isdir(path) and any(os.scandir(path)) if os.path.isdir(path) else False

    _state["model_path"] = path
    _state["model_present"] = present

    logger.info("Image-Worker bereit", extra={"extra": {"gpu": gpu.to_dict(), "modelPath": path}})

    return {
        "engine": "diffusers",
        "modelPath": path,
        "modelPresent": present,
        "gpu": gpu.to_dict(),
        "note": None if present else f"Kein Bildmodell unter {path}. Anleitung in docs/VIDEO_MODELS.md.",
    }


def _load_pipeline(logger: logging.Logger):
    if _state["pipeline"] is not None:
        return _state["pipeline"]

    try:
        import torch
        from diffusers import AutoPipelineForText2Image
    except ImportError as exc:
        raise PermanentJobError(f"diffusers ist nicht installiert: {exc}") from exc

    if not os.path.isdir(_state["model_path"]):
        raise PermanentJobError(
            f"Bildmodell fehlt unter {_state['model_path']}. Anleitung in docs/VIDEO_MODELS.md."
        )

    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    logger.info("Bildmodell wird geladen", extra={"extra": {"path": _state["model_path"], "dtype": str(dtype)}})

    pipeline = AutoPipelineForText2Image.from_pretrained(_state["model_path"], torch_dtype=dtype)
    pipeline.to("cuda" if torch.cuda.is_available() else "cpu")
    if hasattr(pipeline, "enable_attention_slicing"):
        pipeline.enable_attention_slicing()

    _state["pipeline"] = pipeline
    return pipeline


def handle(ctx: JobContext) -> dict[str, Any]:
    data = ctx.data
    config = ctx.config
    project_id = str(data.get("projectId") or "")
    video_id = data.get("videoId")
    prompts = data.get("prompts") or []

    if not project_id:
        raise PermanentJobError("projectId fehlt im Auftrag")
    if not isinstance(prompts, list) or not prompts:
        raise PermanentJobError("Es wurden keine Prompts uebergeben")

    gpu = detect_gpu(config.gpu_min_vram_mb)
    if not gpu.available and config.gpu_mode != "off":
        raise WaitingForGpu(gpu.reason or "Keine GPU verfuegbar", config.gpu_recheck_sec * 1000)

    import torch

    pipeline = _load_pipeline(ctx.logger)
    work_dir = ctx.storage.create_temp_dir(f"image-{project_id[:8]}")
    results: list[dict[str, Any]] = []

    try:
        width = int(data.get("width") or 1080)
        height = int(data.get("height") or 1920)
        steps = int(data.get("steps") or 28)
        negative = str(data.get("negativePrompt") or "") or None
        seed = data.get("seed")

        for index, prompt in enumerate(prompts):
            ctx.report_progress(
                5 + (index / len(prompts)) * 90,
                f"Bild {index + 1} von {len(prompts)}",
            )

            generator = None
            if seed is not None:
                generator = torch.Generator(device=pipeline.device.type).manual_seed(int(seed) + index)

            output = pipeline(
                prompt=str(prompt),
                negative_prompt=negative,
                width=width,
                height=height,
                num_inference_steps=steps,
                generator=generator,
            )

            file_name = f"{video_id or project_id}-image-{index:02d}.png"
            local_path = os.path.join(work_dir, file_name)
            output.images[0].save(local_path)

            storage_path = ctx.storage.project_path(project_id, "images", file_name)
            ctx.storage.push(local_path, storage_path, "image/png")

            media = ctx.api.register_media(
                {
                    "projectId": project_id,
                    "videoId": video_id,
                    "kind": "image",
                    "path": storage_path,
                    "fileName": file_name,
                    "mimeType": "image/png",
                    "sizeBytes": os.path.getsize(local_path),
                    "width": width,
                    "height": height,
                    "meta": {"stage": "image", "prompt": str(prompt)[:500], "index": index},
                }
            )
            results.append({"mediaId": media.get("id"), "path": storage_path, "index": index})

        ctx.report_progress(100, "Bilder fertig")
        return {"images": results, "count": len(results)}
    finally:
        ctx.storage.remove_temp_dir(work_dir)


def main() -> None:
    run_worker(name="image-worker", queue=QUEUE, handler=handle, on_start=on_start, default_concurrency=1)


if __name__ == "__main__":
    main()
