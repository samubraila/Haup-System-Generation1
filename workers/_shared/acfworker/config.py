from __future__ import annotations

import os
import socket
import uuid
from dataclasses import dataclass


def _env(key: str, fallback: str | None = None) -> str:
    value = os.environ.get(key, "")
    if value:
        return value
    if fallback is not None:
        return fallback
    raise RuntimeError(f"Pflicht-Umgebungsvariable {key} fehlt")


def _env_int(key: str, fallback: int) -> int:
    raw = os.environ.get(key, "")
    if not raw:
        return fallback
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Umgebungsvariable {key} ist keine Zahl: {raw}") from exc


def _env_float(key: str, fallback: float) -> float:
    raw = os.environ.get(key, "")
    if not raw:
        return fallback
    try:
        return float(raw)
    except ValueError as exc:
        raise RuntimeError(f"Umgebungsvariable {key} ist keine Zahl: {raw}") from exc


@dataclass(frozen=True)
class WorkerConfig:
    worker_name: str
    worker_id: str
    version: str
    host: str
    redis_url: str
    backend_url: str
    internal_api_key: str
    data_dir: str
    storage_mode: str
    health_port: int
    concurrency: int
    job_timeout_sec: int
    max_attempts: int
    lock_ttl_sec: int
    log_level: str
    models_dir: str
    gpu_mode: str
    gpu_min_vram_mb: int
    gpu_recheck_sec: int


def load_config(name: str, default_concurrency: int = 1) -> WorkerConfig:
    storage_mode = _env("STORAGE_MODE", "volume")
    if storage_mode not in ("volume", "api"):
        raise RuntimeError(f'STORAGE_MODE muss "volume" oder "api" sein, war: {storage_mode}')

    worker_name = _env("WORKER_NAME", name)
    host = socket.gethostname()

    return WorkerConfig(
        worker_name=worker_name,
        worker_id=_env("WORKER_ID", f"{worker_name}-{host}-{uuid.uuid4().hex[:8]}"),
        version=_env("WORKER_VERSION", "1.0.0"),
        host=host,
        redis_url=_env("REDIS_URL"),
        backend_url=_env("BACKEND_URL", "http://backend:4000"),
        internal_api_key=_env("INTERNAL_API_KEY"),
        data_dir=_env("DATA_DIR", "/data"),
        storage_mode=storage_mode,
        health_port=_env_int("HEALTH_PORT", 9000),
        concurrency=_env_int("CONCURRENCY", default_concurrency),
        job_timeout_sec=_env_int("JOB_TIMEOUT_MS", 3600000) // 1000,
        max_attempts=_env_int("JOB_MAX_ATTEMPTS", 3),
        lock_ttl_sec=_env_int("JOB_LOCK_TTL_SEC", 60),
        log_level=_env("LOG_LEVEL", "info"),
        models_dir=_env("MODELS_DIR", "/models"),
        gpu_mode=_env("GPU_MODE", "auto"),
        gpu_min_vram_mb=_env_int("GPU_MIN_VRAM_MB", 8000),
        gpu_recheck_sec=_env_int("GPU_RECHECK_INTERVAL_MS", 60000) // 1000,
    )
