from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any, Callable

import requests

from .base import AdapterUnavailable, GenerationRequest

PLACEHOLDERS = {
    "prompt": "%PROMPT%",
    "negative_prompt": "%NEGATIVE_PROMPT%",
    "width": "%WIDTH%",
    "height": "%HEIGHT%",
    "frames": "%FRAMES%",
    "fps": "%FPS%",
    "seed": "%SEED%",
    "steps": "%STEPS%",
    "guidance": "%GUIDANCE%",
}


class ComfyUiAdapter:
    name = "comfyui"
    requires_gpu = False
    produces_ai_video = True

    def __init__(self) -> None:
        self.last_attribution: dict[str, Any] | None = None
        self.base_url = ""
        self.workflow_path = ""
        self.poll_interval = 3.0
        self.max_wait_sec = 3600

    def prepare(self, config: Any, logger: logging.Logger) -> dict[str, Any]:
        self.base_url = os.environ.get("COMFYUI_URL", "http://host.docker.internal:8188").rstrip("/")
        workflow_name = os.environ.get("COMFYUI_WORKFLOW", "default_t2v.json")
        self.workflow_path = os.path.join(os.environ.get("COMFYUI_WORKFLOW_DIR", "/app/workflows"), workflow_name)

        reachable = False
        detail = None
        try:
            response = requests.get(f"{self.base_url}/system_stats", timeout=5)
            reachable = response.status_code == 200
            if reachable:
                detail = response.json()
        except requests.RequestException as exc:
            detail = str(exc)

        workflow_present = os.path.isfile(self.workflow_path)
        if not workflow_present:
            logger.warning(
                "ComfyUI-Workflow fehlt",
                extra={"extra": {"path": self.workflow_path}},
            )

        return {
            "adapter": self.name,
            "producesAiVideo": True,
            "ready": reachable and workflow_present,
            "comfyUrl": self.base_url,
            "reachable": reachable,
            "workflow": self.workflow_path,
            "workflowPresent": workflow_present,
            "systemStats": detail if reachable else None,
            "note": None
            if reachable and workflow_present
            else "ComfyUI ist nicht erreichbar oder der Workflow fehlt. Siehe docs/VIDEO_MODELS.md.",
        }

    def _load_workflow(self, request: GenerationRequest) -> dict[str, Any]:
        if not os.path.isfile(self.workflow_path):
            raise AdapterUnavailable(
                f"ComfyUI-Workflow {self.workflow_path} nicht gefunden. "
                "Lege einen exportierten API-Workflow dort ab (docs/VIDEO_MODELS.md)."
            )

        with open(self.workflow_path, "r", encoding="utf-8") as handle:
            raw = handle.read()

        frames = max(9, int(request.duration_sec * request.fps))
        seed = request.seed if request.seed is not None else int(uuid.uuid4().int % 2**31)

        replacements = {
            PLACEHOLDERS["prompt"]: request.prompt,
            PLACEHOLDERS["negative_prompt"]: request.negative_prompt,
            PLACEHOLDERS["width"]: str(request.width),
            PLACEHOLDERS["height"]: str(request.height),
            PLACEHOLDERS["frames"]: str(frames),
            PLACEHOLDERS["fps"]: str(request.fps),
            PLACEHOLDERS["seed"]: str(seed),
            PLACEHOLDERS["steps"]: str(request.steps),
            PLACEHOLDERS["guidance"]: str(request.guidance_scale),
        }

        for placeholder, value in replacements.items():
            escaped = json.dumps(value)[1:-1]
            raw = raw.replace(f'"{placeholder}"', json.dumps(value))
            raw = raw.replace(placeholder, escaped)

        return json.loads(raw)

    def generate(
        self,
        request: GenerationRequest,
        report_progress: Callable[[float, str | None], None],
        logger: logging.Logger,
    ) -> str:
        workflow = self._load_workflow(request)
        client_id = str(uuid.uuid4())

        try:
            queued = requests.post(
                f"{self.base_url}/prompt",
                json={"prompt": workflow, "client_id": client_id},
                timeout=30,
            )
        except requests.RequestException as exc:
            raise AdapterUnavailable(f"ComfyUI unter {self.base_url} nicht erreichbar: {exc}") from exc

        if queued.status_code >= 400:
            raise RuntimeError(f"ComfyUI lehnte den Workflow ab ({queued.status_code}): {queued.text[:400]}")

        prompt_id = queued.json().get("prompt_id")
        if not prompt_id:
            raise RuntimeError("ComfyUI lieferte keine prompt_id zurueck")

        logger.info("ComfyUI-Auftrag eingereiht", extra={"extra": {"promptId": prompt_id}})
        report_progress(10.0, "ComfyUI verarbeitet den Auftrag")

        deadline = time.time() + self.max_wait_sec
        history: dict[str, Any] = {}

        while time.time() < deadline:
            time.sleep(self.poll_interval)
            try:
                response = requests.get(f"{self.base_url}/history/{prompt_id}", timeout=15)
                if response.status_code != 200:
                    continue
                payload = response.json()
            except requests.RequestException:
                continue

            entry = payload.get(prompt_id)
            if not entry:
                elapsed = self.max_wait_sec - (deadline - time.time())
                report_progress(min(85.0, 10.0 + elapsed / 10), "ComfyUI arbeitet")
                continue

            status = entry.get("status", {})
            if status.get("status_str") == "error" or status.get("completed") is False and status.get("messages"):
                messages = json.dumps(status.get("messages", []))[:400]
                if status.get("status_str") == "error":
                    raise RuntimeError(f"ComfyUI meldete einen Fehler: {messages}")

            history = entry
            if status.get("completed"):
                break

        if not history:
            raise TimeoutError("ComfyUI hat den Auftrag nicht innerhalb der Wartezeit abgeschlossen")

        report_progress(90.0, "Ergebnis wird geladen")

        outputs = history.get("outputs", {})
        target = None
        for node_output in outputs.values():
            for key in ("gifs", "videos", "images"):
                items = node_output.get(key) or []
                for item in items:
                    filename = item.get("filename", "")
                    if filename.lower().endswith((".mp4", ".webm", ".mkv")):
                        target = item
                        break
                if target:
                    break
            if target:
                break

        if target is None:
            raise RuntimeError(
                "ComfyUI lieferte keine Videodatei. Der Workflow muss einen Video-Export-Node enthalten."
            )

        params = {
            "filename": target.get("filename"),
            "subfolder": target.get("subfolder", ""),
            "type": target.get("type", "output"),
        }
        download = requests.get(f"{self.base_url}/view", params=params, timeout=600, stream=True)
        if download.status_code >= 400:
            raise RuntimeError(f"Video konnte nicht von ComfyUI geladen werden ({download.status_code})")

        with open(request.output_path, "wb") as handle:
            for chunk in download.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)

        report_progress(100.0, "Generierung abgeschlossen")
        return request.output_path
