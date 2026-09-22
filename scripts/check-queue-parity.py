#!/usr/bin/env python3
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TS_FILE = ROOT / "packages" / "worker-core" / "src" / "queue.ts"
PY_FILE = ROOT / "workers" / "_shared" / "acfworker" / "queue.py"

SCRIPTS = ["RESERVE", "COMPLETE", "FAIL", "PARK", "PROMOTE", "REAP"]


def normalize(body: str) -> str:
    lines = []
    for raw in body.strip().splitlines():
        line = re.sub(r"--.*$", "", raw).strip()
        if line:
            lines.append(re.sub(r"\s+", " ", line))
    return "\n".join(lines)


def extract_ts(text: str) -> dict[str, str]:
    found = {}
    for name in SCRIPTS:
        match = re.search(rf"const LUA_{name} = `(.*?)`;", text, re.DOTALL)
        if match:
            found[name] = normalize(match.group(1))
    return found


def extract_py(text: str) -> dict[str, str]:
    found = {}
    for name in SCRIPTS:
        match = re.search(rf'LUA_{name} = """(.*?)"""', text, re.DOTALL)
        if match:
            found[name] = normalize(match.group(1))
    return found


def extract_constants(text: str, patterns: dict[str, str]) -> dict[str, str]:
    found = {}
    for key, pattern in patterns.items():
        match = re.search(pattern, text)
        if match:
            found[key] = match.group(1)
    return found


def main() -> int:
    if not TS_FILE.exists() or not PY_FILE.exists():
        print(f"Datei fehlt: {TS_FILE if not TS_FILE.exists() else PY_FILE}")
        return 1

    ts_text = TS_FILE.read_text(encoding="utf-8")
    py_text = PY_FILE.read_text(encoding="utf-8")

    ts = extract_ts(ts_text)
    py = extract_py(py_text)

    problems = []

    for name in SCRIPTS:
        if name not in ts:
            problems.append(f"LUA_{name} fehlt in queue.ts")
            continue
        if name not in py:
            problems.append(f"LUA_{name} fehlt in queue.py")
            continue
        if ts[name] != py[name]:
            problems.append(f"LUA_{name} weicht ab zwischen queue.ts und queue.py")
            ts_lines = ts[name].splitlines()
            py_lines = py[name].splitlines()
            for index in range(max(len(ts_lines), len(py_lines))):
                a = ts_lines[index] if index < len(ts_lines) else "<fehlt>"
                b = py_lines[index] if index < len(py_lines) else "<fehlt>"
                if a != b:
                    problems.append(f"    Zeile {index + 1}")
                    problems.append(f"      ts: {a}")
                    problems.append(f"      py: {b}")

    ts_constants = extract_constants(
        ts_text,
        {
            "prefix": r"export const KEY_PREFIX = '([^']+)'",
            "ttl_completed": r"const TTL_COMPLETED_SEC = ([^;]+);",
            "ttl_failed": r"const TTL_FAILED_SEC = ([^;]+);",
        },
    )
    py_constants = extract_constants(
        py_text,
        {
            "prefix": r'KEY_PREFIX = "([^"]+)"',
            "ttl_completed": r"TTL_COMPLETED_SEC = (.+)",
            "ttl_failed": r"TTL_FAILED_SEC = (.+)",
        },
    )

    def as_number(value: str) -> int | None:
        try:
            return int(eval(value.strip(), {"__builtins__": {}}, {}))
        except Exception:
            return None

    if ts_constants.get("prefix") != py_constants.get("prefix"):
        problems.append(
            f"KEY_PREFIX weicht ab: ts={ts_constants.get('prefix')} py={py_constants.get('prefix')}"
        )

    for key in ("ttl_completed", "ttl_failed"):
        a = as_number(ts_constants.get(key, ""))
        b = as_number(py_constants.get(key, ""))
        if a is None or b is None or a != b:
            problems.append(f"{key.upper()} weicht ab: ts={a} py={b}")

    if problems:
        print("Queue-Protokoll stimmt nicht ueberein:\n")
        for line in problems:
            print(f"  {line}")
        print(
            "\nTypeScript- und Python-Worker teilen sich dieselbe Redis-Queue. "
            "Weichen die Lua-Skripte ab, verlieren oder verdoppeln sich Jobs."
        )
        return 1

    print(f"Queue-Protokoll stimmt ueberein ({len(SCRIPTS)} Lua-Skripte, KEY_PREFIX, TTLs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
