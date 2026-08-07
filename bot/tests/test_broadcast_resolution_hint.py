"""Tests for render/broadcast_hint.py — render_broadcast_resolution_hint.

Covers log search window, role classification, and personal-perspective
rendering for cooperation / bluff / mutual bluff / cancellation scenarios.
"""

from __future__ import annotations

from darkforest_bot.backend.view_state import (
    BroadcastStateView,
    LogEntry,
    PlayerView,
    ViewMeta,
    ViewState,
)
from darkforest_bot.render.broadcast_hint import (
    render_broadcast_resolution_hint,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _player(pid: str, name: str) -> PlayerView:
    return PlayerView(
        id=pid,
        name=name,
        color="red",
        position=1,
        energy=5,
        handCount=0,
        hand=[],
        faceUpCards=[],
        eliminated=False,
    )


def _log(message: str, *, turn: int = 5, type_: str = "broadcast") -> LogEntry:
    return LogEntry(
        id=f"log_{turn}_{abs(hash(message)) % 10000}",
        turn=turn,
        phase="actionPhase",
        message=message,
        type=type_,
    )


def _broadcast(
    *,
    broadcaster_id: str = "p1",
    card_uid: str = "bc1",
    selected_responder_id: str | None = None,
    phase: str = "reveal",
) -> BroadcastStateView:
    return BroadcastStateView(
        broadcasterId=broadcaster_id,
        cardUid=card_uid,
        card=None,
        targetSystem=3,
        range_=2,
        subtype=None,
        responses=[],
        phase=phase,
        selectedResponderId=selected_responder_id,
        responseCard=None,
    )


def _state_with_logs(
    logs: list[LogEntry],
    *,
    broadcast: BroadcastStateView | None = None,
    local_player_id: str = "p1",
    broadcaster_name: str = "Alice",
    responder_name: str = "Bob",
) -> ViewState:
    players = [
        _player("p1", broadcaster_name),
        _player("p2", responder_name),
    ]
    return ViewState(
        phase="playing",
        totalTurn=5,
        playerCount=2,
        players=players,
        currentPlayerIndex=0,
        currentPlayerId="p1",
        localPlayerId=local_player_id,
        turnPhase="actionPhase",
        winner=None,
        isProcessing=False,
        **{"_viewMeta": ViewMeta(role="PLAYER", viewerId=local_player_id, timestamp=0)},
        logs=logs,
        broadcast=broadcast,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestResolutionHintEarlyReturns:
    def test_empty_card_uid_returns_empty(self) -> None:
        vs = _state_with_logs([_log("双方合作! Alice 和 Bob 各获得 3 点能量")])
        assert render_broadcast_resolution_hint(vs, "", "p1") == ""

    def test_no_broadcast_log_in_window_returns_fallback(self) -> None:
        # broadcast log followed by 5 action logs → out of 5-window.
        logs = [_log("双方合作! Alice 和 Bob 各获得 3 点能量")]
        logs.extend(_log(f"action {i}", type_="action") for i in range(5))
        vs = _state_with_logs(logs)
        result = render_broadcast_resolution_hint(vs, "bc1", "p1")
        assert result == "广播已结束，.log 查看详情"

    def test_broadcast_log_in_window_found(self) -> None:
        # 4 action logs + 1 broadcast log → in window.
        logs = [_log(f"action {i}", type_="action") for i in range(4)]
        logs.append(_log("双方合作! Alice 和 Bob 各获得 3 点能量"))
        vs = _state_with_logs(logs)
        result = render_broadcast_resolution_hint(vs, "bc1", "p1")
        assert "双方合作" in result

    def test_unrecognized_log_format_returns_fallback(self) -> None:
        vs = _state_with_logs([_log("广播发生了未知事情")])
        result = render_broadcast_resolution_hint(vs, "bc1", "p1")
        assert result == "广播已结束，.log 查看详情"


class TestResolutionHintCooperation:
    """合作场景：双方合作! X 和 Y 各获得 3 点能量"""

    def test_broadcaster_perspective(self) -> None:
        vs = _state_with_logs(
            [_log("双方合作! Alice 和 Bob 各获得 3 点能量")],
            broadcast=None,  # 结算后 broadcast 已 None
            local_player_id="p1",
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p1")
        assert "你与 Bob 双方合作" in result
        assert "你获得 3 能量" in result
        assert "抽 1 牌" in result
        assert "对方获得 3 能量" in result

    def test_responder_perspective(self) -> None:
        vs = _state_with_logs(
            [_log("双方合作! Alice 和 Bob 各获得 3 点能量")],
            broadcast=None,
            local_player_id="p2",  # 本地是响应者 Bob
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p2")
        assert "你与 Alice 双方合作" in result
        assert "你获得 3 能量" in result
        assert "抽 1 牌" in result

    def test_spectator_returns_original(self) -> None:
        # 本地是 Charlie（旁观者）
        vs = _state_with_logs(
            [_log("双方合作! Alice 和 Bob 各获得 3 点能量")],
            broadcast=None,
            local_player_id="p3",
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        # 添加 Charlie 到 players
        vs.players.append(_player("p3", "Charlie"))
        result = render_broadcast_resolution_hint(vs, "bc1", "p3")
        assert result == "双方合作! Alice 和 Bob 各获得 3 点能量"


class TestResolutionHintBluff:
    """伪装场景：X 伪装成功! 获得 5 点能量"""

    def test_broadcaster_is_bluffer(self) -> None:
        # 广播者 Alice 伪装成功
        vs = _state_with_logs(
            [_log("Alice 伪装成功! 获得 5 点能量")],
            broadcast=None,
            local_player_id="p1",
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p1")
        assert "你伪装成功" in result
        assert "获得 5 能量" in result

    def test_responder_is_bluffer(self) -> None:
        # 响应者 Bob 伪装成功，本地是 Bob
        vs = _state_with_logs(
            [_log("Bob 伪装成功! 获得 5 点能量")],
            broadcast=None,
            local_player_id="p2",  # 本地是响应者 Bob
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p2")
        assert "你伪装成功" in result
        assert "获得 5 能量" in result

    def test_broadcaster_sees_responder_bluff(self) -> None:
        # 响应者 Bob 伪装成功，本地是广播者 Alice
        vs = _state_with_logs(
            [_log("Bob 伪装成功! 获得 5 点能量")],
            broadcast=None,
            local_player_id="p1",
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p1")
        assert "对方 Bob 伪装成功" in result
        assert "对方获得 5 能量" in result

    def test_responder_sees_broadcaster_bluff(self) -> None:
        # 广播者 Alice 伪装成功，本地是响应者 Bob
        vs = _state_with_logs(
            [_log("Alice 伪装成功! 获得 5 点能量")],
            broadcast=None,
            local_player_id="p2",
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p2")
        assert "对方 Alice 伪装成功" in result
        assert "对方获得 5 能量" in result


class TestResolutionHintMutualBluff:
    """双方伪装场景：双方伪装! 无人获得能量"""

    def test_broadcaster_perspective(self) -> None:
        vs = _state_with_logs(
            [_log("双方伪装! 无人获得能量")],
            broadcast=None,
            local_player_id="p1",
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p1")
        assert result == "双方伪装，无人获得能量"

    def test_responder_perspective(self) -> None:
        vs = _state_with_logs(
            [_log("双方伪装! 无人获得能量")],
            broadcast=None,
            local_player_id="p2",
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p2")
        assert result == "双方伪装，无人获得能量"


class TestResolutionHintCancellation:
    """取消场景：无人回应(广播)?, X 获得 1 点能量"""

    def test_active_cancel_broadcaster_is_local(self) -> None:
        # CancelBroadcast 主动取消格式："无人回应, X 获得 1 点能量"
        vs = _state_with_logs(
            [_log("无人回应, Alice 获得 1 点能量")],
            broadcast=None,
            local_player_id="p1",
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p1")
        assert result == "广播取消，你退还 1 能量"

    def test_no_responses_broadcaster_is_local(self) -> None:
        # InitiateBroadcast 无人可响应格式："无人回应广播, X 获得 1 点能量"
        vs = _state_with_logs(
            [_log("无人回应广播, Alice 获得 1 点能量")],
            broadcast=None,
            local_player_id="p1",
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p1")
        assert result == "广播取消，你退还 1 能量"

    def test_broadcaster_not_local(self) -> None:
        # 广播者是 Bob，本地是 Alice（响应者或旁观者视角）
        vs = _state_with_logs(
            [_log("无人回应, Bob 获得 1 点能量")],
            broadcast=None,
            local_player_id="p1",
            broadcaster_name="Bob",  # 不匹配 local_player_id
            responder_name="Alice",
        )
        # 注意：_state_with_logs 把 broadcaster_name 赋给 p1。
        # 此测试用例 broadcaster_name="Bob" 但 local_player_id="p1"，
        # 实际上 p1 的 name 是 broadcaster_name，所以是 Bob。
        # 这里需要重新构造让 local=Alice(p1), broadcaster=Bob(p2)。
        # 重置 players：让 p1=Alice, p2=Bob，本地 p1 是响应者视角。
        vs = _state_with_logs(
            [_log("无人回应, Bob 获得 1 点能量")],
            broadcast=None,
            local_player_id="p1",
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p1")
        assert "广播取消" in result
        assert "Bob 退还 1 能量" in result


class TestResolutionHintWithBroadcast:
    """broadcast 非 None 时的角色判定（reveal 阶段或 select 之后）。"""

    def test_broadcast_set_with_local_broadcaster(self) -> None:
        vs = _state_with_logs(
            [_log("双方合作! Alice 和 Bob 各获得 3 点能量")],
            broadcast=_broadcast(broadcaster_id="p1", selected_responder_id="p2"),
            local_player_id="p1",
            broadcaster_name="Alice",
            responder_name="Bob",
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p1")
        assert "你与 Bob 双方合作" in result

    def test_broadcast_set_with_local_selected_responder(self) -> None:
        # 广播者是 p2 (Bob)，被选中响应者是 p1 (Alice)，本地是 p1
        vs = _state_with_logs(
            [_log("双方合作! Alice 和 Bob 各获得 3 点能量")],
            broadcast=_broadcast(broadcaster_id="p2", selected_responder_id="p1"),
            local_player_id="p1",
            broadcaster_name="Alice",  # p1.name = "Alice" (本地，响应者)
            responder_name="Bob",    # p2.name = "Bob" (广播者)
        )
        result = render_broadcast_resolution_hint(vs, "bc1", "p1")
        assert "你与 Bob 双方合作" in result
