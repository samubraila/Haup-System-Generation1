from __future__ import annotations

import logging
import os
from typing import Any, Callable

from .base import AdapterUnavailable, GenerationRequest


class DiffusersVideoAdapter:
    name = "diffusers"
    requires_gpu = True
    produces_ai_video = True
    pipeline_class_path = ""
    default_model_id = ""
    model_env_key = ""
    frame_limit = 257

    def __init__(self) -> None:
        self.last_attribution: dict[str, Any] | None = None
        self._pipeline: Any = None
        self._model_path: str = ""
        self._dtype: Any = None

    def _resolve_model_path(self, config: Any) -> str:
        configured = os.environ.get(self.model_env_key, "")
        if configured:
            return configured
        return os.path.join(config.models_dir, self.name)

    def _import_pipeline(self) -> Any:
        module_name, class_name = self.pipeline_class_path.rsplit(".", 1)
        try:
            module = __import__(module_name, fromlist=[class_name])
        except ImportError as exc:
            raise AdapterUnavailable(
                f"Die Bibliothek fuer {self.name} ist nicht installiert: {exc}. "
                "Baue das GPU-Image mit dem Profil 'gpu'."
            ) from exc
        return getattr(module, class_name)

    def prepare(self, config: Any, logger: logging.Logger) -> dict[str, Any]:
        self._model_path = self._resolve_model_path(config)
        model_present = os.path.isdir(self._model_path) and any(os.scandir(self._model_path))

        return {
            "adapter": self.name,
            "producesAiVideo": True,
            "ready": model_present,
            "modelPath": self._model_path,
            "modelPresent": model_present,
            "note": None
            if model_present
            else f"Modell fehlt unter {self._model_path}. Siehe docs/VIDEO_MODELS.md zum Herunterladen.",
        }

    def _load_pipeline(self, logger: logging.Logger) -> Any:
        if self._pipeline is not None:
            return self._pipeline

        import torch

        if not os.path.isdir(self._model_path):
            raise AdapterUnavailable(
                f"Modellverzeichnis {self._model_path} existiert nicht. "
                "Bitte das Modell laden - Anleitung in docs/VIDEO_MODELS.md."
            )

        pipeline_class = self._import_pipeline()
        self._dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16

        logger.info(
            "Modell wird geladen",
            extra={"extra": {"adapter": self.name, "path": self._model_path, "dtype": str(self._dtype)}},
        )

        pipeline = pipeline_class.from_pretrained(self._model_path, torch_dtype=self._dtype)
        pipeline.to("cuda")
        pipeline.enable_attention_slicing()
        if hasattr(pipeline, "enable_vae_tiling"):
            pipeline.enable_vae_tiling()
        if hasattr(pipeline, "enable_model_cpu_offload"):
            pipeline.enable_model_cpu_offload()

        self._pipeline = pipeline
        return pipeline

    def _frame_count(self, request: GenerationRequest) -> int:
        frames = int(request.duration_sec * request.fps)
        frames = max(9, min(self.frame_limit, frames))
        return frames - ((frames - 1) % 8)

    def generate(
        self,
        request: GenerationRequest,
        report_progress: Callable[[float, str | None], None],
        logger: logging.Logger,
    ) -> str:
        import torch
        from diffusers.utils import export_to_video

        pipeline = self._load_pipeline(logger)
        frames = self._frame_count(request)
        generator = torch.Generator(device="cuda")
        if request.seed is not None:
            generator = generator.manual_seed(request.seed)

        report_progress(10.0, f"{frames} Einzelbilder werden erzeugt")

        def step_callback(_pipe: Any, step: int, _timestep: Any, callback_kwargs: dict[str, Any]) -> dict[str, Any]:
            fraction = (step + 1) / max(1, request.steps)
            report_progress(10.0 + fraction * 80.0, f"Schritt {step + 1} von {request.steps}")
            return callback_kwargs

        output = pipeline(
            prompt=request.prompt,
            negative_prompt=request.negative_prompt or None,
            width=request.width,
            height=request.height,
            num_frames=frames,
            num_inference_steps=request.steps,
            guidance_scale=request.guidance_scale,
            generator=generator,
            callback_on_step_end=step_callback,
        )

        report_progress(92.0, "Video wird geschrieben")
        export_to_video(output.frames[0], request.output_path, fps=request.fps)

        torch.cuda.empty_cache()
        report_progress(100.0, "Generierung abgeschlossen")
        return request.output_path
