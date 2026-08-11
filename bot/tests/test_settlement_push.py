"""Tests for settlement group push (backend/game_session.py + notifications/settlement.py).

覆盖：
① 同一 replay_id 两次触发仅推送一次（GameSessionStore 去重）
② render_settlement_message 输出短 caption（胜者 / replay_id / total_turn）
③ group_id=None 时不调 send_group_msg
④ replay_id=None 时跳过推送
⑤ phase != "gameOver" 时跳过推送
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from darkforest_bot.backend.game_session import GameSessionStore
from darkforest_bot.backend.view_state import ViewState
from darkforest_bot.notifications.settlement import (
    push_settlement,
    render_settlement_message,
)

from ._state_helpers import FakeOnGameOver, FakePushCallback, FakeWS, _fire_full_sync
from ._state_helpers import make_state_dict as _make_state_dict


def _player(
    pid: str,
    name: str,
    *,
    energy: int = 5,
    eliminated: bool = False,
    eliminated_turn: int = 0,
) -> dict[str, Any]:
    return {
        "id": pid,
        "name": name,
        "color": "red",
        "position": 1,
        "energy": energy,
        "handCount": 0,
        "hand": [],
        "faceUpCards": [],
        "eliminated": eliminated,
        "eliminatedTurn": eliminated_turn,
        "destroyedStarCount": 0,
        "strikeCount": 0,
        "broadcastSuccessCount": 0,
    }


def _gameover_state_dict(
    *,
    replay_id: str = "replay-abc-123",
    winner: str | None = "p1",
    total_turn: int = 12,
) -> dict[str, Any]:
    return _make_state_dict(
        total_turn=total_turn,
        winner=winner,
        players=[
            _player("p1", "Alice", energy=20),
            _player("p2", "Bob", energy=0, eliminated=True),
        ],
    ) | {
        "phase": "gameOver",
        "replayId": replay_id,
        "_viewMeta": {"role": "REPLAY", "viewerId": "", "timestamp": 1},
    }


class FakeSettleCallback:
    """Records (group_id, view_state) invocations for assertion."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, ViewState]] = []

    async def __call__(self, group_id: int, vs: ViewState) -> None:
        self.calls.append((group_id, vs))


@pytest.fixture
def store() -> GameSessionStore:
    return GameSessionStore()


@pytest.fixture
def ws() -> FakeWS:
    return FakeWS()


async def _start_session(
    store: GameSessionStore,
    ws: FakeWS,
    *,
    qq: int = 12345,
    group_id: int | None = 10001,
    settle_cb: FakeSettleCallback | None = None,
) -> tuple[FakeSettleCallback | None, FakePushCallback]:
    """Start a session with the given qq + group_id + settle callback."""
    push_cb = FakePushCallback()
    over_cb = FakeOnGameOver()
    await store.start(
        qq=qq,
        ws=ws,
        group_id=group_id,
        push_callback=push_cb,
        on_game_over=over_cb,
        notify_config_provider=lambda qq_arg: __import__(  # noqa: E731
            "darkforest_bot.notifications.notify_config", fromlist=["NotifyConfig"]
        ).NotifyConfig.default(),
        font_path="/fake/font.ttf",
        canvas_size=400,
        push_settlement=settle_cb,
    )
    return settle_cb, push_cb


class TestSettlementDedup:
    async def test_same_replay_id_pushes_once(
        self, store: GameSessionStore, ws: FakeWS
    ) -> None:
        # 同一 store 内多个玩家各有一份会话；同一对局的 gameOver fullSync
        # 会同时分发给每个玩家会话，但仅应推送一次群结算消息。
        settle_cb = FakeSettleCallback()
        await _start_session(store, ws, qq=11111, settle_cb=settle_cb)
        await _start_session(store, ws, qq=22222, settle_cb=settle_cb)
        state = _gameover_state_dict()

        # 一次广播分发给两个玩家会话（同一 replay_id）→ 仅推送一次
        await _fire_full_sync(ws, state)

        assert settle_cb is not None
        assert len(settle_cb.calls) == 1
        assert settle_cb.calls[0][0] == 10001


class TestSettlementMessageFormat:
    def test_message_contains_winner_replay_and_turn(self) -> None:
        vs = ViewState.model_validate(_gameover_state_dict())
        msg = render_settlement_message(vs)

        assert "Alice" in msg          # winner name
        assert "replay-abc-123" in msg  # replay id
        assert "12" in msg              # total turn
        # 详细统计由排行榜图片承载，文字仅保留短 caption（不再含每人统计行）
        assert "⚡20" not in msg

    def test_winner_none_yields_empty_name(self) -> None:
        vs = ViewState.model_validate(_gameover_state_dict(winner=None))
        msg = render_settlement_message(vs)
        assert "胜者: " in msg


class TestSettlementSkipConditions:
    async def test_skip_no_group_id(
        self, store: GameSessionStore, ws: FakeWS
    ) -> None:
        settle_cb = FakeSettleCallback()
        # group_id=None（私聊）→ 不推送
        await _start_session(store, ws, group_id=None, settle_cb=settle_cb)
        await _fire_full_sync(ws, _gameover_state_dict())
        assert settle_cb is not None
        assert settle_cb.calls == []

    async def test_skip_no_replay_id(
        self, store: GameSessionStore, ws: FakeWS
    ) -> None:
        settle_cb = FakeSettleCallback()
        await _start_session(store, ws, settle_cb=settle_cb)
        await _fire_full_sync(ws, _gameover_state_dict(replay_id=None))
        assert settle_cb is not None
        assert settle_cb.calls == []

    async def test_skip_not_gameover(
        self, store: GameSessionStore, ws: FakeWS
    ) -> None:
        settle_cb = FakeSettleCallback()
        await _start_session(store, ws, settle_cb=settle_cb)
        # 进行中状态（非 gameOver）→ 不推送
        state = _make_state_dict(total_turn=5)
        await _fire_full_sync(ws, state)
        assert settle_cb is not None
        assert settle_cb.calls == []

    async def test_skip_when_push_settlement_none(
        self, store: GameSessionStore, ws: FakeWS
    ) -> None:
        # 未传 push_settlement 回调 → 不推送（Step 8 自身独立可验证）
        await _start_session(store, ws, settle_cb=None)
        await _fire_full_sync(ws, _gameover_state_dict())


class TestSettlementViewRoleGating:
    """回归测试：结算推送必须只认 REPLAY 全知视角视图。

    后端广播顺序是 per-player 脱敏视图（role=PLAYER，对手 position=-1）先到、
    REPLAY 全知视角视图后到。旧实现未检查 role，导致 per-player 视图到达时
    条件全满足、用脱敏数据推送结算，星图只渲染自己的位置。
    """

    async def test_player_view_does_not_trigger_settlement(
        self, store: GameSessionStore, ws: FakeWS
    ) -> None:
        """per-player 脱敏视图（role=PLAYER）到达 → 不推送结算。"""
        settle_cb = FakeSettleCallback()
        push_cb = FakePushCallback()
        over_cb = FakeOnGameOver()
        await store.start(
            qq=12345,
            ws=ws,
            group_id=10001,
            push_callback=push_cb,
            on_game_over=over_cb,
            notify_config_provider=lambda qq_arg: __import__(  # noqa: E731
                "darkforest_bot.notifications.notify_config", fromlist=["NotifyConfig"]
            ).NotifyConfig.default(),
            font_path="/fake/font.ttf",
            canvas_size=400,
            push_settlement=settle_cb,
        )
        # per-player 视角：对手 position=-1（脱敏）
        player_view = _make_state_dict(
            total_turn=12,
            winner="p1",
            players=[
                {"id": "p1", "name": "Alice", "color": "red", "position": 1,
                 "energy": 20, "handCount": 0, "hand": [], "faceUpCards": [],
                 "eliminated": False, "destroyedStarCount": 2, "strikeCount": 3,
                 "broadcastSuccessCount": 1},
                {"id": "p2", "name": "Bob", "color": "blue", "position": -1,
                 "energy": 0, "handCount": 0, "hand": [], "faceUpCards": [],
                 "eliminated": True, "destroyedStarCount": 0, "strikeCount": 0,
                 "broadcastSuccessCount": 0},
            ],
        ) | {
            "phase": "gameOver",
            "replayId": "replay-abc-123",
            "_viewMeta": {"role": "PLAYER", "viewerId": "p1", "timestamp": 1},
        }
        await _fire_full_sync(ws, player_view)

        # 结算不触发（per-player 视图不是全知视角）
        assert settle_cb is not None
        assert settle_cb.calls == []
        # 私聊推送正常（GAME_OVER 硬推）
        assert len(push_cb.calls) == 1
        # 会话保持（等待 REPLAY 视图，不提前 stop）
        assert over_cb.calls == []

    async def test_replay_view_after_player_view_pushes_once(
        self, store: GameSessionStore, ws: FakeWS
    ) -> None:
        """per-player 视图先到（不推送）→ REPLAY 全知视图后到 → 推送一次。"""
        settle_cb = FakeSettleCallback()
        push_cb = FakePushCallback()
        over_cb = FakeOnGameOver()
        await store.start(
            qq=12345,
            ws=ws,
            group_id=10001,
            push_callback=push_cb,
            on_game_over=over_cb,
            notify_config_provider=lambda qq_arg: __import__(  # noqa: E731
                "darkforest_bot.notifications.notify_config", fromlist=["NotifyConfig"]
            ).NotifyConfig.default(),
            font_path="/fake/font.ttf",
            canvas_size=400,
            push_settlement=settle_cb,
        )
        # 先到：per-player 脱敏视图
        player_view = _make_state_dict(
            total_turn=12,
            winner="p1",
            players=[
                {"id": "p1", "name": "Alice", "color": "red", "position": 1,
                 "energy": 20, "handCount": 0, "hand": [], "faceUpCards": [],
                 "eliminated": False, "destroyedStarCount": 2, "strikeCount": 3,
                 "broadcastSuccessCount": 1},
                {"id": "p2", "name": "Bob", "color": "blue", "position": -1,
                 "energy": 0, "handCount": 0, "hand": [], "faceUpCards": [],
                 "eliminated": True, "destroyedStarCount": 0, "strikeCount": 0,
                 "broadcastSuccessCount": 0},
            ],
        ) | {
            "phase": "gameOver",
            "replayId": "replay-abc-123",
            "_viewMeta": {"role": "PLAYER", "viewerId": "p1", "timestamp": 1},
        }
        await _fire_full_sync(ws, player_view)
        assert settle_cb is not None
        assert settle_cb.calls == []  # 未触发

        # 后到：REPLAY 全知视角视图（所有玩家真实位置）
        await _fire_full_sync(ws, _gameover_state_dict(replay_id="replay-abc-123"))

        assert len(settle_cb.calls) == 1
        assert settle_cb.calls[0][0] == 10001
        pushed_vs = settle_cb.calls[0][1]
        # 结算数据必须是全知视角：所有玩家位置真实
        positions = {p.id: p.position for p in pushed_vs.players}
        assert positions["p2"] != -1
        # REPLAY 视图处理完结算后，会话被清理
        assert over_cb.calls == [12345]

    async def test_player_view_then_replay_dedup_across_sessions(
        self, store: GameSessionStore, ws: FakeWS
    ) -> None:
        """两个玩家会话各自先收 per-player 视图，再收 REPLAY 视图 → 仅推一次。"""
        settle_cb = FakeSettleCallback()
        await _start_session(store, ws, qq=11111, settle_cb=settle_cb)
        await _start_session(store, ws, qq=22222, settle_cb=settle_cb)

        # 两个会话各收 per-player 视图（不触发结算）
        for _ in (11111, 22222):
            player_view = _make_state_dict(
                total_turn=12, winner="p1", local_player_id="p1",
            ) | {
                "phase": "gameOver",
                "replayId": "replay-abc-123",
                "_viewMeta": {"role": "PLAYER", "viewerId": "p1", "timestamp": 1},
            }
            await _fire_full_sync(ws, player_view)
        assert settle_cb is not None
        assert settle_cb.calls == []

        # 一次 REPLAY 视图广播分发给两个会话 → 跨会话去重，仅推送一次。
        # （生产语义：每个会话收到 REPLAY 后处理完即 stop，不会收到第二次。）
        await _fire_full_sync(ws, _gameover_state_dict(replay_id="replay-abc-123"))

        assert len(settle_cb.calls) == 1

    async def test_old_backend_no_replay_id_stops_immediately(
        self, store: GameSessionStore, ws: FakeWS
    ) -> None:
        """旧后端（无 replay_id）per-player gameOver 视图 → 立即 stop，行为不变。"""
        settle_cb = FakeSettleCallback()
        push_cb = FakePushCallback()
        over_cb = FakeOnGameOver()
        await store.start(
            qq=12345,
            ws=ws,
            group_id=10001,
            push_callback=push_cb,
            on_game_over=over_cb,
            notify_config_provider=lambda qq_arg: __import__(  # noqa: E731
                "darkforest_bot.notifications.notify_config", fromlist=["NotifyConfig"]
            ).NotifyConfig.default(),
            font_path="/fake/font.ttf",
            canvas_size=400,
            push_settlement=settle_cb,
        )
        # 旧后端：per-player 视图但无 replay_id
        player_view = _make_state_dict(total_turn=12, winner="p1") | {
            "phase": "gameOver",
            "_viewMeta": {"role": "PLAYER", "viewerId": "p1", "timestamp": 1},
        }
        await _fire_full_sync(ws, player_view)

        assert settle_cb is not None
        assert settle_cb.calls == []
        # 立即 stop：on_game_over 触发，会话清理
        assert over_cb.calls == [12345]


class TestPushSettlementApi:
    async def test_send_group_msg_with_image_and_text(self) -> None:
        bot = AsyncMock()
        vs = ViewState.model_validate(_gameover_state_dict())
        await push_settlement(bot, 10001, vs)

        assert bot.call_api.called
        call = bot.call_api.call_args_list[-1]
        assert call.args[0] == "send_group_msg"
        assert call.kwargs["group_id"] == 10001
        msg = str(call.kwargs["message"])
        assert "base64://" in msg
        assert "Alice" in msg
        assert "replay-abc-123" in msg

    async def test_send_failure_is_swallowed(self) -> None:
        bot = AsyncMock()

        async def call_api(api: str, **kwargs: Any) -> None:
            raise RuntimeError("send failed")

        bot.call_api.side_effect = call_api
        vs = ViewState.model_validate(_gameover_state_dict())
        # 不应抛出
        await push_settlement(bot, 10001, vs)
