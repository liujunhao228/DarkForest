"""Tests for backend/game_session.py — STRIKE 类别推送策略。

核心修复点：别人回合里飞击等可见打击事件也应推送（旧 turn_key 方案会漏推）。
用 ``last_event_keys[EventCategory.STRIKE]`` 去重（键格式
``len:uids:destroyed:effects``）。strike 默认开启（cfg.strike=True），可关闭。
"""

from __future__ import annotations

import pytest

from darkforest_bot.backend.event_classifier import EventCategory
from darkforest_bot.backend.game_session import (
    GameSessionStore,
)
from darkforest_bot.notifications.notify_config import NotifyConfig

from ._state_helpers import (
    FakeOnGameOver,
    FakePushCallback,
    FakeWS,
    _fire_delta_sync,
    _fire_full_sync,
    _flying_strike_dict,
    _star_effect_dict,
    _start_session,
)
from ._state_helpers import (
    make_state_dict as _make_state_dict,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def store() -> GameSessionStore:
    return GameSessionStore()


@pytest.fixture
def ws() -> FakeWS:
    return FakeWS()


@pytest.fixture
def push_cb() -> FakePushCallback:
    return FakePushCallback()


@pytest.fixture
def over_cb() -> FakeOnGameOver:
    return FakeOnGameOver()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestStrikePushPolicy:
    async def test_flying_strike_appears_pushes(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """fullSync 无飞击 → deltaSync 新增飞击 → 推送。"""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(total_turn=1, current_player_id="p1"),
        )
        push_cb.calls.clear()

        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "flyingStrikes",
                    "value": [_flying_strike_dict("s1")],
                    "type": "set",
                }
            ],
        )

        assert len(push_cb.calls) == 1
        assert (
            sess.last_event_keys[EventCategory.STRIKE]
            == "1:[('s1', 2, False, False)]:[]:[]"
        )

    async def test_flying_strike_moves_pushes(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """飞击 remaining_moves 减少 → 推送。"""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                total_turn=1,
                current_player_id="p1",
                flying_strikes=[_flying_strike_dict("s1")],
            ),
        )
        push_cb.calls.clear()
        first = sess.last_event_keys[EventCategory.STRIKE]

        # remainingMoves 变化（remaining_moves → 1）→ strike_key 变化。
        strike = _flying_strike_dict("s1", arrived=False)
        strike["remainingMoves"] = 1  # 2 → 1
        await _fire_delta_sync(
            ws,
            [{"path": "flyingStrikes", "value": [strike], "type": "set"}],
        )

        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.STRIKE] != first

    async def test_flying_strike_arrives_pushes(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """飞击 arrived=False → True → 推送。"""
        await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                total_turn=1,
                current_player_id="p1",
                flying_strikes=[_flying_strike_dict("s1", arrived=False)],
            ),
        )
        push_cb.calls.clear()

        strike = _flying_strike_dict("s1", arrived=True)
        await _fire_delta_sync(
            ws,
            [{"path": "flyingStrikes", "value": [strike], "type": "set"}],
        )

        assert len(push_cb.calls) == 1

    async def test_destroyed_star_added_pushes(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """destroyed_stars 增加一颗 → 推送。"""
        await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                total_turn=1,
                current_player_id="p1",
                destroyed_stars=[],
            ),
        )
        push_cb.calls.clear()

        await _fire_delta_sync(
            ws,
            [{"path": "destroyedStars", "value": [3], "type": "set"}],
        )

        assert len(push_cb.calls) == 1

    async def test_star_effect_added_pushes(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """star_effects 新增一项 → 推送。"""
        await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                total_turn=1,
                current_player_id="p1",
                star_effects=[],
            ),
        )
        push_cb.calls.clear()

        await _fire_delta_sync(
            ws,
            [{"path": "starEffects", "value": [_star_effect_dict(3)], "type": "set"}],
        )

        assert len(push_cb.calls) == 1

    async def test_strike_off_does_not_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """cfg.strike=False 时，飞击变化不推送（但 turn_change 仍推）。"""
        await _start_session(
            store,
            ws,
            push_cb,
            over_cb,
            notify_config_provider=lambda qq_arg: NotifyConfig(
                broadcast=True, strike=False, other=False
            ),
        )
        await _fire_full_sync(
            ws,
            _make_state_dict(total_turn=1, current_player_id="p1"),
        )
        push_cb.calls.clear()

        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "flyingStrikes",
                    "value": [_flying_strike_dict("s1")],
                    "type": "set",
                }
            ],
        )

        assert push_cb.calls == []

    async def test_consecutive_same_strike_state_no_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """deltaSync 把飞击设为相同值 → 不推送（strike_key 未变）。"""
        await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                total_turn=1,
                current_player_id="p1",
                flying_strikes=[_flying_strike_dict("s1")],
            ),
        )
        push_cb.calls.clear()

        # Same strike state again. But also OTHER field unchanged → no combine event.
        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "flyingStrikes",
                    "value": [_flying_strike_dict("s1")],
                    "type": "set",
                }
            ],
        )

        assert push_cb.calls == []

    async def test_other_player_turn_strike_still_pushes(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """别人回合里飞击可见变化 → 推送（核心修复点，验证漏推 bug 已解决）。"""
        await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                total_turn=1,
                current_player_id="p2",
                local_player_id="p1",
                flying_strikes=[],
            ),
        )
        push_cb.calls.clear()

        # 别人回合里飞击出现 → strike_key 变化 → 推。
        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "flyingStrikes",
                    "value": [_flying_strike_dict("s1")],
                    "type": "set",
                }
            ],
        )

        assert len(push_cb.calls) == 1

    async def test_strike_plus_turn_change_single_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """turn change + strike 同时变化 → push_callback 只调用一次。"""
        await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(total_turn=1, current_player_id="p1"),
        )
        push_cb.calls.clear()

        # totalTurn 变 + flyingStrikes 出现在同一 delta（用两个 change）→ 一次推送。
        await _fire_delta_sync(
            ws,
            [
                {"path": "totalTurn", "value": 2, "type": "set"},
                {
                    "path": "flyingStrikes",
                    "value": [_flying_strike_dict("s1")],
                    "type": "set",
                },
            ],
        )

        assert len(push_cb.calls) == 1
