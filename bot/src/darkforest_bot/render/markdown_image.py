"""Pillow Markdown → PNG renderer for QQ bot help-image replies.

Renders a small, intentional subset of Markdown into a readable PNG:
- ATX headings (``#`` / ``##`` / ``###``)
- Unordered list items (``-`` / ``*``), with basic indentation
- Fenced code blocks (`` ``` `` ... `` ``` ``)
- Inline code (`` `code` ``)
- Bold (``**bold**``)
- Paragraphs and blank lines

Any other Markdown syntax is rendered verbatim as plain text. This renderer
exists to make ``.help img`` output into a scannable card, not to be a general
Markdown engine.

Design notes (mirroring ``render/starmap.py``):
- The renderer never raises. Font missing, unknown syntax, or any other
  rendering error falls back to a safe default; the caller receives valid PNG
  bytes regardless of input quality.
- Chinese-capable font loading and supersampling are shared with the starmap
  renderer via ``darkforest_bot.render.starmap``.
- Pillow's font types (``ImageFont.FreeTypeFont``) are annotated loosely as
  ``ImageFont.ImageFont`` because they share no common base class.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field

from loguru import logger
from PIL import Image, ImageDraw, ImageFont

from darkforest_bot.render.starmap import _SS, _load_font

# ---------------------------------------------------------------------------
# Palette: low-saturation dark theme, matches the starmap renderer's identity.
# No pure black / pure white; no neon.
# ---------------------------------------------------------------------------
_BG = "#0f172a"           # deep slate canvas (same as starmap)
_TEXT = "#e2e8f0"         # body text
_H1_COLOR = "#f59e0b"     # amber accent — top title
_H2_COLOR = "#94a3b8"     # slate-400 — section headings
_H3_COLOR = "#cbd5e1"     # slate-300 — subsection / command headings
_BOLD_COLOR = "#f1f5f9"   # slate-100 — emphasized text
_CODE_BG = "#1e293b"      # inset background for code
_CODE_TEXT = "#a5b4fc"    # indigo-300 — code foreground
_BULLET_COLOR = "#64748b" # slate-500 — list markers

# ---------------------------------------------------------------------------
# Typography / layout constants (base units; multiplied by _SS at render time).
# ---------------------------------------------------------------------------
_BODY_SIZE = 18
_H1_SIZE = 28
_H2_SIZE = 23
_H3_SIZE = 19
_PADDING = 28
_BLOCK_GAP = 10
_BULLET_SPACE = 16
_CODE_PAD = 6
_CODE_INSET = 4

_DEFAULT_FONT_PATH = "C:\\Windows\\Fonts\\msyh.ttc"

_Font = ImageFont.FreeTypeFont | ImageFont.ImageFont


@dataclass(frozen=True)
class _Block:
    """A parsed Markdown block.

    ``kind`` is one of ``"blank"`` / ``"heading"`` / ``"bullet"`` /
    ``"para"`` / ``"code"``. For headings ``level`` is 1-3; for bullets
    ``level`` is the indentation depth; ``runs`` are inline runs for
    text-bearing blocks; ``lines`` holds raw code lines for code blocks.
    """

    kind: str
    level: int = 0
    runs: list[tuple[str, str]] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class _LaidLine:
    """A fully positioned text line ready for drawing."""

    y: int
    x: float
    size: int
    runs: list[tuple[str, str]]
    kind: str
    marker: bool = False


@dataclass(frozen=True)
class _Layout:
    """Result of the measurement pass: canvas dimensions + draw primitives."""

    width_px: int
    height_px: int
    lines: list[_LaidLine]
    code_boxes: list[tuple[int, int, int, int]]


def render_markdown(
    markdown_text: str,
    *,
    width: int = 900,
    font_path: str = _DEFAULT_FONT_PATH,
) -> bytes:
    """Render ``markdown_text`` to PNG bytes.

    Args:
        markdown_text: A Markdown-subset document (can be plain text).
        width: Output image width in pixels. Height is computed from content.
        font_path: Path to a TrueType font that supports Chinese glyphs.
            Defaults to Microsoft YaHei on Windows; falls back to ``simhei.ttf``
            then Pillow's default font (see ``starmap._load_font``).

    Returns:
        PNG image bytes. Always returns valid PNG; never raises.
    """
    try:
        return _render_inner(markdown_text, width=width, font_path=font_path)
    except Exception as exc:  # noqa: BLE001 — render must never raise
        logger.exception("markdown render failed, returning error placeholder PNG: {}", exc)
        return _render_error_placeholder(width, font_path, exc)


def _render_inner(markdown_text: str, *, width: int, font_path: str) -> bytes:
    """Actual rendering logic. May raise; caller wraps in try/except."""
    blocks = _parse_blocks(markdown_text)

    # A tiny probe image provides an ImageDraw only for text measurement.
    probe = Image.new("RGBA", (8, 8), _BG)
    measure = ImageDraw.Draw(probe)
    layout = _layout_blocks(measure, blocks, font_path, width)

    # Round canvas height up to a multiple of _SS so LANCZOS downsampling has
    # an exact integer target height.
    canvas_h = ((layout.height_px + _SS - 1) // _SS) * _SS

    img = Image.new("RGBA", (width * _SS, canvas_h), _BG)
    draw = ImageDraw.Draw(img)

    for x0, y0, x1, y1 in layout.code_boxes:
        draw.rectangle([x0, y0, x1, y1], fill=_CODE_BG)

    _draw_lines(draw, layout, font_path)

    img = img.resize((width, canvas_h // _SS), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _parse_blocks(text: str) -> list[_Block]:
    """Split ``text`` into a list of Markdown blocks."""
    blocks: list[_Block] = []
    lines = text.splitlines()
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            blocks.append(_Block(kind="blank"))
            i += 1
            continue

        m = re.match(r"^(#{1,3})\s+(.*)$", stripped)
        if m:
            blocks.append(
                _Block(kind="heading", level=len(m.group(1)), runs=_parse_inline(m.group(2)))
            )
            i += 1
            continue

        if stripped.startswith("```"):
            code_lines: list[str] = []
            i += 1
            while i < n and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            if i < n:
                i += 1  # skip closing fence
            blocks.append(_Block(kind="code", lines=code_lines))
            continue

        m = re.match(r"^(\s*)[-*]\s+(.*)$", line)
        if m:
            blocks.append(
                _Block(
                    kind="bullet",
                    level=len(m.group(1)),
                    runs=_parse_inline(m.group(2)),
                )
            )
            i += 1
            continue

        blocks.append(_Block(kind="para", runs=_parse_inline(stripped)))
        i += 1
    return blocks


def _parse_inline(text: str) -> list[tuple[str, str]]:
    """Split a line into ``(style, text)`` runs.

    Supports ``**bold**`` and inline ``code``. Inside a code run every character
    (including ``**`` and backticks) is treated literally.
    """
    runs: list[tuple[str, str]] = []
    buf: list[str] = []
    i = 0
    n = len(text)
    style = "normal"
    while i < n:
        ch = text[i]
        if style == "normal":
            if text.startswith("**", i):
                if buf:
                    runs.append(("normal", "".join(buf)))
                    buf = []
                style = "bold"
                i += 2
                continue
            if ch == "`":
                if buf:
                    runs.append(("normal", "".join(buf)))
                    buf = []
                style = "code"
                i += 1
                continue
        elif style == "bold":
            if text.startswith("**", i):
                if buf:
                    runs.append(("bold", "".join(buf)))
                    buf = []
                style = "normal"
                i += 2
                continue
        else:  # style == "code"
            if ch == "`":
                if buf:
                    runs.append(("code", "".join(buf)))
                    buf = []
                style = "normal"
                i += 1
                continue
        buf.append(ch)
        i += 1
    if buf:
        runs.append((style, "".join(buf)))
    return runs


def _wrap_runs(
    draw: ImageDraw.ImageDraw,
    runs: list[tuple[str, str]],
    font: _Font,
    max_width: float,
) -> list[list[tuple[str, str]]]:
    """Wrap ``runs`` into lines no wider than ``max_width``.

    Iterates character by character so CJK text (which has no spaces) wraps at
    the character boundary, while Latin text prefers breaking after a space.
    """
    lines: list[list[tuple[str, str]]] = []
    cur: list[tuple[str, str]] = []
    cur_w = 0.0
    break_after: int | None = None  # index into ``cur`` we may break after
    for style, text in runs:
        for ch in text:
            cw = draw.textlength(ch, font=font)
            if cur and cur_w + cw > max_width:
                if break_after is not None and break_after > 0:
                    # Break at the last space so words are not split.
                    split = cur[:break_after]
                    lines.append(split)
                    cur = cur[break_after:]
                    cur_w = sum(draw.textlength(t, font=font) for _s, t in cur)
                else:
                    # No space to break on (CJK or a long token): break per char.
                    lines.append(cur)
                    cur = []
                    cur_w = 0.0
                break_after = None
            if cur and cur[-1][0] == style:
                cur[-1] = (style, cur[-1][1] + ch)
            else:
                cur.append((style, ch))
            cur_w += cw
            if ch == " ":
                break_after = len(cur)
    if cur:
        lines.append(cur)
    return _strip_line_leading_space(lines)


def _strip_line_leading_space(lines: list[list[tuple[str, str]]]) -> list[list[tuple[str, str]]]:
    """Remove leading spaces at the start of each wrapped line (cosmetic)."""
    for line in lines:
        if line and line[0][1].startswith(" "):
            line[0] = (line[0][0], line[0][1].lstrip(" "))
    return lines


def _heading_size(level: int) -> int:
    """Map an ATX level (1-3) to a base font size."""
    return {1: _H1_SIZE, 2: _H2_SIZE, 3: _H3_SIZE}.get(level, _H2_SIZE)


def _line_height(size: int) -> int:
    """Line height for a font of ``size`` pixels, with breathing room."""
    return max(size + 6, int(size * 1.5))


def _layout_blocks(
    draw: ImageDraw.ImageDraw,
    blocks: list[_Block],
    font_path: str,
    width: int,
) -> _Layout:
    """Measure all blocks and produce draw primitives (no image yet).

    ``draw`` is used only for its ``textlength`` measurements.
    """
    ss = _SS
    content_width = max(20, width * ss - 2 * _PADDING * ss)

    lines: list[_LaidLine] = []
    code_boxes: list[tuple[int, int, int, int]] = []
    y = _PADDING * ss

    for block in blocks:
        if block.kind == "blank":
            y += _BLOCK_GAP * ss
            continue

        if block.kind == "heading":
            size = _heading_size(block.level) * ss
            font = _load_font(font_path, size)
            lh = _line_height(size)
            for runs in _wrap_runs(draw, block.runs, font, content_width):
                lines.append(
                    _LaidLine(y=y, x=_PADDING * ss, size=size, runs=runs, kind=f"h{block.level}")
                )
                y += lh
            y += _BLOCK_GAP * ss
            continue

        if block.kind == "bullet":
            size = _BODY_SIZE * ss
            font = _load_font(font_path, size)
            lh = _line_height(size)
            marker_x = _PADDING * ss + block.level * _BULLET_SPACE * ss
            text_x = marker_x + _BULLET_SPACE * ss
            avail = content_width - (text_x - _PADDING * ss)
            first = True
            for runs in _wrap_runs(draw, block.runs, font, avail):
                lines.append(
                    _LaidLine(
                        y=y,
                        x=text_x,
                        size=size,
                        runs=runs,
                        kind="bullet",
                        marker=first,
                    )
                )
                first = False
                y += lh
            y += _BLOCK_GAP * ss
            continue

        if block.kind == "code":
            size = (_BODY_SIZE - 1) * ss
            font = _load_font(font_path, size)
            lh = _line_height(size)
            box_top = y + 2 * ss
            y = box_top
            for line in block.lines:
                lines.append(
                    _LaidLine(
                        y=y,
                        x=_PADDING * ss + _CODE_INSET * ss,
                        size=size,
                        runs=_parse_inline(line),
                        kind="code",
                    )
                )
                y += lh
            code_boxes.append(
                    (
                        _PADDING * ss,
                        box_top - 2 * ss,
                        width * ss - _PADDING * ss,
                        y + 2 * ss,
                    )
                )
            y += _BLOCK_GAP * ss + 2 * ss
            continue

        # paragraph
        size = _BODY_SIZE * ss
        font = _load_font(font_path, size)
        lh = _line_height(size)
        for runs in _wrap_runs(draw, block.runs, font, content_width):
            lines.append(_LaidLine(y=y, x=_PADDING * ss, size=size, runs=runs, kind="para"))
            y += lh
        y += _BLOCK_GAP * ss

    return _Layout(width * ss, y + _PADDING * ss, lines, code_boxes)


def _run_color(style: str, kind: str) -> str:
    """Resolve the drawing color for an inline run in a given line kind."""
    if style == "code":
        return _CODE_TEXT
    if style == "bold":
        return _BOLD_COLOR
    if kind == "h1":
        return _H1_COLOR
    if kind == "h2":
        return _H2_COLOR
    if kind == "h3":
        return _H3_COLOR
    if kind == "code":
        return _CODE_TEXT
    return _TEXT


def _draw_lines(draw: ImageDraw.ImageDraw, layout: _Layout, font_path: str) -> None:
    """Draw every text line in ``layout`` onto an already-created canvas."""
    ss = _SS
    for line in layout.lines:
        font = _load_font(font_path, line.size)
        x = line.x
        for style, text in line.runs:
            color = _run_color(style, line.kind)
            if style == "bold":
                draw.text(
                    (x, line.y),
                    text,
                    fill=color,
                    font=font,
                    stroke_width=max(1, line.size // 18),
                    stroke_fill=color,
                )
                x += draw.textlength(text, font=font)
            elif style == "code":
                w = draw.textlength(text, font=font)
                draw.rectangle(
                    [
                        x - _CODE_PAD * ss,
                        line.y - 2 * ss,
                        x + w + _CODE_PAD * ss,
                        line.y + int(line.size * 1.25) + 2 * ss,
                    ],
                    fill=_CODE_BG,
                )
                draw.text((x, line.y), text, fill=_CODE_TEXT, font=font)
                x += w
            else:
                draw.text((x, line.y), text, fill=color, font=font)
                x += draw.textlength(text, font=font)
        if line.marker:
            draw.text(
                (line.x - _BULLET_SPACE * ss, line.y),
                "•",
                fill=_BULLET_COLOR,
                font=font,
            )


def _render_error_placeholder(width: int, font_path: str, exc: Exception) -> bytes:
    """Render a minimal error PNG when normal rendering fails.

    This is the last-resort fallback so the caller always gets valid PNG bytes.
    """
    height = 120
    img = Image.new("RGBA", (width, height), _BG)
    draw = ImageDraw.Draw(img)
    font: _Font
    try:
        font = _load_font(font_path, 24)
    except Exception:  # noqa: BLE001
        font = ImageFont.load_default()
    draw.text((24, 24), "渲染失败", fill="#ef4444", font=font)
    msg = str(exc)[:200]
    draw.text((24, 62), msg, fill=_TEXT, font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


__all__ = ["render_markdown"]
