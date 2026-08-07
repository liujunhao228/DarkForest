"""Tests for backend/game_session.py — Broadcast push policy (新的类别 + 开关策略).

覆盖 BROADCAST 类别的推送策略，基于 ``last_event_keys[EventCategory.BROADCAST]``
去重键（格式 ``phase:card_uid:local_responded:local_involved``）：

- fullSync（broadcaster 是本地玩家）→ 推送一次，broadcast_key 记录。
- deltaSync 改变 broadcast.phase → 推送（broadcast_key 变化）。
- deltaSync 清空 broadcast → 推送（broadcast_key 变 "none" 或从非 "none" 变
  "none"）。
- 连续不同 card_uid 的广播 → 不丢推。
- 回应者 side：responded 从 False → True → 推（broadcast_key 变化）。
- 旁观者：默认 broad broadcast=on，broadcast 变化也推（行为扩展，见 Step 12）。
- 广播者结算时只推一次（broadcast_key 从非 "none" 变 "none"）。
"""

from __future__ import annotations

import pytest

from darkforest_bot.backend.event_classifier import EventCategory
from darkforest_bot.backend.game_session import (
    GameSessionStore,
)

from ._state_helpers import (
    FakeOnGameOver,
    FakePushCallback,
    FakeWS,
    _broadcast_dict,
    _fire_delta_sync,
    _fire_full_sync,
    _player_dict,
    _response_dict,
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


class TestBroadcastBroadcasterPushPolicy:
    """Broadcaster 侧：broadcast_key + card_uid 去重。"""

    async def test_first_fullsync_with_broadcast_pushes_once(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """fullSync 带 broadcast（broadcaster=p1）→ 推送一次（turn_key 首推）。

        local=p1 是广播者 → local_responded=False, local_involved=True。
        """
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                total_turn=1,
                current_player_id="p1",
                local_player_id="p1",
                broadcast=_broadcast_dict(
                    broadcaster_id="p1",
                    card_uid="bc1",
                    phase="waiting",
                ),
            ),
        )

        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.BROADCAST] == "waiting:bc1:False:True"
        assert sess.last_event_keys[EventCategory.TURN_CHANGE] == "1:p1"

    async def test_phase_change_waiting_to_select_triggers_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """deltaSync 改变 phase waiting→select → 推送（broadcast_key 变化）。"""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                broadcast=_broadcast_dict(
                    broadcaster_id="p1",
                    card_uid="bc1",
                    phase="waiting",
                )
            ),
        )
        push_cb.calls.clear()
        assert sess.last_event_keys[EventCategory.BROADCAST] == "waiting:bc1:False:True"

        await _fire_delta_sync(
            ws,
            [{"path": "broadcast.phase", "value": "select", "type": "set"}],
        )

        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.BROADCAST] == "select:bc1:False:True"

    async def test_phase_change_select_to_reveal_triggers_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """deltaSync 改变 phase select→reveal → 推送。"""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                broadcast=_broadcast_dict(
                    broadcaster_id="p1",
                    card_uid="bc1",
                    phase="select",
                )
            ),
        )
        push_cb.calls.clear()
        assert sess.last_event_keys[EventCategory.BROADCAST] == "select:bc1:False:True"

        await _fire_delta_sync(
            ws,
            [{"path": "broadcast.phase", "value": "reveal", "type": "set"}],
        )

        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.BROADCAST] == "reveal:bc1:False:True"

    async def test_clearing_broadcast_triggers_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """deltaSync 清空 broadcast → 推送（broadcast_key 变 "none"）。

        结算后 broadcast 为 None，broadcast_key 回到 "none"；broadcast_involved
        字段已移除（结算渲染 hint 由 match.py 闭包里的 last_broadcast_card_uids 负责）。
        """
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                broadcast=_broadcast_dict(
                    broadcaster_id="p1",
                    card_uid="bc1",
                    phase="waiting",
                )
            ),
        )
        push_cb.calls.clear()
        assert sess.last_event_keys[EventCategory.BROADCAST] == "waiting:bc1:False:True"

        # Clear broadcast via delta.
        await _fire_delta_sync(
            ws,
            [{"path": "broadcast", "value": None, "type": "set"}],
        )

        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.BROADCAST] == "none"

    async def test_consecutive_broadcasts_do_not_miss_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """两个连续广播（不同 card_uid）→ 3 次推送。

        Sequence: fullSync bc1 waiting (1st) → clear (2nd) → set bc2 waiting (3rd)。
        """
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                broadcast=_broadcast_dict(
                    broadcaster_id="p1",
                    card_uid="bc1",
                    phase="waiting",
                )
            ),
        )
        # 1st push: first fullSync.
        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.BROADCAST] == "waiting:bc1:False:True"

        # Clear broadcast（结算）。
        await _fire_delta_sync(
            ws,
            [{"path": "broadcast", "value": None, "type": "set"}],
        )
        # 2nd push: broadcast 清空（key "none"）。
        assert len(push_cb.calls) == 2
        assert sess.last_event_keys[EventCategory.BROADCAST] == "none"

        # 新广播不同 card_uid。
        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "broadcast",
                    "value": _broadcast_dict(
                        broadcaster_id="p1",
                        card_uid="bc2",
                        phase="waiting",
                    ),
                    "type": "set",
                }
            ],
        )
        # 3rd push: 新广播（key "waiting:bc2:False:True"）。
        assert len(push_cb.calls) == 3
        assert sess.last_event_keys[EventCategory.BROADCAST] == "waiting:bc2:False:True"


class TestBroadcastResponderPushPolicy:
    """回应者侧：responded 状态变化会改 broadcast_key。"""

    async def test_responder_must_respond_pushes(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """本地玩家是回应者 must_respond && !responded → broadcast_key 记录。"""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                local_player_id="p1",
                current_player_id="p2",  # broadcaster 的回合
                broadcast=_broadcast_dict(
                    broadcaster_id="p2",
                    card_uid="bc1",
                    phase="waiting",
                    responses=[
                        _response_dict("p1", "Alice", must_respond=True, responded=False)
                    ],
                ),
            ),
        )
        # 首次 fullSync 推送（turn_key "" → "1:p2"）。
        assert len(push_cb.calls) == 1
        # p1 参与回应 → local_involved=True, local_responded=False。
        assert sess.last_event_keys[EventCategory.BROADCAST] == "waiting:bc1:False:True"

    async def test_responder_responded_changes_push_key(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """回应者 responded False→True → broadcast_key 变化 → 推送。"""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                local_player_id="p1",
                current_player_id="p2",
                broadcast=_broadcast_dict(
                    broadcaster_id="p2",
                    card_uid="bc1",
                    phase="waiting",
                    responses=[
                        _response_dict("p1", "Alice", must_respond=True, responded=False)
                    ],
                ),
            ),
        )
        push_cb.calls.clear()
        assert sess.last_event_keys[EventCategory.BROADCAST] == "waiting:bc1:False:True"

        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "broadcast.responses[0].responded",
                    "value": True,
                    "type": "set",
                }
            ],
        )

        # responded=True → local_responded=True，key 变化 → 推送。
        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.BROADCAST] == "waiting:bc1:True:True"

    async def test_spectator_broadcast_change_pushes(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """旁观者（不在 responses）在 broadcast 变化时也推（新策略，broadcast=on）。

        旧策略旁观者不推 phase 变化；新类别方案默认 broadcast=on，可见广播
        变化也对本地可见 → 推送。这是行为扩展，见 workflow Step 12 注记。
        """
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                local_player_id="p1",
                current_player_id="p2",
                broadcast=_broadcast_dict(
                    broadcaster_id="p2",
                    card_uid="bc1",
                    phase="waiting",
                    responses=[
                        _response_dict("p3", "Charlie", must_respond=True, responded=False)
                    ],
                ),
                extra_players=[_player_dict("p3", "Charlie")],
            ),
        )
        # 首次 fullSync 推（turn_key）。
        assert len(push_cb.calls) == 1
        # p1 既非广播者也不在 responses → local_involved=False。
        assert sess.last_event_keys[EventCategory.BROADCAST] == "waiting:bc1:False:False"
        push_cb.calls.clear()

        # 旁观者广播 phase 变化（broadcast=on）→ 现在推（新策略）。
        await _fire_delta_sync(
            ws,
            [{"path": "broadcast.phase", "value": "select", "type": "set"}],
        )
        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.BROADCAST] == "select:bc1:False:False"


class TestBroadcastResolutionPush:
    """结算/取消时推送，用 broadcast_key 从非 "none" 变 "none" 检测。"""

    async def test_responder_receives_push_when_broadcast_resolves(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """回应者已回应后，广播结算（broadcast → None）→ 推送。

        Sequence:
        1. fullSync: 回应者收到 broadcast → push（local_involved=True）
        2. deltaSync: 已回应 → push（local_responded 变 True）
        3. deltaSync: 结算 broadcast → None → push（key 变 "none"）
        """
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                local_player_id="p1",
                current_player_id="p2",
                broadcast=_broadcast_dict(
                    broadcaster_id="p2",
                    card_uid="bc1",
                    phase="waiting",
                    responses=[
                        _response_dict("p1", "Alice", must_respond=True, responded=False)
                    ],
                ),
            ),
        )
        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.BROADCAST] == "waiting:bc1:False:True"
        push_cb.calls.clear()

        # 2. responded=True。
        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "broadcast.responses[0].responded",
                    "value": True,
                    "type": "set",
                }
            ],
        )
        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.BROADCAST] == "waiting:bc1:True:True"
        push_cb.calls.clear()

        # 3. Broadcast 结算 broadcast → None。
        await _fire_delta_sync(
            ws,
            [{"path": "broadcast", "value": None, "type": "set"}],
        )
        # key 从非 "none" 变 "none" → 推送一次。
        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.BROADCAST] == "none"

    async def test_responder_receives_push_when_broadcast_cancelled(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """回应者已回应后，广播被取消 → 应收到推送。

        (CancelBroadcast 也设 broadcast=nil 与 ResolveBroadcast 同路径。)
        """
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                local_player_id="p1",
                current_player_id="p2",
                broadcast=_broadcast_dict(
                    broadcaster_id="p2",
                    card_uid="bc1",
                    phase="waiting",
                    responses=[
                        _response_dict("p1", "Alice", must_respond=True, responded=False)
                    ],
                ),
            ),
        )
        push_cb.calls.clear()

        # 2. Responder responds。
        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "broadcast.responses[0].responded",
                    "value": True,
                    "type": "set",
                }
            ],
        )
        push_cb.calls.clear()
        assert sess.last_event_keys[EventCategory.BROADCAST] == "waiting:bc1:True:True"

        # 3. Broadcaster cancels → broadcast → None。
        await _fire_delta_sync(
            ws,
            [{"path": "broadcast", "value": None, "type": "set"}],
        )
        assert len(push_cb.calls) == 1  # resolution push
        assert sess.last_event_keys[EventCategory.BROADCAST] == "none"

    async def test_broadcaster_still_gets_single_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """广播者在结算时通过正常 broadcast_key 变化收到一次推送（不重复）。"""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                local_player_id="p1",
                current_player_id="p1",
                broadcast=_broadcast_dict(
                    broadcaster_id="p1",
                    card_uid="bc1",
                    phase="select",
                ),
            ),
        )
        push_cb.calls.clear()
        assert sess.last_event_keys[EventCategory.BROADCAST] == "select:bc1:False:True"

        # Resolution: broadcast → None。key 从 "select:bc1:False:True" 变 "none"。
        await _fire_delta_sync(
            ws,
            [{"path": "broadcast", "value": None, "type": "set"}],
        )
        # 恰好 1 次推送。
        assert len(push_cb.calls) == 1
        assert sess.last_event_keys[EventCategory.BROADCAST] == "none"
