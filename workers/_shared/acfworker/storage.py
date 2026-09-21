from __future__ import annotations

import os
import shutil
import tempfile
import uuid
from pathlib import PurePosixPath

from .api import BackendApi

BUCKETS = (
    "scripts",
    "images",
    "audio",
    "videos",
    "subtitles",
    "thumbnails",
    "final",
    "published",
    "exports",
)


class Storage:
    def __init__(self, data_dir: str, mode: str, api: BackendApi) -> None:
        self.data_dir = os.path.abspath(data_dir)
        self.mode = mode
        self.api = api
        self.temp_root = os.path.join(self.data_dir, "temp") if mode == "volume" else os.path.join(tempfile.gettempdir(), "acf")

    def _resolve_safe(self, relative_path: str) -> str:
        normalized = str(PurePosixPath(relative_path.replace("\\", "/"))).lstrip("/")
        if normalized.startswith(".."):
            raise ValueError(f"Ungueltiger Storage-Pfad: {relative_path}")
        absolute = os.path.abspath(os.path.join(self.data_dir, normalized))
        if absolute != self.data_dir and not absolute.startswith(self.data_dir + os.sep):
            raise ValueError(f"Storage-Pfad verlaesst das Datenverzeichnis: {relative_path}")
        return absolute

    def create_temp_dir(self, prefix: str = "job") -> str:
        path = os.path.join(self.temp_root, f"{prefix}-{uuid.uuid4().hex[:8]}")
        os.makedirs(path, exist_ok=True)
        return path

    def remove_temp_dir(self, path: str) -> None:
        if not path.startswith(self.temp_root):
            return
        shutil.rmtree(path, ignore_errors=True)

    def pull(self, relative_path: str, target_dir: str | None = None) -> str:
        if self.mode == "volume":
            absolute = self._resolve_safe(relative_path)
            if not os.path.isfile(absolute):
                raise FileNotFoundError(f"Datei fehlt im Storage: {relative_path}")
            return absolute

        directory = target_dir or self.create_temp_dir("pull")
        os.makedirs(directory, exist_ok=True)
        target = os.path.join(directory, os.path.basename(relative_path))
        return self.api.download_file(relative_path, target)

    def push(self, local_path: str, relative_path: str, content_type: str = "application/octet-stream") -> str:
        if self.mode == "volume":
            absolute = self._resolve_safe(relative_path)
            os.makedirs(os.path.dirname(absolute), exist_ok=True)
            if os.path.abspath(local_path) != absolute:
                shutil.copyfile(local_path, absolute)
            return relative_path

        self.api.upload_file(relative_path, local_path, content_type)
        return relative_path

    def write_text(self, relative_path: str, content: str, content_type: str = "text/plain; charset=utf-8") -> str:
        if self.mode == "volume":
            absolute = self._resolve_safe(relative_path)
            os.makedirs(os.path.dirname(absolute), exist_ok=True)
            with open(absolute, "w", encoding="utf-8") as handle:
                handle.write(content)
            return relative_path

        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, suffix=".tmp") as handle:
            handle.write(content)
            temp_path = handle.name
        try:
            self.api.upload_file(relative_path, temp_path, content_type)
        finally:
            os.unlink(temp_path)
        return relative_path

    def read_text(self, relative_path: str) -> str:
        local = self.pull(relative_path)
        with open(local, "r", encoding="utf-8") as handle:
            return handle.read()

    @staticmethod
    def project_path(project_id: str, bucket: str, file_name: str) -> str:
        return f"projects/{project_id}/{bucket}/{file_name}"
