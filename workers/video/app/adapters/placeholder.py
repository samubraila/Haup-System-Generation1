from __future__ import annotations

import logging
import subprocess
import textwrap
from typing import Any, Callable

from .base import GenerationRequest

PALETTE = ["#1e1b4b", "#0f766e", "#7c2d12", "#312e81", "#134e4a", "#3f1d38"]


def _escape_drawtext(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "")
        .replace("%", "\\%")
    )


class PlaceholderAdapter:
    name = "placeholder"
    requires_gpu = False
    produces_ai_video = False

    def __init__(self) -> None:
        self.last_attribution: dict[str, Any] | None = None

    def prepare(self, config: Any, logger: logging.Logger) -> dict[str, Any]:
        logger.warning(
            "Platzhalter-Adapter aktiv: es wird KEIN KI-Video erzeugt, sondern nur ein technischer Testclip"
        )
        return {
            "adapter": self.name,
            "producesAiVideo": False,
            "ready": True,
            "mode": "test",
            "note": "Technischer Testclip zum Pruefen der Pipeline. Fuer echtes Material VIDEO_GENERATOR_PROVIDER auf stock, slideshow, ltx, wan oder comfyui setzen.",
        }

    def generate(
        self,
        request: GenerationRequest,
        report_progress: Callable[[float, str | None], None],
        logger: logging.Logger,
    ) -> str:
        color = PALETTE[request.scene_index % len(PALETTE)]
        wrapped = "\n".join(textwrap.wrap(request.prompt, width=34)[:6])
        font_size = max(24, request.width // 26)

        draw_prompt = (
            f"drawtext=text='{_escape_drawtext(wrapped)}'"
            f":fontcolor=white:fontsize={font_size}:line_spacing=12"
            ":x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.35:boxborderw=24"
        )
        draw_label = (
            "drawtext=text='PLATZHALTER - kein KI-Video'"
            f":fontcolor=white@0.8:fontsize={max(18, font_size // 2)}"
            ":x=(w-text_w)/2:y=h*0.08:box=1:boxcolor=red@0.55:boxborderw=14"
        )
        draw_scene = (
            f"drawtext=text='Szene {request.scene_index + 1} von {request.scene_count}'"
            f":fontcolor=white@0.75:fontsize={max(16, font_size // 2)}"
            ":x=(w-text_w)/2:y=h*0.88"
        )

        report_progress(20.0, "Testclip wird erzeugt")

        command = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s={request.width}x{request.height}:d={request.duration_sec}:r={request.fps}",
            "-vf",
            f"noise=alls=7:allf=t+u,{draw_label},{draw_prompt},{draw_scene},format=yuv420p",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-pix_fmt",
            "yuv420p",
            "-t",
            str(request.duration_sec),
            request.output_path,
        ]

        result = subprocess.run(command, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg konnte den Testclip nicht erzeugen: {result.stderr[-500:]}")

        report_progress(100.0, "Testclip fertig")
        logger.info(
            "Platzhalter-Clip erzeugt",
            extra={"extra": {"scene": request.scene_index, "path": request.output_path}},
        )
        return request.output_path
