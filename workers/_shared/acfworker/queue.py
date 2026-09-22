from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import redis

KEY_PREFIX = "acf"
TTL_COMPLETED_SEC = 24 * 60 * 60
TTL_FAILED_SEC = 7 * 24 * 60 * 60


def waiting_key(queue: str) -> str:
    return f"{KEY_PREFIX}:q:{queue}:waiting"


def active_key(queue: str) -> str:
    return f"{KEY_PREFIX}:q:{queue}:active"


def delayed_key(queue: str) -> str:
    return f"{KEY_PREFIX}:q:{queue}:delayed"


def failed_key(queue: str) -> str:
    return f"{KEY_PREFIX}:q:{queue}:failed"


def job_key(job_id: str) -> str:
    return f"{KEY_PREFIX}:job:{job_id}"


def lock_key(job_id: str) -> str:
    return f"{KEY_PREFIX}:lock:{job_id}"


def worker_key(worker_id: str) -> str:
    return f"{KEY_PREFIX}:worker:{worker_id}"


WORKER_SET = f"{KEY_PREFIX}:workers"

LUA_RESERVE = """
local popped = redis.call('ZPOPMIN', KEYS[1], 1)
if #popped == 0 then return nil end
local jobId = popped[1]
local jobKey = ARGV[4] .. jobId
if redis.call('EXISTS', jobKey) == 0 then
  return nil
end
redis.call('LPUSH', KEYS[2], jobId)
redis.call('SET', ARGV[5] .. jobId, ARGV[1], 'EX', tonumber(ARGV[2]))
redis.call('HSET', jobKey,
  'status', 'RUNNING',
  'lockedBy', ARGV[1],
  'startedAt', ARGV[3],
  'updatedAt', ARGV[3],
  'error', '')
redis.call('HINCRBY', jobKey, 'attempts', 1)
redis.call('PERSIST', jobKey)
return redis.call('HGETALL', jobKey)
"""

LUA_COMPLETE = """
redis.call('LREM', KEYS[2], 1, ARGV[1])
redis.call('DEL', ARGV[4] .. ARGV[1])
local jobKey = ARGV[3] .. ARGV[1]
redis.call('HSET', jobKey, 'status', 'COMPLETED', 'progress', '100', 'updatedAt', ARGV[2], 'lockedBy', '')
redis.call('EXPIRE', jobKey, tonumber(ARGV[5]))
return 1
"""

LUA_FAIL = """
local jobId = ARGV[1]
local now = tonumber(ARGV[2])
local jobKey = ARGV[3] .. jobId
redis.call('LREM', KEYS[2], 1, jobId)
redis.call('DEL', ARGV[4] .. jobId)
if redis.call('EXISTS', jobKey) == 0 then return 'GONE' end
local status = redis.call('HGET', jobKey, 'status')
if status == 'CANCELLED' then return 'CANCELLED' end
local attempts = tonumber(redis.call('HGET', jobKey, 'attempts') or '0')
local maxAttempts = tonumber(redis.call('HGET', jobKey, 'maxAttempts') or '1')
local permanent = ARGV[7] == '1'
if permanent or attempts >= maxAttempts then
  redis.call('HSET', jobKey, 'status', 'FAILED', 'error', ARGV[5], 'updatedAt', ARGV[2], 'lockedBy', '')
  redis.call('LPUSH', KEYS[3], jobId)
  redis.call('LTRIM', KEYS[3], 0, 499)
  redis.call('EXPIRE', jobKey, tonumber(ARGV[8]))
  return 'FAILED'
end
redis.call('HSET', jobKey, 'status', 'PENDING', 'error', ARGV[5], 'updatedAt', ARGV[2], 'lockedBy', '')
redis.call('ZADD', KEYS[4], now + tonumber(ARGV[6]), jobId)
return 'RETRY'
"""

LUA_PARK = """
local jobId = ARGV[1]
local jobKey = ARGV[3] .. jobId
redis.call('LREM', KEYS[2], 1, jobId)
redis.call('DEL', ARGV[4] .. jobId)
if redis.call('EXISTS', jobKey) == 0 then return 'GONE' end
local status = redis.call('HGET', jobKey, 'status')
if status == 'CANCELLED' then return 'CANCELLED' end
redis.call('HINCRBY', jobKey, 'attempts', -1)
redis.call('HSET', jobKey, 'status', ARGV[6], 'error', ARGV[5], 'updatedAt', ARGV[2], 'lockedBy', '')
redis.call('ZADD', KEYS[4], tonumber(ARGV[2]) + tonumber(ARGV[7]), jobId)
return 'PARKED'
"""

LUA_PROMOTE = """
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 200)
local moved = 0
for _, jobId in ipairs(due) do
  if redis.call('ZREM', KEYS[1], jobId) == 1 then
    local jobKey = ARGV[2] .. jobId
    if redis.call('EXISTS', jobKey) == 1 then
      local priority = tonumber(redis.call('HGET', jobKey, 'priority') or '0')
      local createdAt = tonumber(redis.call('HGET', jobKey, 'createdAt') or ARGV[1])
      local score = string.format('%.0f', (9 - priority) * 1e13 + createdAt)
      redis.call('ZADD', KEYS[2], score, jobId)
      redis.call('HSET', jobKey, 'status', 'PENDING', 'updatedAt', ARGV[1])
      moved = moved + 1
    end
  end
end
return moved
"""

LUA_REAP = """
local ids = redis.call('LRANGE', KEYS[2], 0, -1)
local requeued = {}
for _, jobId in ipairs(ids) do
  if redis.call('EXISTS', ARGV[3] .. jobId) == 0 then
    redis.call('LREM', KEYS[2], 1, jobId)
    local jobKey = ARGV[2] .. jobId
    if redis.call('EXISTS', jobKey) == 1 then
      local attempts = tonumber(redis.call('HGET', jobKey, 'attempts') or '0')
      local maxAttempts = tonumber(redis.call('HGET', jobKey, 'maxAttempts') or '1')
      if attempts >= maxAttempts then
        redis.call('HSET', jobKey, 'status', 'FAILED', 'error', 'Worker abgestuerzt, keine Versuche mehr uebrig', 'updatedAt', ARGV[1])
        redis.call('LPUSH', KEYS[3], jobId)
        redis.call('EXPIRE', jobKey, tonumber(ARGV[4]))
      else
        local priority = tonumber(redis.call('HGET', jobKey, 'priority') or '0')
        local createdAt = tonumber(redis.call('HGET', jobKey, 'createdAt') or ARGV[1])
        redis.call('HSET', jobKey, 'status', 'PENDING', 'error', 'Worker abgestuerzt, Job wiederhergestellt', 'updatedAt', ARGV[1], 'lockedBy', '')
        redis.call('ZADD', KEYS[1], string.format('%.0f', (9 - priority) * 1e13 + createdAt), jobId)
      end
      table.insert(requeued, jobId)
    end
  end
end
return requeued
"""


@dataclass
class JobRecord:
    id: str
    queue: str
    name: str
    data: dict[str, Any]
    attempts: int
    max_attempts: int
    status: str
    progress: int
    ref_id: str | None
    priority: int
    created_at: int
    updated_at: int
    started_at: int | None
    locked_by: str | None
    error: str | None
    raw: dict[str, str] = field(default_factory=dict)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _score_for(priority: int, created_at: int) -> float:
    clamped = max(0, min(9, int(priority)))
    return (9 - clamped) * 1e13 + created_at


def _to_record(flat: list[str] | dict[str, str] | None) -> JobRecord | None:
    if not flat:
        return None
    if isinstance(flat, list):
        hash_map = {flat[i]: flat[i + 1] for i in range(0, len(flat) - 1, 2)}
    else:
        hash_map = flat
    if not hash_map.get("id"):
        return None

    try:
        data = json.loads(hash_map.get("data") or "{}")
    except json.JSONDecodeError:
        data = {}

    return JobRecord(
        id=hash_map["id"],
        queue=hash_map.get("queue", ""),
        name=hash_map.get("name", ""),
        data=data,
        attempts=int(hash_map.get("attempts") or 0),
        max_attempts=int(hash_map.get("maxAttempts") or 1),
        status=hash_map.get("status", "PENDING"),
        progress=int(hash_map.get("progress") or 0),
        ref_id=hash_map.get("refId") or None,
        priority=int(hash_map.get("priority") or 0),
        created_at=int(hash_map.get("createdAt") or 0),
        updated_at=int(hash_map.get("updatedAt") or 0),
        started_at=int(hash_map["startedAt"]) if hash_map.get("startedAt") else None,
        locked_by=hash_map.get("lockedBy") or None,
        error=hash_map.get("error") or None,
        raw=hash_map,
    )


class JobQueue:
    def __init__(self, client: redis.Redis) -> None:
        self.redis = client
        self._reserve = client.register_script(LUA_RESERVE)
        self._complete = client.register_script(LUA_COMPLETE)
        self._fail = client.register_script(LUA_FAIL)
        self._park = client.register_script(LUA_PARK)
        self._promote = client.register_script(LUA_PROMOTE)
        self._reap = client.register_script(LUA_REAP)

    def enqueue(
        self,
        queue: str,
        name: str,
        data: dict[str, Any],
        ref_id: str | None = None,
        priority: int = 0,
        max_attempts: int = 3,
        delay_ms: int = 0,
    ) -> str:
        now = _now_ms()
        job_id = str(uuid.uuid4())
        record = {
            "id": job_id,
            "queue": queue,
            "name": name,
            "data": json.dumps(data),
            "attempts": "0",
            "maxAttempts": str(max_attempts),
            "status": "PENDING",
            "progress": "0",
            "refId": ref_id or "",
            "priority": str(priority),
            "createdAt": str(now),
            "updatedAt": str(now),
            "startedAt": "",
            "lockedBy": "",
            "error": "",
        }
        pipe = self.redis.pipeline()
        pipe.hset(job_key(job_id), mapping=record)
        if delay_ms > 0:
            pipe.zadd(delayed_key(queue), {job_id: now + delay_ms})
        else:
            pipe.zadd(waiting_key(queue), {job_id: _score_for(priority, now)})
        pipe.execute()
        return job_id

    def reserve(self, queue: str, worker_id: str, lock_ttl_sec: int) -> JobRecord | None:
        result = self._reserve(
            keys=[waiting_key(queue), active_key(queue)],
            args=[worker_id, str(lock_ttl_sec), str(_now_ms()), f"{KEY_PREFIX}:job:", f"{KEY_PREFIX}:lock:"],
        )
        return _to_record(result)

    def heartbeat(self, job_id: str, worker_id: str, lock_ttl_sec: int, progress: int | None = None) -> None:
        pipe = self.redis.pipeline()
        pipe.set(lock_key(job_id), worker_id, ex=lock_ttl_sec)
        if progress is not None:
            pipe.hset(job_key(job_id), mapping={"progress": str(int(progress)), "updatedAt": str(_now_ms())})
        pipe.execute()

    def complete(self, queue: str, job_id: str) -> None:
        self._complete(
            keys=[job_key(job_id), active_key(queue)],
            args=[job_id, str(_now_ms()), f"{KEY_PREFIX}:job:", f"{KEY_PREFIX}:lock:", str(TTL_COMPLETED_SEC)],
        )

    def fail(self, queue: str, job_id: str, error: str, backoff_ms: int = 30000, permanent: bool = False) -> str:
        result = self._fail(
            keys=[job_key(job_id), active_key(queue), failed_key(queue), delayed_key(queue)],
            args=[
                job_id,
                str(_now_ms()),
                f"{KEY_PREFIX}:job:",
                f"{KEY_PREFIX}:lock:",
                error[:2000],
                str(backoff_ms),
                "1" if permanent else "0",
                str(TTL_FAILED_SEC),
            ],
        )
        return result.decode() if isinstance(result, bytes) else str(result)

    def park(self, queue: str, job_id: str, status: str, reason: str, retry_in_ms: int) -> None:
        self._park(
            keys=[job_key(job_id), active_key(queue), failed_key(queue), delayed_key(queue)],
            args=[
                job_id,
                str(_now_ms()),
                f"{KEY_PREFIX}:job:",
                f"{KEY_PREFIX}:lock:",
                reason[:500],
                status,
                str(retry_in_ms),
            ],
        )

    def promote_delayed(self, queue: str) -> int:
        result = self._promote(
            keys=[delayed_key(queue), waiting_key(queue)],
            args=[str(_now_ms()), f"{KEY_PREFIX}:job:"],
        )
        return int(result or 0)

    def reap_stalled(self, queue: str) -> list[str]:
        result = self._reap(
            keys=[waiting_key(queue), active_key(queue), failed_key(queue)],
            args=[str(_now_ms()), f"{KEY_PREFIX}:job:", f"{KEY_PREFIX}:lock:", str(TTL_FAILED_SEC)],
        )
        return [item.decode() if isinstance(item, bytes) else str(item) for item in (result or [])]
