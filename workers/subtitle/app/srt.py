from __future__ import annotations

import textwrap
from dataclasses import dataclass


@dataclass
class Cue:
    index: int
    start: float
    end: float
    text: str


def format_timestamp(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    milliseconds = int(round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{milliseconds:03d}"


def wrap_text(text: str, max_chars: int, max_lines: int = 2) -> str:
    cleaned = " ".join(text.split())
    if not cleaned:
        return ""
    lines = textwrap.wrap(cleaned, width=max(12, max_chars))
    if len(lines) > max_lines:
        merged = lines[: max_lines - 1]
        merged.append(" ".join(lines[max_lines - 1 :]))
        lines = merged
    return "\n".join(lines)


def build_cues(
    segments: list[tuple[float, float, str]],
    max_chars: int,
    uppercase: bool,
    max_cue_sec: float = 6.0,
) -> list[Cue]:
    cues: list[Cue] = []
    index = 1

    for start, end, text in segments:
        content = text.strip()
        if not content:
            continue
        if uppercase:
            content = content.upper()

        duration = max(0.4, end - start)
        chunks = max(1, int(duration // max_cue_sec) + (1 if duration % max_cue_sec > 0.5 else 0))

        if chunks == 1:
            cues.append(Cue(index, start, end, wrap_text(content, max_chars)))
            index += 1
            continue

        words = content.split()
        per_chunk = max(1, len(words) // chunks)
        chunk_duration = duration / chunks

        for chunk_index in range(chunks):
            slice_start = chunk_index * per_chunk
            slice_end = len(words) if chunk_index == chunks - 1 else (chunk_index + 1) * per_chunk
            piece = " ".join(words[slice_start:slice_end])
            if not piece:
                continue
            cue_start = start + chunk_index * chunk_duration
            cue_end = min(end, cue_start + chunk_duration)
            cues.append(Cue(index, cue_start, cue_end, wrap_text(piece, max_chars)))
            index += 1

    return cues


def render_srt(cues: list[Cue]) -> str:
    blocks = []
    for cue in cues:
        blocks.append(
            f"{cue.index}\n{format_timestamp(cue.start)} --> {format_timestamp(cue.end)}\n{cue.text}\n"
        )
    return "\n".join(blocks)


def render_vtt(cues: list[Cue]) -> str:
    blocks = ["WEBVTT", ""]
    for cue in cues:
        start = format_timestamp(cue.start).replace(",", ".")
        end = format_timestamp(cue.end).replace(",", ".")
        blocks.append(f"{start} --> {end}\n{cue.text}\n")
    return "\n".join(blocks)
