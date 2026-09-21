from __future__ import annotations

import logging
import os
import subprocess
import wave
from typing import Any

from acfworker import JobContext, PermanentJobError, run_worker

QUEUE = "voice"

_state: dict[str, Any] = {"provider": "none", "model_path": "", "voice_ready": False}


def _piper_binary() -> str | None:
    from shutil import which

    return which("piper")


def _wav_duration_ms(path: str) -> int:
    try:
        with wave.open(path, "rb") as handle:
            frames = handle.getnframes()
            rate = handle.getframerate() or 1
            return int((frames / rate) * 1000)
    except (wave.Error, OSError):
        return 0


def on_start(config: Any, logger: logging.Logger) -> dict[str, Any]:
    provider = os.environ.get("TTS_PROVIDER", "none").lower()
    model_path = os.environ.get("PIPER_MODEL_PATH", os.path.join(config.models_dir, "piper", "model.onnx"))

    _state["provider"] = provider
    _state["model_path"] = model_path

    binary = _piper_binary()
    model_present = os.path.isfile(model_path)
    config_present = os.path.isfile(model_path + ".json")
    _state["voice_ready"] = provider == "piper" and binary is not None and model_present and config_present

    if provider == "none":
        logger.warning(
            "TTS_PROVIDER=none: der Voice-Worker lehnt Auftraege ab, bis eine Stimme eingerichtet ist"
        )
    elif not _state["voice_ready"]:
        logger.warning(
            "Piper ist nicht vollstaendig eingerichtet",
            extra={"extra": {"binary": bool(binary), "model": model_present, "config": config_present}},
        )

    return {
        "provider": provider,
        "modelPath": model_path,
        "piperBinary": bool(binary),
        "modelPresent": model_present,
        "configPresent": config_present,
        "ready": _state["voice_ready"],
        "note": None
        if _state["voice_ready"]
        else "Keine Stimme eingerichtet. Anleitung in docs/VOICE_SETUP.md. Ohne Stimme laeuft die Pipeline ohne Sprachausgabe weiter.",
    }


def _synthesize(text: str, output_wav: str, speed: float) -> None:
    binary = _piper_binary()
    if binary is None:
        raise PermanentJobError("Das Programm piper ist im Container nicht vorhanden")

    length_scale = max(0.5, min(2.0, 1.0 / max(0.1, speed)))

    result = subprocess.run(
        [
            binary,
            "--model", _state["model_path"],
            "--output_file", output_wav,
            "--length_scale", str(length_scale),
        ],
        input=text,
        capture_output=True,
        text=True,
        timeout=1800,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Piper meldete einen Fehler: {result.stderr[-400:]}")


def _to_mp3(wav_path: str, mp3_path: str) -> None:
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", wav_path,
            "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", "-ac", "2",
            mp3_path,
        ],
        capture_output=True,
        text=True,
        timeout=900,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Umwandlung nach MP3 fehlgeschlagen: {result.stderr[-400:]}")


def handle(ctx: JobContext) -> dict[str, Any]:
    data = ctx.data
    project_id = str(data.get("projectId") or "")
    video_id = str(data.get("videoId") or "")
    text = str(data.get("text") or "").strip()
    speed = float(data.get("speed") or 1.0)

    if not project_id or not video_id:
        raise PermanentJobError("projectId oder videoId fehlt im Auftrag")
    if not text:
        raise PermanentJobError("Es wurde kein Text zum Vorlesen uebergeben")

    if not _state["voice_ready"]:
        raise PermanentJobError(
            "Es ist keine Stimme eingerichtet (TTS_PROVIDER / PIPER_MODEL_PATH). "
            "Anleitung in docs/VOICE_SETUP.md. Schalte die Sprachausgabe in den Projekteinstellungen ab, "
            "um ohne Stimme zu produzieren."
        )

    work_dir = ctx.storage.create_temp_dir(f"voice-{video_id[:8]}")

    try:
        ctx.report_progress(10, "Sprachausgabe wird erzeugt")
        wav_path = os.path.join(work_dir, "voice.wav")
        _synthesize(text, wav_path, speed)

        ctx.report_progress(70, "Audio wird umgewandelt")
        file_name = f"{video_id}-voice.mp3"
        mp3_path = os.path.join(work_dir, file_name)
        _to_mp3(wav_path, mp3_path)

        duration_ms = _wav_duration_ms(wav_path)
        storage_path = ctx.storage.project_path(project_id, "audio", file_name)
        ctx.storage.push(mp3_path, storage_path, "audio/mpeg")

        media = ctx.api.register_media(
            {
                "projectId": project_id,
                "videoId": video_id,
                "kind": "audio",
                "path": storage_path,
                "fileName": file_name,
                "mimeType": "audio/mpeg",
                "sizeBytes": os.path.getsize(mp3_path),
                "durationMs": duration_ms,
                "meta": {
                    "stage": "voice",
                    "provider": _state["provider"],
                    "speed": speed,
                    "characters": len(text),
                },
            }
        )

        ctx.report_progress(100, "Sprachausgabe fertig")
        return {"mediaId": media.get("id"), "path": storage_path, "durationMs": duration_ms}
    finally:
        ctx.storage.remove_temp_dir(work_dir)


def main() -> None:
    run_worker(name="voice-worker", queue=QUEUE, handler=handle, on_start=on_start, default_concurrency=1)


if __name__ == "__main__":
    main()
