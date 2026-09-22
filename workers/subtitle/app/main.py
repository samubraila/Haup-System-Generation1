from __future__ import annotations

import logging
import os
import subprocess
from typing import Any

from acfworker import JobContext, PermanentJobError, detect_gpu, run_worker

from .ass import Word, render_ass
from .srt import build_cues, render_srt, render_vtt

QUEUE = "subtitle"

_state: dict[str, Any] = {"model": None, "device": "cpu", "compute_type": "int8", "model_size": "base"}


def _extract_audio(source_path: str, work_dir: str) -> str:
    target = os.path.join(work_dir, "audio.wav")
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", source_path,
            "-vn", "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le",
            target,
        ],
        capture_output=True,
        text=True,
        timeout=1800,
    )
    if result.returncode != 0:
        raise PermanentJobError(f"Tonspur konnte nicht extrahiert werden: {result.stderr[-400:]}")
    return target


def _load_model(logger: logging.Logger):
    if _state["model"] is not None:
        return _state["model"]

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise PermanentJobError(
            f"faster-whisper ist nicht installiert: {exc}. Bitte das Subtitle-Image neu bauen."
        ) from exc

    logger.info(
        "Whisper-Modell wird geladen",
        extra={"extra": {"model": _state["model_size"], "device": _state["device"], "compute": _state["compute_type"]}},
    )
    model = WhisperModel(
        _state["model_size"],
        device=_state["device"],
        compute_type=_state["compute_type"],
        download_root=os.environ.get("MODELS_DIR", "/models") + "/whisper",
    )
    _state["model"] = model
    return model


def on_start(config: Any, logger: logging.Logger) -> dict[str, Any]:
    gpu = detect_gpu(0)
    requested_device = os.environ.get("WHISPER_DEVICE", "auto")

    if requested_device == "auto":
        device = "cuda" if gpu.available else "cpu"
    else:
        device = requested_device

    compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "float16" if device == "cuda" else "int8")

    _state["device"] = device
    _state["compute_type"] = compute_type
    _state["model_size"] = os.environ.get("WHISPER_MODEL", "base")

    logger.info(
        "Subtitle-Worker bereit",
        extra={"extra": {"device": device, "model": _state["model_size"]}},
    )

    return {
        "engine": "faster-whisper",
        "model": _state["model_size"],
        "device": device,
        "computeType": compute_type,
        "gpu": gpu.to_dict(),
        "note": "Laeuft auch ohne GPU auf der CPU, dann langsamer.",
    }


def handle(ctx: JobContext) -> dict[str, Any]:
    data = ctx.data
    project_id = str(data.get("projectId") or "")
    video_id = str(data.get("videoId") or "")
    source_path = str(data.get("sourcePath") or "")
    language = str(data.get("language") or "de")
    style = data.get("style") or {}

    if not project_id or not video_id or not source_path:
        raise PermanentJobError("projectId, videoId oder sourcePath fehlt im Auftrag")

    work_dir = ctx.storage.create_temp_dir(f"subtitle-{video_id[:8]}")

    try:
        ctx.report_progress(5, "Quelldatei wird geladen")
        local_source = ctx.storage.pull(source_path, work_dir)

        ctx.report_progress(15, "Tonspur wird vorbereitet")
        audio_path = _extract_audio(local_source, work_dir)

        if os.path.getsize(audio_path) < 2000:
            raise PermanentJobError(
                "Die Quelldatei enthaelt keine verwertbare Tonspur. "
                "Ohne Ton koennen keine Untertitel erzeugt werden."
            )

        model = _load_model(ctx.logger)

        ctx.report_progress(25, "Sprache wird erkannt")
        initial_prompt = str(data.get("transcriptHint") or "")[:800] or None

        segments_iterator, info = model.transcribe(
            audio_path,
            language=language,
            beam_size=5,
            vad_filter=True,
            initial_prompt=initial_prompt,
            word_timestamps=True,
        )

        total_duration = max(0.1, float(getattr(info, "duration", 0.0) or 0.0))
        segments: list[tuple[float, float, str]] = []
        words: list[Word] = []

        for segment in segments_iterator:
            segments.append((float(segment.start), float(segment.end), str(segment.text)))
            for word in getattr(segment, "words", None) or []:
                text = str(getattr(word, "word", "") or "").strip()
                if not text:
                    continue
                words.append(Word(start=float(word.start), end=float(word.end), text=text))
            ctx.report_progress(
                25 + min(60.0, (float(segment.end) / total_duration) * 60.0),
                "Transkription laeuft",
            )

        if not segments:
            raise PermanentJobError("Es wurde keine Sprache erkannt")

        cues = build_cues(
            segments,
            max_chars=int(style.get("maxCharsPerLine") or 38),
            uppercase=bool(style.get("uppercase")),
        )

        srt_content = render_srt(cues)
        vtt_content = render_vtt(cues)

        srt_name = f"{video_id}.srt"
        srt_path = ctx.storage.project_path(project_id, "subtitles", srt_name)
        ctx.storage.write_text(srt_path, srt_content, "application/x-subrip")
        ctx.storage.write_text(
            ctx.storage.project_path(project_id, "subtitles", f"{video_id}.vtt"),
            vtt_content,
            "text/vtt",
        )

        ass_content = render_ass(
            cues,
            words,
            dict(style),
            int(data.get("videoWidth") or 1080),
            int(data.get("videoHeight") or 1920),
        )
        ass_name = f"{video_id}.ass"
        ass_path = ctx.storage.project_path(project_id, "subtitles", ass_name)
        ctx.storage.write_text(ass_path, ass_content, "text/x-ssa")

        ctx.api.register_media(
            {
                "projectId": project_id,
                "videoId": video_id,
                "kind": "subtitle",
                "path": ass_path,
                "fileName": ass_name,
                "mimeType": "text/x-ssa",
                "sizeBytes": len(ass_content.encode("utf-8")),
                "meta": {
                    "stage": "subtitle",
                    "format": "ass",
                    "animation": style.get("animation") or "none",
                    "words": len(words),
                },
            }
        )

        ctx.report_progress(95, "Untertitel werden gespeichert")

        media = ctx.api.register_media(
            {
                "projectId": project_id,
                "videoId": video_id,
                "kind": "subtitle",
                "path": srt_path,
                "fileName": srt_name,
                "mimeType": "application/x-subrip",
                "sizeBytes": len(srt_content.encode("utf-8")),
                "meta": {
                    "stage": "subtitle",
                    "language": language,
                    "cues": len(cues),
                    "words": len(words),
                    "model": _state["model_size"],
                    "device": _state["device"],
                    "format": "srt",
                },
            }
        )

        transcript = " ".join(text.strip() for _, _, text in segments)

        return {
            "mediaId": media.get("id"),
            "path": srt_path,
            "assPath": ass_path,
            "cues": len(cues),
            "words": len(words),
            "language": language,
            "transcript": transcript[:4000],
        }
    finally:
        ctx.storage.remove_temp_dir(work_dir)


def main() -> None:
    run_worker(name="subtitle-worker", queue=QUEUE, handler=handle, on_start=on_start, default_concurrency=1)


if __name__ == "__main__":
    main()
