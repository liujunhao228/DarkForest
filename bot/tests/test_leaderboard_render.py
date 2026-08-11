"""Tests for leaderboard ranking + rendering (render/leaderboard.py).

覆盖：
① ranked_players 排序：胜者置顶 / 未淘汰优先 / 已淘汰按 eliminatedTurn 降序 / 同回合 ID 兜底
② 位置列映射：map_snapshot 星系名 / position<=0 显示 — / 快照缺失回退「星系 N」
③ render_leaderboard 输出有效 PNG；渲染失败回落 placeholder PNG（不抛异常）
"""

from __future__ import annotations

import io
from typing import Any
from unittest.mock import patch

from PIL import Image

from darkforest_bot.backend.view_state import ViewState
from darkforest_bot.render.leaderboard import (
    _lookup_system_name,
    ranked_players,
    render_leaderboard,
)

from ._state_helpers import make_state_dict as _make_state_dict


def _player(
    pid: str,
    name: str,
    *,
    energy: int = 5,
    eliminated: bool = False,
    eliminated_turn: int = 0,
    position: int = 1,
    color: str = "red",
    destroyed: int = 0,
    strikes: int = 0,
    broadcasts: int = 0,
) -> dict[str, Any]:
    return {
        "id": pid,
        "name": name,
        "color": color,
        "position": position,
        "energy": energy,
        "handCount": 0,
        "hand": [],
        "faceUpCards": [],
        "eliminated": eliminated,
        "eliminatedTurn": eliminated_turn,
        "destroyedStarCount": destroyed,
        "strikeCount": strikes,
        "broadcastSuccessCount": broadcasts,
    }


def _leaderboard_state(
    players: list[dict[str, Any]],
    *,
    winner: str | None = "p1",
    total_turn: int = 12,
) -> ViewState:
    return ViewState.model_validate(
        _make_state_dict(
            total_turn=total_turn,
            winner=winner,
            players=players,
        )
        | {
            "phase": "gameOver",
            "replayId": "replay-abc-123",
            "_viewMeta": {"role": "REPLAY", "viewerId": "", "timestamp": 1},
        }
    )


class TestRankedPlayers:
    def test_winner_first_then_alive_then_eliminated(self) -> None:
        vs = _leaderboard_state(
            [
                # 已淘汰，晚淘汰（回合 6）
                _player("p2", "Bob", energy=10, eliminated=True, eliminated_turn=6),
                # 未淘汰，非胜者
                _player("p3", "Carol", energy=8),
                # 胜者（未淘汰，能量最低也置顶）
                _player("p1", "Alice", energy=3),
                # 已淘汰，早淘汰（回合 4）
                _player("p4", "Dave", energy=15, eliminated=True, eliminated_turn=4),
            ],
            winner="p1",
        )
        ranked = ranked_players(vs)
        ids = [p.id for _rank, p in ranked]
        assert ids == ["p1", "p3", "p2", "p4"]
        ranks = [rank for rank, _p in ranked]
        assert ranks == [1, 2, 3, 4]

    def test_alive_group_sorts_by_energy_desc(self) -> None:
        vs = _leaderboard_state(
            [
                _player("p2", "Bob", energy=8),
                _player("p1", "Alice", energy=3),
                _player("p3", "Carol", energy=12),
            ],
            winner="p1",
        )
        ranked = ranked_players(vs)
        ids = [p.id for _rank, p in ranked]
        # 胜者 Alice 置顶；其余按能量降序：Carol(12) > Bob(8)
        assert ids == ["p1", "p3", "p2"]

    def test_eliminated_group_sorts_by_turn_desc_then_id(self) -> None:
        vs = _leaderboard_state(
            [
                # 同回合（5）被淘汰 → ID 兜底：p3 < p4
                _player("p4", "Dave", eliminated=True, eliminated_turn=5),
                _player("p1", "Alice", energy=3),
                _player("p2", "Bob", eliminated=True, eliminated_turn=7),
                _player("p3", "Carol", eliminated=True, eliminated_turn=5),
            ],
            winner="p1",
        )
        ranked = ranked_players(vs)
        ids = [p.id for _rank, p in ranked]
        assert ids == ["p1", "p2", "p3", "p4"]

    def test_winner_none_keeps_alive_group_stable(self) -> None:
        vs = _leaderboard_state(
            [
                _player("p2", "Bob", energy=8),
                _player("p1", "Alice", energy=3),
            ],
            winner=None,
        )
        ranked = ranked_players(vs)
        ids = [p.id for _rank, p in ranked]
        # 无胜者 → 未存活组内能量降序：Bob(8) > Alice(3)
        assert ids == ["p2", "p1"]


class TestPositionColumn:
    def _vs_with_snapshot(self) -> ViewState:
        return _leaderboard_state(
            [_player("p1", "Alice", position=5)],
            winner="p1",
        )

    def test_lookup_system_name_from_snapshot(self) -> None:
        vs = self._vs_with_snapshot()
        # 无 map_snapshot → 回退「星系 N」
        assert _lookup_system_name(vs, 5) == "星系 5"

    def test_hidden_or_undeployed_position_renders_dash(self) -> None:
        vs = self._vs_with_snapshot()
        assert _lookup_system_name(vs, -1) == "—"
        assert _lookup_system_name(vs, 0) == "—"

    def test_snapshot_resolves_real_system_name(self) -> None:
        state_dict = _make_state_dict(
            total_turn=1,
            winner="p1",
            players=[_player("p1", "Alice", position=5)],
        ) | {
            "phase": "gameOver",
            "replayId": "replay-abc-123",
            "_viewMeta": {"role": "REPLAY", "viewerId": "", "timestamp": 1},
            "mapSnapshot": {
                "nodes": [
                    {
                        "id": 5,
                        "x": 30.0,
                        "y": 42.0,
                        "name": "半人马座 α",
                        "size": "lg",
                        "tint": "#a855f7",
                    },
                ],
                "edges": [],
            },
        }
        vs = ViewState.model_validate(state_dict)
        assert _lookup_system_name(vs, 5) == "半人马座 α"


class TestRenderLeaderboard:
    def test_returns_valid_png(self) -> None:
        vs = _leaderboard_state(
            [
                _player("p1", "Alice", energy=20, position=5, destroyed=2, strikes=3, broadcasts=1),
                _player("p2", "Bob", energy=0, position=8, eliminated=True, eliminated_turn=9),
            ],
            winner="p1",
            total_turn=12,
        )
        png = render_leaderboard(vs)
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
        img = Image.open(io.BytesIO(png))
        assert img.width == 900
        assert img.height > 0

    def test_hidden_positions_render_without_error(self) -> None:
        """per-player 视角（对手 position=-1）渲染不抛异常、仍是有效 PNG。"""
        vs = ViewState.model_validate(
            _make_state_dict(
                total_turn=12,
                winner="p1",
                players=[
                    _player("p1", "Alice", position=5),
                    _player("p2", "Bob", position=-1, eliminated=True, eliminated_turn=9),
                ],
            )
            | {
                "phase": "gameOver",
                "replayId": "replay-abc-123",
                "_viewMeta": {"role": "PLAYER", "viewerId": "p1", "timestamp": 1},
            }
        )
        png = render_leaderboard(vs)
        assert png[:8] == b"\x89PNG\r\n\x1a\n"

    def test_render_failure_falls_back_to_placeholder(self) -> None:
        """渲染内部异常时回落 placeholder PNG，绝不抛异常。"""
        vs = _leaderboard_state(
            [_player("p1", "Alice", energy=20)],
            winner="p1",
        )
        with patch(
            "darkforest_bot.render.leaderboard._render_inner",
            side_effect=RuntimeError("boom"),
        ):
            png = render_leaderboard(vs)
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
