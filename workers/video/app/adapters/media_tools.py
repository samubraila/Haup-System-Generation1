from __future__ import annotations

import os
import re
import subprocess

STOPWORDS = {
    "der", "die", "das", "und", "oder", "mit", "von", "fuer", "für", "ein", "eine", "einen",
    "the", "and", "with", "from", "for", "a", "an", "of", "in", "on", "at", "to",
    "cinematic", "realistic", "shot", "view", "camera", "lighting", "detailed", "highly",
    "weite", "einstellung", "langsame", "kamerafahrt", "mittlere", "leichter", "schwenk",
    "detailaufnahme", "geringe", "schaerfentiefe", "vogelperspektive", "ruhige", "bewegung",
    "dynamische", "nach", "vorne", "statische", "weiches", "licht", "8k", "4k",
}

MOTION_PRESETS = {
    "zoom-in": (1.0, 0.0),
    "zoom-out": (-1.0, 0.0),
    "pan-left": (0.0, -1.0),
    "pan-right": (0.0, 1.0),
}


def derive_keywords(prompt: str, explicit: list[str] | None, limit: int = 4) -> list[str]:
    if explicit:
        cleaned = [word.strip() for word in explicit if word and word.strip()]
        if cleaned:
            return cleaned[:limit]

    words = re.findall(r"[A-Za-zÄÖÜäöüß]{3,}", prompt or "")
    picked: list[str] = []
    for word in words:
        lowered = word.lower()
        if lowered in STOPWORDS or lowered in {p.lower() for p in picked}:
            continue
        picked.append(word)
        if len(picked) >= limit:
            break
    return picked


def run_ffmpeg(args: list[str], timeout: int = 900) -> None:
    result = subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg-Fehler: {result.stderr[-600:]}")


def probe_duration(path: str) -> float:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        )
        return float(result.stdout.strip() or 0.0)
    except (subprocess.SubprocessError, ValueError, OSError):
        return 0.0


def fit_clip(source: str, target: str, width: int, height: int, fps: int, duration: float) -> None:
    available = probe_duration(source)
    args: list[str] = []

    if available > 0 and available < duration - 0.05:
        args += ["-stream_loop", "-1"]

    args += ["-i", source, "-an", "-t", f"{duration:.3f}"]
    args += [
        "-vf",
        (
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},fps={fps},setsar=1,format=yuv420p"
        ),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        target,
    ]
    run_ffmpeg(args)


def ken_burns(
    image: str,
    target: str,
    width: int,
    height: int,
    fps: int,
    duration: float,
    motion: str,
    strength: float,
    scene_index: int,
) -> None:
    frames = max(1, int(round(duration * fps)))
    amount = max(0.0, min(1.0, strength)) * 0.35

    if motion == "none" or amount <= 0:
        run_ffmpeg([
            "-loop", "1", "-i", image, "-t", f"{duration:.3f}",
            "-vf",
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},fps={fps},setsar=1,format=yuv420p",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            target,
        ])
        return

    chosen = motion
    if motion == "kenburns":
        chosen = ["zoom-in", "pan-right", "zoom-out", "pan-left"][scene_index % 4]

    zoom_dir, pan_dir = MOTION_PRESETS.get(chosen, (1.0, 0.0))

    if zoom_dir > 0:
        zoom_expr = f"min(zoom+{amount / frames:.8f},{1 + amount:.4f})"
    elif zoom_dir < 0:
        zoom_expr = f"max({1 + amount:.4f}-on*{amount / frames:.8f},1.0)"
    else:
        zoom_expr = f"{1 + amount:.4f}"

    if pan_dir > 0:
        x_expr = "iw/2-(iw/zoom/2)+(on/{f})*(iw*0.08)".format(f=frames)
    elif pan_dir < 0:
        x_expr = "iw/2-(iw/zoom/2)-(on/{f})*(iw*0.08)".format(f=frames)
    else:
        x_expr = "iw/2-(iw/zoom/2)"

    upscale_w = width * 2
    upscale_h = height * 2

    run_ffmpeg([
        "-loop", "1", "-i", image, "-t", f"{duration:.3f}",
        "-vf",
        (
            f"scale={upscale_w}:{upscale_h}:force_original_aspect_ratio=increase,"
            f"crop={upscale_w}:{upscale_h},"
            f"zoompan=z='{zoom_expr}':x='{x_expr}':y='ih/2-(ih/zoom/2)':"
            f"d={frames}:s={width}x{height}:fps={fps},"
            "setsar=1,format=yuv420p"
        ),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        target,
    ])


def orientation_for(width: int, height: int) -> str:
    if height > width * 1.15:
        return "portrait"
    if width > height * 1.15:
        return "landscape"
    return "square"


def ensure_parent(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
