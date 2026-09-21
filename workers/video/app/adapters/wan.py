from __future__ import annotations

from .diffusers_base import DiffusersVideoAdapter


class WanAdapter(DiffusersVideoAdapter):
    name = "wan"
    pipeline_class_path = "diffusers.WanPipeline"
    default_model_id = "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"
    model_env_key = "WAN_MODEL_PATH"
    frame_limit = 161
