"""Pillow leaderboard renderer for QQ bot settlement push.

Renders a ``ViewState`` into a PNG leaderboard image used by both the group
settlement push (REPLAY omniscient view) and the private GAME_OVER push
(per-player view):

- Players ranked by elimination order: alive players first (winner first,
  then by energy desc, then by player id), eliminated players sorted by
  ``eliminated_turn`` descending (eliminated later ranks higher).
- Columns: rank / player / position / energy / strikes / broadcasts /
  destroyed stars / status.
- Winner row gets an amber accent badge + subtle row background.
- Position column resolves star-system names from ``vs.map_snapshot``;
  hidden / undeployed positions (``position <= 0``) render as "—".

Design notes (mirroring ``render/starmap.py`` and ``render/markdown_image.py``):
- The renderer never raises. Font missing, node missing, or any other
  rendering error falls back to a safe default; the caller receives valid PNG
  bytes regardless of input quality.
- Chinese-capable font loading and supersampling are shared with the starmap
  renderer via ``darkforest_bot.render.starmap``.
- Palette follows the dark cold theme (deep slate canvas, low-saturation
  accents, amber reserved for the winner/title; no pure black/white, no neon).
"""

from __future__ import annotations

import io

from loguru import logger
from PIL import Image, ImageDraw, ImageFont

from darkforest_bot.backend.view_state import PlayerView, ViewState
from darkforest_bot.render.starmap import _SS, PLAYER_COLORS, _load_font, _safe_getrgb

# ---------------------------------------------------------------------------
# Palette: low-saturation dark theme, matches the starmap/markdown identity.
# ---------------------------------------------------------------------------
_BG = "#0f172a"            # deep slate canvas (same as starmap)
_TEXT = "#e2e8f0"          # body text
_MUTED = "#94a3b8"         # headers / secondary text
_ACCENT = "#f59e0b"        # amber — title / winner badge
_WINNER_BG = "#1e293b"     # slate-800 — winner row background
_ELIMINATED = "#64748b"    # slate-500 — eliminated status text
_DIVIDER = "#334155"       # slate-700 — row divider
_DOT_FALLBACK = "#e2e8f0"  # fallback dot color for unknown player colors

# ---------------------------------------------------------------------------
# Layout constants (base units; multiplied by _SS at render time).
# ---------------------------------------------------------------------------
_PADDING = 40
_ROW_HEIGHT = 44
_HEADER_HEIGHT = 36
_TITLE_SIZE = 30
_SUBTITLE_SIZE = 16
_HEADER_SIZE = 15
_ROW_SIZE = 18

# Column x-offsets in base units (pixel space after downsampling).
_COL_RANK = 40
_COL_PLAYER = 118          # player-name text start (dot sits ~18px left)
_COL_POSITION = 380
_COL_ENERGY = 500
_COL_STRIKE = 565
_COL_BROADCAST = 630
_COL_DESTROY = 695
_COL_STATUS = 760

_COL_HEADERS = ("排名", "玩家", "位置", "能量", "打击", "广播", "毁星", "状态")

_DEFAULT_FONT_PATH = "C:\\Windows\\Fonts\\msyh.ttc"
_MAX_NAME_LEN = 12
_DOT_RADIUS = 6

_Font = ImageFont.FreeTypeFont | ImageFont.ImageFont


def ranked_players(vs: ViewState) -> list[tuple[int, PlayerView]]:
    """Rank ``vs.players`` by elimination order.

    Rules:
    - Alive players (``eliminated == False``) come first: winner at the top,
      then by energy descending, then by player id ascending.
    - Eliminated players come after, sorted by ``eliminated_turn``
      descending (eliminated later ranks higher), tie-broken by id.
    - Rank numbers start at 1.

    Returns a list of ``(rank, player)`` tuples.
    """
    alive = [p for p in vs.players if not p.eliminated]
    dead = [p for p in vs.players if p.eliminated]

    def alive_key(p: PlayerView) -> tuple[int, int, str]:
        winner_rank = 0 if p.id == vs.winner else 1
        return (winner_rank, -p.energy, p.id)

    def dead_key(p: PlayerView) -> tuple[int, str]:
        return (-p.eliminated_turn, p.id)

    alive.sort(key=alive_key)
    dead.sort(key=dead_key)
    ordered = [*alive, *dead]
    return [(i + 1, p) for i, p in enumerate(ordered)]


def _lookup_system_name(vs: ViewState, position: int) -> str:
    """Resolve a player position to a star-system name.

    Positions <= 0 are hidden/undeployed and render as "—". Falls back to
    "星系 {position}" when the snapshot does not contain the node.
    """
    if position <= 0:
        return "—"
    snap = vs.map_snapshot
    if snap is not None:
        for node in snap.nodes:
            if node.id == position:
                return node.name
    return f"星系 {position}"


def _shorten(name: str) -> str:
    """Truncate names longer than ``_MAX_NAME_LEN`` chars with an ellipsis."""
    if len(name) > _MAX_NAME_LEN:
        return name[:_MAX_NAME_LEN] + "…"
    return name


def render_leaderboard(
    vs: ViewState,
    *,
    width: int = 900,
    font_path: str = _DEFAULT_FONT_PATH,
) -> bytes:
    """Render ``vs`` to a leaderboard PNG.

    Args:
        vs: Typed ViewState cache (must be non-None).
        width: Output image width in pixels. Height is computed from the
            number of ranked players.
        font_path: Path to a TrueType font that supports Chinese glyphs.
            Defaults to Microsoft YaHei on Windows; falls back to ``simhei.ttf``
            then Pillow's default font (see ``starmap._load_font``).

    Returns:
        PNG image bytes. Always returns valid PNG; never raises.
    """
    try:
        return _render_inner(vs, width=width, font_path=font_path)
    except Exception as exc:  # noqa: BLE001 — render must never raise
        logger.exception(
            "leaderboard render failed, returning error placeholder PNG: {}", exc
        )
        return _render_error_placeholder(width, font_path, exc)


def _render_inner(vs: ViewState, *, width: int, font_path: str) -> bytes:
    """Actual rendering logic. May raise; caller wraps in try/except."""
    ranked = ranked_players(vs)
    n_rows = max(len(ranked), 1)

    title_h = int(_TITLE_SIZE * 1.6) * _SS
    subtitle_h = int(_SUBTITLE_SIZE * 1.6) * _SS
    header_y = title_h + subtitle_h + int(16 * _SS)
    rows_h = _ROW_HEIGHT * _SS * n_rows
    content_h = header_y + _HEADER_HEIGHT * _SS + rows_h + _PADDING * _SS

    render_width = width * _SS
    img = Image.new("RGBA", (render_width, content_h), _BG)
    draw = ImageDraw.Draw(img)

    x_left = _PADDING * _SS
    x_right = render_width - _PADDING * _SS

    # 1. Title + subtitle.
    title_font = _load_font(font_path, _TITLE_SIZE * _SS)
    subtitle_font = _load_font(font_path, _SUBTITLE_SIZE * _SS)
    draw.text((x_left, int(12 * _SS)), "本局结算", fill=_ACCENT, font=title_font)
    winner = _lookup_player_name(vs, vs.winner)
    subtitle = f"胜者: {winner}    回合: {vs.total_turn}"
    draw.text((x_left, title_h + int(6 * _SS)), subtitle, fill=_MUTED, font=subtitle_font)

    # 2. Header row + divider.
    header_font = _load_font(font_path, _HEADER_SIZE * _SS)
    for i, label in enumerate(_COL_HEADERS):
        x = _column_x(x_left, i)
        draw.text((x, header_y), label, fill=_MUTED, font=header_font)
    divider_y = header_y + _HEADER_HEIGHT * _SS
    draw.line(
        [x_left, divider_y, x_right, divider_y],
        fill=_DIVIDER,
        width=max(1, 2 * _SS),
    )

    # 3. Player rows.
    row_font = _load_font(font_path, _ROW_SIZE * _SS)
    y = divider_y
    for rank, player in ranked:
        row_top = y
        row_bottom = y + _ROW_HEIGHT * _SS
        is_winner = player.id == vs.winner and not player.eliminated
        if is_winner:
            draw.rectangle([x_left, row_top, x_right, row_bottom], fill=_WINNER_BG)
        _draw_row(draw, row_font, rank, player, vs, x_left, row_top, is_winner)
        y = row_bottom

    # 4. Downsample + export.
    canvas_h = content_h // _SS
    img = img.resize((width, canvas_h), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _column_x(x_left: int, index: int) -> int:
    """Return the supersampled x-offset for column ``index`` (0-based)."""
    base = (_COL_RANK, _COL_PLAYER, _COL_POSITION, _COL_ENERGY,
            _COL_STRIKE, _COL_BROADCAST, _COL_DESTROY, _COL_STATUS)[index]
    return x_left + base * _SS


def _lookup_player_name(vs: ViewState, player_id: str | None) -> str:
    """Look up a display name by player id; empty string when not found."""
    if player_id is None:
        return ""
    return next((p.name for p in vs.players if p.id == player_id), "")


def _draw_row(
    draw: ImageDraw.ImageDraw,
    font: _Font,
    rank: int,
    player: PlayerView,
    vs: ViewState,
    x_left: int,
    y: int,
    is_winner: bool,
) -> None:
    """Draw a single ranked player row."""
    row_mid = y + _ROW_HEIGHT * _SS // 2

    # Rank number (amber for the winner) — 与色点/名字同行中线对齐。
    draw.text(
        (_column_x(x_left, 0), row_mid),
        f"{rank}",
        fill=_ACCENT if is_winner else _MUTED,
        font=font,
        anchor="lm",
    )

    # Color dot + player name.
    dot_rgb = _safe_getrgb(PLAYER_COLORS.get(player.color, _DOT_FALLBACK))
    dot_cx = x_left + (_COL_PLAYER - 18) * _SS
    draw.ellipse(
        [dot_cx - _DOT_RADIUS * _SS, row_mid - _DOT_RADIUS * _SS,
         dot_cx + _DOT_RADIUS * _SS, row_mid + _DOT_RADIUS * _SS],
        fill=dot_rgb,
    )
    name_color = _TEXT if not player.eliminated else _ELIMINATED
    # 名字以 (x, row_mid) 为左中点，与色点圆心共线（垂直居中）。
    draw.text(
        (dot_cx + 14 * _SS, row_mid),
        _shorten(player.name),
        fill=name_color,
        font=font,
        anchor="lm",
    )

    # Position column — 同 row_mid 垂直居中。
    draw.text(
        (_column_x(x_left, 2), row_mid),
        _lookup_system_name(vs, player.position),
        fill=_TEXT,
        font=font,
        anchor="lm",
    )

    # Stat columns — 同 row_mid 垂直居中。
    stats = (
        str(player.energy),
        str(player.strike_count),
        str(player.broadcast_success_count),
        str(player.destroyed_star_count),
    )
    for i, text in enumerate(stats, start=3):
        draw.text(
            (_column_x(x_left, i), row_mid),
            text,
            fill=_TEXT,
            font=font,
            anchor="lm",
        )

    # Status column: winner badge / eliminated marker.
    status_x = _column_x(x_left, 7)
    if is_winner:
        badge_w = draw.textlength("胜者", font=font) + 14 * _SS
        badge_top = row_mid - int(_ROW_HEIGHT * _SS * 0.5) + 5 * _SS
        badge_bottom = row_mid + int(_ROW_HEIGHT * _SS * 0.5) - 5 * _SS
        draw.rounded_rectangle(
            [status_x, badge_top, status_x + badge_w, badge_bottom],
            radius=6 * _SS,
            fill=_ACCENT,
        )
        draw.text(
            (status_x + 7 * _SS, row_mid),
            "胜者",
            fill=_BG,
            font=font,
            anchor="lm",
        )
    elif player.eliminated:
        draw.text(
            (status_x, row_mid),
            "淘汰",
            fill=_ELIMINATED,
            font=font,
            anchor="lm",
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
    draw.text((24, 24), "排行榜渲染失败", fill="#ef4444", font=font)
    msg = str(exc)[:200]
    draw.text((24, 62), msg, fill=_TEXT, font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


__all__ = [
    "ranked_players",
    "render_leaderboard",
    "_lookup_system_name",
]
