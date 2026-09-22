from __future__ import annotations

from dataclasses import dataclass

from .srt import Cue


@dataclass
class Word:
    start: float
    end: float
    text: str


ALIGNMENT = {"bottom": 2, "center": 5, "top": 8}


def hex_to_ass(color: str, alpha: str = "00") -> str:
    clean = color.replace("#", "").strip()
    if len(clean) == 3:
        clean = "".join(char * 2 for char in clean)
    clean = (clean + "000000")[:6]
    red, green, blue = clean[0:2], clean[2:4], clean[4:6]
    return f"&H{alpha}{blue}{green}{red}".upper()


def format_time(seconds: float) -> str:
    if seconds < 0:
        seconds = 0.0
    centis = int(round(seconds * 100))
    hours, centis = divmod(centis, 360000)
    minutes, centis = divmod(centis, 6000)
    secs, centis = divmod(centis, 100)
    return f"{hours:d}:{minutes:02d}:{secs:02d}.{centis:02d}"


def escape_text(text: str) -> str:
    return text.replace("{", "(").replace("}", ")").replace("\n", "\\N")


def build_header(style: dict, width: int, height: int) -> str:
    font = style.get("font") or "DejaVu Sans"
    scale = height / 1920
    font_size = max(14, int(round(float(style.get("fontSize") or 48) * scale)))
    margin_v = max(0, int(round(float(style.get("marginVertical") or 120) * scale)))
    margin_h = max(20, int(round(width * 0.06)))

    primary = style.get("primaryColor") or "#FFFFFF"
    outline = style.get("outlineColor") or "#000000"
    highlight = style.get("highlightColor") or "#FACC15"
    background = style.get("backgroundColor")
    animation = style.get("animation") or "none"
    bold = 1 if style.get("bold", True) else 0
    alignment = ALIGNMENT.get(str(style.get("position") or "bottom"), 2)

    if animation == "karaoke":
        primary_colour = hex_to_ass(highlight)
        secondary_colour = hex_to_ass(primary)
    else:
        primary_colour = hex_to_ass(primary)
        secondary_colour = hex_to_ass(highlight)

    border_style = 3 if background else 1
    back_colour = hex_to_ass(background, "40") if background else "&H80000000"

    return "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            f"PlayResX: {width}",
            f"PlayResY: {height}",
            "WrapStyle: 2",
            "ScaledBorderAndShadow: yes",
            "YCbCr Matrix: TV.709",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
            "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
            "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            f"Style: Default,{font},{font_size},{primary_colour},{secondary_colour},{hex_to_ass(outline)},"
            f"{back_colour},{bold},0,0,0,100,100,0,0,{border_style},3,1,{alignment},"
            f"{margin_h},{margin_h},{margin_v},1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]
    )


def _dialogue(start: float, end: float, text: str) -> str:
    return f"Dialogue: 0,{format_time(start)},{format_time(end)},Default,,0,0,0,,{text}"


def render_ass(cues: list[Cue], words: list[Word], style: dict, width: int, height: int) -> str:
    animation = str(style.get("animation") or "none")
    lines = [build_header(style, width, height)]

    if animation == "pop" and words:
        for word in words:
            end = max(word.end, word.start + 0.12)
            text = escape_text(word.text.strip())
            if not text:
                continue
            lines.append(
                _dialogue(
                    word.start,
                    end,
                    r"{\fscx118\fscy118\t(0,110,\fscx100\fscy100)\fad(60,60)}" + text,
                )
            )
        return "\n".join(lines) + "\n"

    for cue in cues:
        text = escape_text(cue.text.strip())
        if not text:
            continue

        if animation == "karaoke" and words:
            inside = [w for w in words if w.start >= cue.start - 0.05 and w.end <= cue.end + 0.05]
            if inside:
                parts = []
                cursor = cue.start
                for word in inside:
                    gap = max(0, int(round((word.start - cursor) * 100)))
                    if gap:
                        parts.append(r"{\k" + str(gap) + "}")
                    duration = max(1, int(round((word.end - word.start) * 100)))
                    parts.append(r"{\k" + str(duration) + "}" + escape_text(word.text.strip()) + " ")
                    cursor = word.end
                lines.append(_dialogue(cue.start, cue.end, "".join(parts).strip()))
                continue

        prefix = r"{\fad(120,120)}" if animation in ("fade", "karaoke") else ""
        lines.append(_dialogue(cue.start, cue.end, prefix + text))

    return "\n".join(lines) + "\n"
