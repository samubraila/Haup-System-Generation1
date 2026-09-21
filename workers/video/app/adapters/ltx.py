from __future__ import annotations

from .diffusers_base import DiffusersVideoAdapter


class LtxAdapter(DiffusersVideoAdapter):
    name = "ltx"
    pipeline_class_path = "diffusers.LTXPipeline"
    default_model_id = "Lightricks/LTX-Video"
    model_env_key = "LTX_MODEL_PATH"
    frame_limit = 257
