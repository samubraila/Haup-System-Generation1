from __future__ import annotations

import json
import logging
import signal
import sys
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

import redis

from .api import BackendApi
from .config import WorkerConfig, load_config
from .queue import JobQueue, JobRecord, WORKER_SET, worker_key
from .storage import Storage

POLL_INTERVAL_SEC = 1.0
MAINTENANCE_INTERVAL_SEC = 15.0
HEARTBEAT_INTERVAL_SEC = 10.0
HEARTBEAT_TTL_SEC = 30


class WaitingForGpu(Exception):
    def __init__(self, message: str, retry_in_ms: int) -> None:
        super().__init__(message)
        self.retry_in_ms = retry_in_ms


class PermanentJobError(Exception):
    pass


class JsonFormatter(logging.Formatter):
    def __init__(self, service: str, worker_id: str) -> None:
        super().__init__()
        self.service = service
        self.worker_id = worker_id

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname.lower(),
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "service": self.service,
            "workerId": self.worker_id,
            "msg": record.getMessage(),
        }
        extra = getattr(record, "extra", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["error"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def build_logger(config: WorkerConfig) -> logging.Logger:
    logger = logging.getLogger(config.worker_name)
    logger.setLevel(getattr(logging, config.log_level.upper(), logging.INFO))
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(config.worker_name, config.worker_id))
    logger.handlers = [handler]
    logger.propagate = False
    return logger


@dataclass
class JobContext:
    job: JobRecord
    data: dict[str, Any]
    config: WorkerConfig
    api: BackendApi
    storage: Storage
    logger: logging.Logger
    cancelled: threading.Event
    _report: Callable[[float, str | None], None]

    def report_progress(self, progress: float, message: str | None = None) -> None:
        self._report(progress, message)


class HealthServer:
    def __init__(self, port: int, probe: Callable[[], tuple[bool, dict[str, Any]]]) -> None:
        self.probe = probe

        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                if self.path not in ("/", "/health", "/healthz"):
                    self.send_response(404)
                    self.end_headers()
                    return
                try:
                    ok, detail = outer.probe()
                except Exception as exc:  # noqa: BLE001
                    ok, detail = False, {"error": str(exc)}
                body = json.dumps({"status": "ok" if ok else "degraded", **detail}).encode()
                self.send_response(200 if ok else 503)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args: Any) -> None:
                return

        self.server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.server.shutdown()


def run_worker(
    name: str,
    queue: str,
    handler: Callable[[JobContext], dict[str, Any]],
    on_start: Callable[[WorkerConfig, logging.Logger], dict[str, Any]] | None = None,
    default_concurrency: int = 1,
) -> None:
    config = load_config(name, default_concurrency)
    logger = build_logger(config)

    client = redis.from_url(config.redis_url, decode_responses=True, socket_keepalive=True)
    job_queue = JobQueue(client)
    api = BackendApi(config.backend_url, config.internal_api_key, config.worker_id)
    storage = Storage(config.data_dir, config.storage_mode, api)

    capabilities: dict[str, Any] = {}
    startup_error: str | None = None
    if on_start is not None:
        try:
            capabilities = on_start(config, logger) or {}
        except Exception as exc:  # noqa: BLE001
            startup_error = str(exc)
            logger.error("Initialisierung fehlgeschlagen, Worker laeuft eingeschraenkt weiter", exc_info=True)

    state = {
        "status": "idle",
        "reason": startup_error,
        "current_job": None,
        "processed": 0,
        "failed": 0,
        "started_at": int(time.time() * 1000),
    }
    stop_event = threading.Event()

    def publish_heartbeat() -> None:
        payload = {
            "id": config.worker_id,
            "name": config.worker_name,
            "queue": queue,
            "version": config.version,
            "host": config.host,
            "startedAt": state["started_at"],
            "lastSeen": int(time.time() * 1000),
            "status": state["status"],
            "currentJobId": state["current_job"],
            "concurrency": config.concurrency,
            "capabilities": capabilities,
            "reason": state["reason"],
        }
        pipe = client.pipeline()
        pipe.set(worker_key(config.worker_id), json.dumps(payload), ex=HEARTBEAT_TTL_SEC)
        pipe.sadd(WORKER_SET, config.worker_id)
        pipe.execute()

    def heartbeat_loop() -> None:
        while not stop_event.is_set():
            try:
                publish_heartbeat()
            except Exception:  # noqa: BLE001
                pass
            stop_event.wait(HEARTBEAT_INTERVAL_SEC)

    def maintenance_loop() -> None:
        while not stop_event.is_set():
            try:
                job_queue.promote_delayed(queue)
                recovered = job_queue.reap_stalled(queue)
                if recovered:
                    logger.warning(
                        "Jobs abgestuerzter Worker wiederhergestellt",
                        extra={"extra": {"jobIds": recovered}},
                    )
            except Exception:  # noqa: BLE001
                pass
            stop_event.wait(MAINTENANCE_INTERVAL_SEC)

    def health_probe() -> tuple[bool, dict[str, Any]]:
        try:
            client.ping()
            redis_ok = True
        except Exception:  # noqa: BLE001
            redis_ok = False
        return redis_ok, {
            "worker": config.worker_name,
            "workerId": config.worker_id,
            "queue": queue,
            "redis": "ready" if redis_ok else "down",
            "state": state["status"],
            "reason": state["reason"],
            "processed": state["processed"],
            "failed": state["failed"],
            "capabilities": capabilities,
            "startupError": startup_error,
        }

    health = HealthServer(config.health_port, health_probe)
    health.start()
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    threading.Thread(target=maintenance_loop, daemon=True).start()

    def shutdown(signum: int, _frame: Any) -> None:
        logger.info("Worker faehrt herunter", extra={"extra": {"signal": signum}})
        stop_event.set()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    logger.info(
        "Worker gestartet",
        extra={"extra": {"queue": queue, "storageMode": config.storage_mode, "capabilities": capabilities}},
    )

    while not stop_event.is_set():
        try:
            job = job_queue.reserve(queue, config.worker_id, config.lock_ttl_sec)
        except Exception:  # noqa: BLE001
            logger.error("Queue nicht erreichbar", exc_info=True)
            stop_event.wait(5)
            continue

        if job is None:
            stop_event.wait(POLL_INTERVAL_SEC)
            continue

        state["current_job"] = job.id
        state["status"] = "busy"
        cancelled = threading.Event()
        progress_holder = {"value": 0.0}
        job_stop = threading.Event()

        lock_deadline = time.time() + config.job_timeout_sec

        def lock_loop() -> None:
            while not job_stop.is_set():
                if time.time() >= lock_deadline:
                    logger.error(
                        "Zeitueberschreitung: Sperre wird nicht mehr verlaengert, der Job wird wiederhergestellt",
                        extra={"extra": {"jobId": job.id, "timeoutSec": config.job_timeout_sec}},
                    )
                    return
                try:
                    job_queue.heartbeat(job.id, config.worker_id, config.lock_ttl_sec, int(progress_holder["value"]))
                except Exception:  # noqa: BLE001
                    pass
                job_stop.wait(max(5.0, config.lock_ttl_sec * 0.4))

        lock_thread = threading.Thread(target=lock_loop, daemon=True)
        lock_thread.start()

        def report(progress: float, message: str | None = None) -> None:
            progress_holder["value"] = progress
            if job.ref_id:
                api.report_progress(job.ref_id, progress, message)

        context = JobContext(
            job=job,
            data=job.data,
            config=config,
            api=api,
            storage=storage,
            logger=logger,
            cancelled=cancelled,
            _report=report,
        )

        deadline = time.time() + config.job_timeout_sec
        timer = threading.Timer(config.job_timeout_sec, cancelled.set)
        timer.daemon = True
        timer.start()

        settled = {"done": False}

        def report_safely(what: str, action) -> None:
            try:
                action()
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "Ergebnis konnte nicht an das Backend gemeldet werden",
                    extra={"extra": {"jobId": job.id, "report": what, "error": str(exc)}},
                )

        try:
            if job.ref_id:
                report_safely(
                    "started",
                    lambda: api.report_started(job.ref_id, {"worker": config.worker_name, "attempt": job.attempts}),
                )
            logger.info("Job gestartet", extra={"extra": {"jobId": job.id, "name": job.name}})

            result = handler(context) or {}

            job_queue.complete(queue, job.id)
            settled["done"] = True
            if job.ref_id:
                report_safely("completed", lambda: api.report_completed(job.ref_id, result))
            state["processed"] += 1
            state["status"] = "idle"
            state["reason"] = startup_error
            logger.info("Job abgeschlossen", extra={"extra": {"jobId": job.id}})

        except WaitingForGpu as exc:
            if settled["done"]:
                logger.error(
                    "Fehler nach erfolgreichem Abschluss: der Job wird nicht erneut eingereiht",
                    extra={"extra": {"jobId": job.id, "error": str(exc)}},
                )
                timer.cancel()
                job_stop.set()
                state["current_job"] = None
                continue
            job_queue.park(queue, job.id, "WAITING_FOR_GPU", str(exc), exc.retry_in_ms)
            settled["done"] = True
            if job.ref_id:
                report_safely("status", lambda: api.report_status(job.ref_id, "WAITING_FOR_GPU", str(exc)))
            state["status"] = "degraded"
            state["reason"] = str(exc)
            logger.warning("Job wartet auf GPU", extra={"extra": {"jobId": job.id, "reason": str(exc)}})

        except Exception as exc:  # noqa: BLE001
            if settled["done"]:
                logger.error(
                    "Fehler nach erfolgreichem Abschluss: der Job wird nicht erneut eingereiht",
                    extra={"extra": {"jobId": job.id, "error": str(exc)}},
                )
                timer.cancel()
                job_stop.set()
                state["current_job"] = None
                continue
            permanent = isinstance(exc, PermanentJobError)
            message = "Zeitueberschreitung" if cancelled.is_set() and time.time() >= deadline else str(exc)
            backoff = min(600000, 30000 * 2 ** max(0, job.attempts - 1))
            outcome = job_queue.fail(queue, job.id, message, backoff, permanent)
            settled["done"] = True
            if job.ref_id:
                report_safely("failed", lambda: api.report_failed(job.ref_id, message, outcome == "RETRY"))
            state["failed"] += 1
            state["status"] = "idle"
            logger.error("Job fehlgeschlagen", exc_info=True, extra={"extra": {"jobId": job.id, "willRetry": outcome == "RETRY"}})

        finally:
            timer.cancel()
            job_stop.set()
            state["current_job"] = None

    try:
        client.delete(worker_key(config.worker_id))
        client.srem(WORKER_SET, config.worker_id)
    except Exception:  # noqa: BLE001
        pass
    health.stop()
    logger.info("Worker gestoppt")
