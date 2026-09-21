from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass, asdict
from typing import Any


@dataclass
class GpuInfo:
    available: bool
    name: str | None
    total_vram_mb: int | None
    free_vram_mb: int | None
    utilization: int | None
    driver: str | None
    backend: str
    reason: str | None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        return {
            "available": data["available"],
            "name": data["name"],
            "totalVramMb": data["total_vram_mb"],
            "freeVramMb": data["free_vram_mb"],
            "utilization": data["utilization"],
            "driver": data["driver"],
            "backend": data["backend"],
            "reason": data["reason"],
        }


def _query_nvidia_smi() -> GpuInfo | None:
    if shutil.which("nvidia-smi") is None:
        return None
    try:
        output = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.free,utilization.gpu,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=15,
            check=True,
        ).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return None

    first_line = output.splitlines()[0] if output else ""
    if not first_line:
        return None

    parts = [part.strip() for part in first_line.split(",")]
    if len(parts) < 5:
        return None

    try:
        return GpuInfo(
            available=True,
            name=parts[0],
            total_vram_mb=int(float(parts[1])),
            free_vram_mb=int(float(parts[2])),
            utilization=int(float(parts[3])),
            driver=parts[4],
            backend="cuda",
            reason=None,
        )
    except ValueError:
        return None


def _query_torch() -> GpuInfo | None:
    try:
        import torch
    except ImportError:
        return None

    if not torch.cuda.is_available():
        return None

    index = torch.cuda.current_device()
    properties = torch.cuda.get_device_properties(index)
    free_bytes, total_bytes = torch.cuda.mem_get_info(index)

    return GpuInfo(
        available=True,
        name=properties.name,
        total_vram_mb=int(total_bytes / 1024 / 1024),
        free_vram_mb=int(free_bytes / 1024 / 1024),
        utilization=None,
        driver=None,
        backend="cuda",
        reason=None,
    )


def detect_gpu(min_vram_mb: int = 0) -> GpuInfo:
    info = _query_torch() or _query_nvidia_smi()

    if info is None:
        return GpuInfo(
            available=False,
            name=None,
            total_vram_mb=None,
            free_vram_mb=None,
            utilization=None,
            driver=None,
            backend="cpu",
            reason="Keine CUDA-faehige NVIDIA-GPU im Container sichtbar",
        )

    if min_vram_mb > 0 and info.free_vram_mb is not None and info.free_vram_mb < min_vram_mb:
        return GpuInfo(
            available=False,
            name=info.name,
            total_vram_mb=info.total_vram_mb,
            free_vram_mb=info.free_vram_mb,
            utilization=info.utilization,
            driver=info.driver,
            backend=info.backend,
            reason=f"Nur {info.free_vram_mb} MB freier VRAM, benoetigt werden {min_vram_mb} MB",
        )

    return info
