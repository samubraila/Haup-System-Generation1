from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable, Protocol


@dataclass
class GenerationRequest:
    prompt: str
    negative_prompt: str
    width: int
    height: int
    fps: int
    duration_sec: float
    seed: int | None
    steps: int
    guidance_scale: float
    init_image_path: str | None
    scene_index: int
    scene_count: int
    output_path: str


class AdapterUnavailable(RuntimeError):
    pass


class VideoAdapter(Protocol):
    name: str
    requires_gpu: bool
    produces_ai_video: bool

    def prepare(self, config: Any, logger: logging.Logger) -> dict[str, Any]: ...

    def generate(
        self,
        request: GenerationRequest,
        report_progress: Callable[[float, str | None], None],
        logger: logging.Logger,
    ) -> str: ...
