from __future__ import annotations

import time
from typing import Any

import requests


class ApiError(RuntimeError):
    def __init__(self, message: str, status: int, body: str) -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class BackendApi:
    def __init__(self, base_url: str, api_key: str, worker_id: str, timeout: int = 60) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.worker_id = worker_id
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"x-api-key": api_key, "x-worker-id": worker_id})

    def _request(self, method: str, path: str, json_body: Any = None, retries: int = 3, stream: bool = False):
        last_error: Exception | None = None
        for attempt in range(retries + 1):
            try:
                response = self.session.request(
                    method,
                    f"{self.base_url}{path}",
                    json=json_body,
                    timeout=self.timeout,
                    stream=stream,
                )
                if response.status_code >= 400:
                    raise ApiError(
                        f"{method} {path} -> {response.status_code}",
                        response.status_code,
                        response.text[:500],
                    )
                return response
            except ApiError as exc:
                if 400 <= exc.status < 500:
                    raise
                last_error = exc
            except requests.RequestException as exc:
                last_error = exc

            if attempt < retries:
                time.sleep(min(8, 0.5 * 2**attempt))

        raise last_error if last_error else RuntimeError("Unbekannter API-Fehler")

    def report_started(self, job_id: str, meta: dict[str, Any] | None = None) -> None:
        self._request("POST", f"/api/internal/jobs/{job_id}/started", {"workerId": self.worker_id, "meta": meta or {}})

    def report_progress(self, job_id: str, progress: float, message: str | None = None, eta_seconds: int | None = None) -> None:
        try:
            self._request(
                "POST",
                f"/api/internal/jobs/{job_id}/progress",
                {
                    "progress": max(0, min(100, round(progress))),
                    "message": message,
                    "workerId": self.worker_id,
                    "etaSeconds": eta_seconds,
                },
                retries=0,
            )
        except Exception:
            pass

    def report_completed(self, job_id: str, result: dict[str, Any]) -> None:
        self._request("POST", f"/api/internal/jobs/{job_id}/completed", {"workerId": self.worker_id, "result": result})

    def report_failed(self, job_id: str, error: str, will_retry: bool) -> None:
        self._request(
            "POST",
            f"/api/internal/jobs/{job_id}/failed",
            {"workerId": self.worker_id, "error": error[:4000], "willRetry": will_retry},
        )

    def report_status(self, job_id: str, status: str, reason: str | None = None) -> None:
        self._request(
            "POST",
            f"/api/internal/jobs/{job_id}/status",
            {"workerId": self.worker_id, "status": status, "reason": reason},
        )

    def log(self, level: str, message: str, context: dict[str, Any] | None = None) -> None:
        try:
            self._request(
                "POST",
                "/api/internal/logs",
                {"level": level, "source": self.worker_id, "message": message[:4000], "context": context or {}},
                retries=0,
            )
        except Exception:
            pass

    def register_media(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._request("POST", "/api/internal/media", payload)
        return response.json()

    def download_file(self, relative_path: str, target_path: str) -> str:
        response = self._request(
            "GET",
            f"/api/internal/files?path={requests.utils.quote(relative_path, safe='')}",
            stream=True,
        )
        with open(target_path, "wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
        return target_path

    def upload_file(self, relative_path: str, local_path: str, content_type: str = "application/octet-stream") -> None:
        with open(local_path, "rb") as handle:
            response = self.session.put(
                f"{self.base_url}/api/internal/files?path={requests.utils.quote(relative_path, safe='')}",
                data=handle,
                headers={"content-type": content_type},
                timeout=max(self.timeout, 600),
            )
        if response.status_code >= 400:
            raise ApiError(f"PUT /api/internal/files -> {response.status_code}", response.status_code, response.text[:500])
