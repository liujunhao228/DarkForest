"""Tests for render/starmap.py — Pillow starmap renderer."""

from __future__ import annotations

import io

from PIL import Image

from darkforest_bot.backend.view_state import (
    PlayerView,
    StarNode,
    ViewMeta,
    ViewState,
)
from darkforest_bot.render.starmap import render_starmap


def _make_player(
    *,
    pid: str,
    name: str,
    color: str,
    position: int,
    energy: int = 5,
    hand_count: int = 0,
) -> PlayerView:
    return PlayerView(
        id=pid,
        name=name,
        color=color,
        position=position,
        energy=energy,
        handCount=hand_count,
        hand=[],
        faceUpCards=[],
        eliminated=False,
    )


def _make_state(
    *,
    players: list[PlayerView],
    destroyed_stars: list[int] | None = None,
    winner: str | None = None,
    map_snapshot=None,  # noqa: ANN001 — None default is intentional
    total_turn: int = 3,
    current_player_id: str = "p1",
) -> ViewState:
    return ViewState(
        phase="playing",
        totalTurn=total_turn,
        playerCount=len(players),
        players=players,
        currentPlayerIndex=0,
        currentPlayerId=current_player_id,
        localPlayerId="p1",
        turnPhase="actionPhase",
        destroyedStars=destroyed_stars or [],
        winner=winner,
        mapSnapshot=map_snapshot,
        view_meta=ViewMeta(role="PLAYER", viewer_id="p1", timestamp=1),
    )


def _default_state() -> ViewState:
    p1 = _make_player(pid="p1", name="Alice", color="red", position=1)
    p2 = _make_player(pid="p2", name="Bob", color="blue", position=-1)
    return _make_state(
        players=[p1, p2],
        destroyed_stars=[5],
        winner=None,
        # map_snapshot=None → renderer uses default 9-node layout
    )


class TestRenderStarmapBasic:
    def test_returns_non_empty_bytes(self) -> None:
        png = render_starmap(_default_state(), canvas_size=400)
        assert isinstance(png, bytes)
        assert len(png) > 0

    def test_output_is_valid_png(self) -> None:
        png = render_starmap(_default_state(), canvas_size=400)
        # Image.verify raises if the bytes are not a valid image.
        Image.open(io.BytesIO(png)).verify()

    def test_output_png_can_be_opened_and_has_correct_size(self) -> None:
        png = render_starmap(_default_state(), canvas_size=400)
        with Image.open(io.BytesIO(png)) as img:
            assert img.size == (400, 400)
            assert img.format == "PNG"


class TestFontFallback:
    def test_nonexistent_font_does_not_raise(self) -> None:
        state = _default_state()
        # Should fall back to simhei.ttf or Pillow default font, not raise.
        png = render_starmap(state, canvas_size=400, font_path="/nonexistent/font.ttf")
        assert len(png) > 0
        Image.open(io.BytesIO(png)).verify()


class TestEdgeCases:
    def test_map_snapshot_none_uses_default_layout(self) -> None:
        # No map_snapshot → renderer must use default 9-node layout.
        state = _default_state()
        assert state.map_snapshot is None
        png = render_starmap(state, canvas_size=400)
        Image.open(io.BytesIO(png)).verify()

    def test_winner_set_does_not_crash(self) -> None:
        state = _make_state(
            players=[
                _make_player(pid="p1", name="Alice", color="red", position=1),
                _make_player(pid="p2", name="Bob", color="blue", position=-1),
            ],
            destroyed_stars=[],
            winner="p1",
        )
        png = render_starmap(state, canvas_size=400)
        Image.open(io.BytesIO(png)).verify()

    def test_empty_players_does_not_crash(self) -> None:
        state = _make_state(players=[], destroyed_stars=[])
        png = render_starmap(state, canvas_size=400)
        Image.open(io.BytesIO(png)).verify()

    def test_empty_destroyed_stars_does_not_crash(self) -> None:
        state = _make_state(
            players=[
                _make_player(pid="p1", name="Alice", color="red", position=1),
            ],
            destroyed_stars=[],
        )
        png = render_starmap(state, canvas_size=400)
        Image.open(io.BytesIO(png)).verify()

    def test_player_at_missing_node_does_not_crash(self) -> None:
        # Player claims to be at node 999 which doesn't exist in default map.
        state = _make_state(
            players=[
                _make_player(pid="p1", name="Alice", color="red", position=999),
            ],
            destroyed_stars=[],
        )
        png = render_starmap(state, canvas_size=400)
        Image.open(io.BytesIO(png)).verify()

    def test_destroyed_star_at_missing_node_does_not_crash(self) -> None:
        state = _make_state(
            players=[
                _make_player(pid="p1", name="Alice", color="red", position=1),
            ],
            destroyed_stars=[999],
        )
        png = render_starmap(state, canvas_size=400)
        Image.open(io.BytesIO(png)).verify()


class TestCustomMapSnapshot:
    def test_custom_map_snapshot_is_used(self) -> None:
        # Provide a 3-node custom map. Renderer should not crash and should
        # produce a valid PNG (we cannot easily assert visual content, but
        # successful rendering + valid PNG is the contract).
        from darkforest_bot.backend.view_state import (
            MapLayoutSnapshot,
            StarEdge,
        )

        snap = MapLayoutSnapshot(
            nodes=[
                StarNode(id=1, x=10, y=10, name="A", size="sm", tint="#ff0000"),
                StarNode(id=2, x=50, y=50, name="B", size="md", tint="#00ff00"),
                StarNode(id=3, x=90, y=10, name="C", size="lg", tint="#0000ff"),
            ],
            edges=[
                StarEdge(from_=1, to=2),
                StarEdge(from_=2, to=3),
            ],
        )
        state = _make_state(
            players=[
                _make_player(pid="p1", name="Alice", color="red", position=1),
            ],
            destroyed_stars=[2],
            map_snapshot=snap,
        )
        png = render_starmap(state, canvas_size=400)
        Image.open(io.BytesIO(png)).verify()
