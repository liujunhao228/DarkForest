"""Pillow starmap renderer for QQ bot private-message replies.

Renders a ``ViewState`` into a PNG image showing:
- Star system nodes (colored circles, sized by node.size)
- Edges between nodes (gray lines)
- Destroyed stars (red X overlay)
- Player positions (colored ring around the node + name label)
- Top title: current turn + current player name (and winner if game over)

Authoritative source for default 9-node layout:
    e:\\DarkForest\\backend\\internal\\game\\starmap.go (StarNodes, StarEdges)

When backend starmap.go changes the default layout, update ``_DEFAULT_NODES``
and ``_DEFAULT_EDGES`` in lockstep.

Design notes:
- The renderer never raises. Font missing, node missing, or any other
  rendering error falls back to a safe default (skip the element or use
  ``ImageFont.load_default()``). The caller receives a valid PNG bytes
  regardless of input quality.
- ``Any`` does not appear in this module's public signature.
- Pillow types (ImageFont.FreeTypeFont) are intentionally annotated loosely
  as ``ImageFont.ImageFont`` to cover both truetype and default fallbacks.
"""

from __future__ import annotations

import io

from loguru import logger
from PIL import Image, ImageColor, ImageDraw, ImageFont

from darkforest_bot.backend.view_state import (
    StarEdge,
    StarNode,
    ViewState,
)

# Player color → hex. Mirrors backend player color palette.
PLAYER_COLORS: dict[str, str] = {
    "red": "#ef4444",
    "blue": "#3b82f6",
    "green": "#22c55e",
    "amber": "#f59e0b",
    "purple": "#a855f7",
}

# Node size → radius in pixels.
SIZE_RADIUS: dict[str, int] = {
    "sm": 14,
    "md": 18,
    "lg": 24,
}

# Supersample factor for anti-aliasing. The image is rendered at _SS times the
# target canvas size, then downsampled with LANCZOS resampling. This smooths
# circle edges, line endpoints, and text glyphs that Pillow's ImageDraw would
# otherwise render with hard jaggies. _SS=2 gives a good quality/size tradeoff.
_SS = 2

# Default 9-node map (mirrors backend starmap.go StarNodes/StarEdges).
# Used when ViewState.map_snapshot is None (e.g. observer without map data).
# Authoritative source: e:\DarkForest\backend\internal\game\starmap.go
_DEFAULT_NODES: list[StarNode] = [
    StarNode(id=1, x=10, y=12, name="星系 1", size="md", tint="#6366f1"),
    StarNode(id=2, x=24, y=8, name="星系 2", size="sm", tint="#0ea5e9"),
    StarNode(id=3, x=16, y=28, name="星系 3", size="sm", tint="#14b8a6"),
    StarNode(id=4, x=38, y=20, name="星系 4", size="md", tint="#6366f1"),
    StarNode(id=5, x=30, y=42, name="星系 5", size="lg", tint="#a855f7"),
    StarNode(id=6, x=52, y=38, name="星系 6", size="lg", tint="#a855f7"),
    StarNode(id=7, x=46, y=58, name="星系 7", size="md", tint="#6366f1"),
    StarNode(id=8, x=72, y=64, name="星系 8", size="md", tint="#f59e0b"),
    StarNode(id=9, x=86, y=86, name="星系 9", size="md", tint="#ef4444"),
]

def _edge(from_id: int, to_id: int) -> StarEdge:
    """Construct a StarEdge using model_validate (alias-aware constructor).

    StarEdge's ``from_`` field uses ``Field(alias="from")`` because ``from``
    is a Python reserved word. The pydantic mypy plugin generates the
    ``__init__`` signature using the alias, so direct construction with
    ``StarEdge(from_=...)`` triggers a mypy error. ``model_validate`` accepts
    the alias key and works correctly at both type-check and runtime.
    """
    return StarEdge.model_validate({"from": from_id, "to": to_id})


_DEFAULT_EDGES: list[StarEdge] = [
    _edge(1, 2),
    _edge(1, 3),
    _edge(2, 3),
    _edge(2, 4),
    _edge(3, 4),
    _edge(3, 5),
    _edge(4, 5),
    _edge(4, 6),
    _edge(5, 6),
    _edge(5, 7),
    _edge(6, 7),
    _edge(6, 8),
    _edge(7, 8),
    _edge(8, 9),
]


# Union of the two font types Pillow returns: FreeTypeFont for TrueType fonts
# and ImageFont for the built-in bitmap fallback. They do not share a common
# base class, so the union is the correct return type.
_Font = ImageFont.FreeTypeFont | ImageFont.ImageFont


def _load_font(font_path: str, size: int) -> _Font:
    """Load a TrueType font with graceful fallbacks.

    Tries the requested font path, then simhei.ttf, then Pillow's default
    bitmap font. Logs a warning on each fallback so missing fonts are
    discoverable in bot logs.
    """
    # Try the requested font first.
    try:
        return ImageFont.truetype(font_path, size)
    except OSError:
        logger.warning(
            "font not found at {!r}, trying simhei.ttf fallback", font_path
        )

    # Try simhei.ttf (Windows Chinese font, often available system-wide).
    try:
        return ImageFont.truetype("simhei.ttf", size)
    except OSError:
        logger.warning("simhei.ttf not found, falling back to Pillow default font")

    # Last resort: Pillow's built-in bitmap font. Will not render Chinese
    # glyphs (they appear as boxes), but the PNG still generates.
    return ImageFont.load_default()


def _resolve_map(state: ViewState) -> tuple[list[StarNode], list[StarEdge]]:
    """Return (nodes, edges) from state.map_snapshot or the default layout."""
    snap = state.map_snapshot
    if snap is None or not snap.nodes:
        return list(_DEFAULT_NODES), list(_DEFAULT_EDGES)
    return list(snap.nodes), list(snap.edges)


def _node_index(nodes: list[StarNode]) -> dict[int, StarNode]:
    """Index nodes by id for fast edge/destroyed-star lookups."""
    return {n.id: n for n in nodes}


def _to_canvas(x: float, y: float, scale: float, margin: int) -> tuple[float, float]:
    """Map backend 0-100 coordinate space to canvas pixel coordinates."""
    return (margin + x * scale, margin + y * scale)


def _safe_getrgb(color_hex: str) -> tuple[int, int, int] | tuple[int, int, int, int]:
    """Parse a hex color string to RGB. Falls back to white on error.

    ``ImageColor.getrgb`` may return a 3-tuple (RGB) or 4-tuple (RGBA)
    depending on the input format. Callers that need strictly 3-channel
    RGB should slice the result (``[:3]``) before use.
    """
    try:
        return ImageColor.getrgb(color_hex)
    except (ValueError, TypeError):
        logger.warning("invalid color {!r}, falling back to white", color_hex)
        return (255, 255, 255)


def render_starmap(
    state: ViewState,
    *,
    canvas_size: int = 900,
    font_path: str = "C:\\Windows\\Fonts\\msyh.ttc",
) -> bytes:
    """Render ``state`` to PNG bytes.

    Args:
        state: Typed ViewState cache (must be non-None).
        canvas_size: Square canvas size in pixels. Defaults to 900.
        font_path: Path to a TrueType font that supports Chinese glyphs.
            Defaults to Microsoft YaHei on Windows. Falls back to
            ``simhei.ttf`` then Pillow's default font.

    Returns:
        PNG image bytes. Always returns valid PNG; never raises.
    """
    # Any exceptions during rendering are caught here so the caller always
    # gets bytes back. We log the error for diagnosis.
    try:
        return _render_inner(state, canvas_size=canvas_size, font_path=font_path)
    except Exception as exc:  # noqa: BLE001 — render must never raise
        logger.exception("starmap render failed, returning error placeholder PNG: {}", exc)
        return _render_error_placeholder(canvas_size, font_path, exc)


def _render_inner(
    state: ViewState, *, canvas_size: int, font_path: str
) -> bytes:
    """Actual rendering logic. May raise; caller wraps in try/except.

    Uses supersampling: renders at ``_SS * canvas_size`` then downsamples
    with LANCZOS resampling for anti-aliased edges and text.
    """
    nodes, edges = _resolve_map(state)
    node_idx = _node_index(nodes)

    # Coordinate mapping: backend uses 0-100 range; map to canvas with margin.
    # All geometry is computed in supersampled render-space.
    render_size = canvas_size * _SS
    margin = 60 * _SS
    scale = (render_size - 2 * margin) / 100.0

    img = Image.new("RGBA", (render_size, render_size), "#0f172a")
    draw = ImageDraw.Draw(img)

    title_font = _load_font(font_path, 24 * _SS)
    label_font = _load_font(font_path, 16 * _SS)
    player_font = _load_font(font_path, 14 * _SS)

    # 1. Draw edges (under nodes so nodes cover endpoints).
    _draw_edges(draw, edges, node_idx, scale, margin)

    # 2. Draw nodes.
    _draw_nodes(draw, nodes, scale, margin, label_font)

    # 3. Draw destroyed stars (red X overlay).
    _draw_destroyed_stars(draw, state.destroyed_stars, node_idx, scale, margin)

    # 4. Draw player position rings + name labels.
    _draw_player_positions(draw, state, node_idx, scale, margin, player_font)

    # 5. Draw top title.
    _draw_title(draw, state, title_font, margin)

    # 6. Downsample to target canvas size with LANCZOS for anti-aliasing.
    img = img.resize((canvas_size, canvas_size), Image.Resampling.LANCZOS)

    # 7. Export PNG.
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _draw_edges(
    draw: ImageDraw.ImageDraw,
    edges: list[StarEdge],
    node_idx: dict[int, StarNode],
    scale: float,
    margin: int,
) -> None:
    for edge in edges:
        n_from = node_idx.get(edge.from_)
        n_to = node_idx.get(edge.to)
        if n_from is None or n_to is None:
            logger.warning(
                "edge references missing node: from={} to={}", edge.from_, edge.to
            )
            continue
        p1 = _to_canvas(n_from.x, n_from.y, scale, margin)
        p2 = _to_canvas(n_to.x, n_to.y, scale, margin)
        draw.line([p1, p2], fill="#475569", width=2 * _SS)


def _draw_nodes(
    draw: ImageDraw.ImageDraw,
    nodes: list[StarNode],
    scale: float,
    margin: int,
    label_font: _Font,
) -> None:
    outline_rgb = _safe_getrgb("#e2e8f0")
    label_rgb = _safe_getrgb("#e2e8f0")
    for node in nodes:
        cx, cy = _to_canvas(node.x, node.y, scale, margin)
        radius = SIZE_RADIUS.get(node.size, 18)
        tint_rgb = _safe_getrgb(node.tint)
        draw.ellipse(
            [cx - radius, cy - radius, cx + radius, cy + radius],
            fill=tint_rgb,
            outline=outline_rgb,
            width=2 * _SS,
        )
        # Node name label: right-bottom of the node.
        try:
            draw.text(
                (cx + radius + 4, cy + radius + 2),
                node.name,
                fill=label_rgb,
                font=label_font,
            )
        except Exception:  # noqa: BLE001
            # Text rendering should never fail the whole image.
            pass


def _draw_destroyed_stars(
    draw: ImageDraw.ImageDraw,
    destroyed: list[int],
    node_idx: dict[int, StarNode],
    scale: float,
    margin: int,
) -> None:
    red_rgb = _safe_getrgb("#ef4444")
    for system_id in destroyed:
        node = node_idx.get(system_id)
        if node is None:
            logger.warning("destroyed star references missing node id={}", system_id)
            continue
        cx, cy = _to_canvas(node.x, node.y, scale, margin)
        radius = SIZE_RADIUS.get(node.size, 18) * _SS
        # X shape: two crossing lines through the node center.
        d = radius
        draw.line(
            [(cx - d, cy - d), (cx + d, cy + d)],
            fill=red_rgb,
            width=3 * _SS,
        )
        draw.line(
            [(cx - d, cy + d), (cx + d, cy - d)],
            fill=red_rgb,
            width=3 * _SS,
        )


def _draw_player_positions(
    draw: ImageDraw.ImageDraw,
    state: ViewState,
    node_idx: dict[int, StarNode],
    scale: float,
    margin: int,
    player_font: _Font,
) -> None:
    # Group players by node id so we can offset names vertically when
    # multiple players share a system.
    by_node: dict[int, list[tuple[str, str]]] = {}
    for player in state.players:
        if player.position == -1 or player.position is None:
            continue  # hidden position — do not render
        if player.position not in node_idx:
            logger.warning(
                "player {} at missing node id={}", player.id, player.position
            )
            continue
        by_node.setdefault(player.position, []).append((player.color, player.name))

    for node_id, occupants in by_node.items():
        node = node_idx[node_id]
        cx, cy = _to_canvas(node.x, node.y, scale, margin)
        radius = SIZE_RADIUS.get(node.size, 18) * _SS
        # Each occupant draws a colored ring + name label below the previous.
        for slot, (color_key, name) in enumerate(occupants):
            hex_color = PLAYER_COLORS.get(color_key, "#9ca3af")
            ring_rgb = _safe_getrgb(hex_color)
            # Offset each subsequent occupant's ring by 4px outward to keep
            # all rings visible.
            off = slot * 4 * _SS
            draw.ellipse(
                [
                    cx - radius - 6 * _SS - off,
                    cy - radius - 6 * _SS - off,
                    cx + radius + 6 * _SS + off,
                    cy + radius + 6 * _SS + off,
                ],
                outline=ring_rgb,
                width=4 * _SS,
            )
            # Name label at top-left of the node (star name occupies
            # bottom-right), stacked upward per occupant. Right-align using
            # textlength so the label ends just left of the ring.
            try:
                text_w = draw.textlength(name, font=player_font)
            except Exception:  # noqa: BLE001
                text_w = 0.0
            try:
                draw.text(
                    (
                        cx - radius - 6 * _SS - text_w,
                        cy - radius - 6 * _SS - (slot + 1) * 18 * _SS,
                    ),
                    name,
                    fill=ring_rgb,
                    font=player_font,
                )
            except Exception:  # noqa: BLE001
                pass


def _draw_title(
    draw: ImageDraw.ImageDraw,
    state: ViewState,
    title_font: _Font,
    margin: int,
) -> None:
    white_rgb = _safe_getrgb("#ffffff")
    current_name = _lookup_player_name(state, state.current_player_id)
    title = f"回合 {state.total_turn} — 当前: {current_name}"
    try:
        draw.text((margin, 20 * _SS), title, fill=white_rgb, font=title_font)
    except Exception:  # noqa: BLE001
        pass

    if state.winner is not None:
        winner_name = _lookup_player_name(state, state.winner)
        sub_title = f"游戏结束 — 胜者: {winner_name}"
        amber_rgb = _safe_getrgb("#f59e0b")
        try:
            draw.text((margin, 52 * _SS), sub_title, fill=amber_rgb, font=title_font)
        except Exception:  # noqa: BLE001
            pass


def _lookup_player_name(state: ViewState, player_id: str) -> str:
    """Find a player's display name by id; return '未知' if not found."""
    player = next((p for p in state.players if p.id == player_id), None)
    if player is None:
        return "未知"
    return player.name


def _render_error_placeholder(
    canvas_size: int, font_path: str, exc: Exception
) -> bytes:
    """Render a minimal error PNG when normal rendering fails.

    This is the last-resort fallback so the caller always gets valid PNG
    bytes (e.g. to send through OneBot ``send_private_msg``).
    """
    img = Image.new("RGBA", (canvas_size, canvas_size), "#0f172a")
    draw = ImageDraw.Draw(img)
    font: _Font
    try:
        font = _load_font(font_path, 24)
    except Exception:  # noqa: BLE001
        font = ImageFont.load_default()
    white_rgb = _safe_getrgb("#ffffff")
    red_rgb = _safe_getrgb("#ef4444")
    draw.text((40, 40), "渲染失败", fill=red_rgb, font=font)
    # Truncate the exception message to keep the placeholder compact.
    msg = str(exc)[:200]
    draw.text((40, 80), msg, fill=white_rgb, font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


__all__ = [
    "PLAYER_COLORS",
    "SIZE_RADIUS",
    "render_starmap",
]
