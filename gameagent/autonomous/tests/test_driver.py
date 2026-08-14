"""driver 主循环单测：FakeClient 事件脚本驱动（无需真实网络）。"""

from __future__ import annotations

import logging
from typing import Any

import pytest

from autonomous_driver.decide import GameAction, RuleDecider
from autonomous_driver.driver import Driver
from autonomous_driver.mcp_client import GameEvent, WaitForEventResult


def _evt(t: str) -> GameEvent:
    return GameEvent(type=t, timestamp=0)


def _target(ttype: str, value: str) -> dict[str, str]:
    return {"type": ttype, "value": value}


def _wait(has_event: bool, *types: str) -> WaitForEventResult:
    return WaitForEventResult(
        hasEvent=has_event,
        events=[_evt(t) for t in types] if has_event else [],
    )


class FakeClient:
    """按序脚本驱动的 GameMCPClient 替身（duck typing）。"""

    def __init__(
        self,
        waits: list[WaitForEventResult] | None = None,
        views: list[dict[str, Any]] | None = None,
        affs: list[dict[str, Any]] | None = None,
        statuses: list[dict[str, Any]] | None = None,
        *,
        connected_status: str = "connected",
    ) -> None:
        self._waits = waits or []
        self._views = views or []
        self._affs = affs or []
        self._statuses = statuses or []
        self.connected_status = connected_status
        self.calls: list[str] = []
        self.replay_ids: list[str] = []

    def _next(self, pool: list[Any], name: str) -> Any:
        self.calls.append(name)
        return pool.pop(0) if pool else {}

    async def connect(self) -> None:
        self.calls.append("connect")

    async def close(self) -> None:
        self.calls.append("close")

    async def reconnect_mcp(self) -> None:
        self.calls.append("reconnect_mcp")

    async def ensure_connected(self) -> dict[str, Any]:
        self.calls.append("ensure_connected")
        return {"connected": True}

    async def join_match_queue(
        self, game_mode: str = "classic", preferred_count: int = 2
    ) -> dict[str, Any]:
        self.calls.append(f"join_match_queue:{game_mode}:{preferred_count}")
        return {"joined": True}

    async def get_connection_status(self) -> dict[str, Any]:
        return self._next(self._statuses, "get_connection_status") or {
            "wsState": self.connected_status,
            "roomId": "",
        }

    async def rejoin_room(self, room_id: str = "") -> dict[str, Any]:
        self.calls.append(f"rejoin_room:{room_id}")
        return {"rejoined": True, "roomId": room_id}

    async def wait_for_event(self, timeout_seconds: int = 30) -> WaitForEventResult:
        self.calls.append("wait_for_event")
        if not self._waits:
            return _wait(False)
        return self._waits.pop(0)

    async def get_agent_view(self) -> dict[str, Any]:
        return self._next(self._views, "get_agent_view") or {"inGame": False}

    async def get_affordances(self) -> dict[str, Any]:
        return self._next(self._affs, "get_affordances") or {"inGame": False}

    async def fetch_and_save_replay(self, *, replay_id: str = "") -> dict[str, Any]:
        self.calls.append(f"fetch_and_save_replay:{replay_id}")
        self.replay_ids.append("replay-1")
        return {"replayId": "replay-1"}

    async def disconnect(self) -> dict[str, Any]:
        self.calls.append("disconnect")
        return {"success": True}

    # 行动方法（decide 输出的映射目标）
    async def play_card(self, card_uid: str) -> dict[str, Any]:
        self.calls.append(f"play_card:{card_uid}")
        return {"success": True}

    async def deploy_card(self, card_uid: str) -> dict[str, Any]:
        self.calls.append(f"deploy_card:{card_uid}")
        return {"success": True}

    async def strike(self, card_uid: str, target_system: int) -> dict[str, Any]:
        self.calls.append(f"strike:{card_uid}:{target_system}")
        return {"success": True}

    async def broadcast(self, card_uid: str, target_system: int) -> dict[str, Any]:
        self.calls.append(f"broadcast:{card_uid}:{target_system}")
        return {"success": True}

    async def resolve_strike_action(
        self,
        option: str,
        strike_uid: str | None = None,
        target_system: int | None = None,
    ) -> dict[str, Any]:
        self.calls.append(f"resolve_strike_action:{option}:{strike_uid}:{target_system}")
        return {"success": True}

    async def respond_broadcast(self, agreed: bool, card_uid: str | None = None) -> dict[str, Any]:
        self.calls.append(f"respond_broadcast:{agreed}:{card_uid}")
        return {"success": True}

    async def select_broadcast_responder(self, responder_player_id: str) -> dict[str, Any]:
        self.calls.append(f"select_broadcast_responder:{responder_player_id}")
        return {"success": True}

    async def cancel_broadcast(self) -> dict[str, Any]:
        self.calls.append("cancel_broadcast")
        return {"success": True}

    async def end_turn(self, discard_cards: list[str] | None = None) -> dict[str, Any]:
        self.calls.append("end_turn")
        return {"success": True}


def _playing_view() -> dict[str, Any]:
    return {
        "inGame": True,
        "agentView": {
            "self": {"energy": 10},
            "cursor": {"turnPhase": "actionPhase", "isMyTurn": True},
        },
    }


def _game_over_view(
    result: str = "win", replay_id: str = "replay-1", total_turn: int = 12
) -> dict[str, Any]:
    """Task 3 终局权威化：get_agent_view.gameOver 权威视图（GameOverView）。"""
    return {
        "inGame": False,
        "gameOver": {"result": result, "replayId": replay_id, "totalTurn": total_turn},
    }


def _playing_aff(end_turn_only: bool = True) -> dict[str, Any]:
    if end_turn_only:
        return {"inGame": True, "affordance": {"legalActions": [{"action": "end_turn"}]}}
    return {"inGame": True, "affordance": {}}


async def test_happy_path_full_game() -> None:
    """排队 → 配对 → 进房 → 对局 → 决策 → 终局 → 回放落库 → 退出。"""
    fake = FakeClient(
        waits=[
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(False),
            _wait(True, "game:fullSync"),
        ],
        views=[_playing_view(), _game_over_view()],
        affs=[_playing_aff()],
    )
    driver = Driver(fake, RuleDecider(), game_mode="classic", wait_timeout=30)
    code = await driver.run(max_waits=10)
    assert code == 0
    assert fake.replay_ids == ["replay-1"]
    assert "join_match_queue:classic:2" in fake.calls
    assert "end_turn" in fake.calls
    assert "fetch_and_save_replay:replay-1" in fake.calls
    assert "disconnect" in fake.calls
    # 状态最终为 GAME_OVER
    assert driver.state.value == "game_over"


async def test_match_error_recover_and_requeue() -> None:
    """匹配失败 → ERROR → 重连（无进行中对局）→ 重新排队。"""
    fake = FakeClient(
        waits=[
            _wait(True, "match:error"),
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(False),
            _wait(True, "game:fullSync"),
        ],
        views=[_playing_view(), _game_over_view()],
        affs=[_playing_aff()],
        statuses=[{"wsState": "connected", "roomId": ""}],
    )
    driver = Driver(fake, RuleDecider())
    code = await driver.run(max_waits=10)
    assert code == 0
    # ERROR 后走了重连 + 重新排队
    assert "ensure_connected" in fake.calls
    assert fake.calls.count("join_match_queue:classic:2") >= 2


async def test_reconnect_rejoins_active_room() -> None:
    """心跳检测断线 → 重连 → 有进行中对局 → rejoin_room。"""
    # _heartbeat 与 _recover 各消费一次 get_connection_status
    fake = FakeClient(
        waits=[_wait(False)],
        statuses=[
            {"wsState": "disconnected", "roomId": "room-77"},
            {"wsState": "connected", "roomId": "room-77"},
        ],
    )
    driver = Driver(fake, RuleDecider())
    from autonomous_driver.state_machine import GamePhase

    driver.state = GamePhase.PLAYING
    await driver._heartbeat()  # noqa: SLF001
    assert "ensure_connected" in fake.calls
    assert "rejoin_room:room-77" in fake.calls
    assert driver.state == GamePhase.IN_ROOM


async def test_wait_session_closed_sets_error() -> None:
    """wait_for_event 抛异常（会话关闭）→ ERROR 状态 + 重连恢复。"""
    class ClosedClient(FakeClient):
        async def wait_for_event(self, timeout_seconds: int = 30) -> WaitForEventResult:
            raise RuntimeError("会话已关闭")

    # _wait 置 ERROR 后调 _recover：get_connection_status 返回已连接、无对局 → 重新排队
    closed = ClosedClient(statuses=[{"wsState": "connected", "roomId": ""}])
    driver = Driver(closed, RuleDecider())
    await driver._wait()  # noqa: SLF001
    # recover 成功后回到 MATCHMAKING（重新排队）
    assert driver.state.value == "matchmaking"
    assert "ensure_connected" in closed.calls
    assert closed.calls.count("join_match_queue:classic:2") >= 1


async def test_active_room_found_triggers_rejoin() -> None:
    """收到 room:activeRoomFound → driver 主动 rejoin（重连回进行中对局）。"""
    fake = FakeClient(
        waits=[
            _wait(True, "room:activeRoomFound"),
            _wait(False),
        ],
    )
    driver = Driver(fake, RuleDecider())
    # 预置为 MATCHMAKING 模拟重连后场景
    from autonomous_driver.state_machine import GamePhase

    driver.state = GamePhase.MATCHMAKING
    code = await driver.run(max_waits=5)
    # 场景无对局推进，max_waits 提前退出（code=1）；验证 rejoin 已被触发
    assert code == 1
    assert "rejoin_room:" in [c for c in fake.calls if c.startswith("rejoin_room")]
    assert driver.state.value in ("in_room", "matchmaking")


async def test_game_over_fetch_replay_logs_replay_id(caplog: pytest.LogCaptureFixture) -> None:
    """终局 → fetch_and_save_replay 落库 + 日志输出 replayId。"""
    fake = FakeClient(
        waits=[
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(True, "game:fullSync"),
        ],
        views=[_playing_view(), _game_over_view()],
        affs=[_playing_aff()],
    )
    driver = Driver(fake, RuleDecider())
    with caplog.at_level(logging.INFO, logger="autonomous_driver"):
        code = await driver.run(max_waits=10)
    assert code == 0
    assert fake.replay_ids == ["replay-1"]
    assert any("回放已落库: replay-1" in r.message for r in caplog.records)


async def test_decide_args_map_to_client_methods() -> None:
    """decide 产出的 snake_case args 能直接映射到 client 方法（e2e 曾暴露的 bug）。"""
    fake = FakeClient(
        waits=[
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(False),
            _wait(True, "game:fullSync"),
        ],
        views=[_playing_view(), _game_over_view()],
        affs=[
            {
                "inGame": True,
                "affordance": {
                    "legalActions": [
                        {
                            "action": "broadcast",
                            "cost": {"energy": 1},
                            "legalTargets": [
                                _target("cardUid", "c-1"),
                                _target("systemId", "6"),
                            ],
                        }
                    ]
                },
            }
        ],
    )
    driver = Driver(fake, RuleDecider())
    code = await driver.run(max_waits=10)
    assert code == 0
    assert "broadcast:c-1:6" in fake.calls


async def test_resolve_strike_maps_option() -> None:
    """pending 打击动作的 option 映射到 resolve_strike_action（无 TypeError）。"""
    class StrikeDecider(RuleDecider):
        def decide(self, view: dict[str, Any], affordance: dict[str, Any]) -> GameAction:
            return GameAction(
                "resolve_strike_action",
                {"option": "move", "strike_uid": "s-9", "target_system": 3},
            )

    fake = FakeClient(waits=[_wait(False)])
    driver = Driver(fake, StrikeDecider())
    act = GameAction(
        "resolve_strike_action",
        {"option": "move", "strike_uid": "s-9", "target_system": 3},
    )
    await driver._exec(act)  # noqa: SLF001
    assert "resolve_strike_action:move:s-9:3" in fake.calls


async def test_requeue_exceeds_limit_gives_up() -> None:
    """连续 match:error 重排超过上限 → 放弃并返回非 0。"""
    fake = FakeClient(
        waits=[
            _wait(True, "match:error"),
            _wait(True, "match:error"),
            _wait(True, "match:error"),
            _wait(True, "match:error"),
            _wait(True, "match:error"),
            _wait(True, "match:error"),
        ],
        statuses=[{"wsState": "connected", "roomId": ""}] * 10,
    )
    driver = Driver(fake, RuleDecider(), max_requeue=2)
    code = await driver.run(max_waits=20)
    assert code == 1
    assert driver.requeue_count > 2


async def test_unknown_action_logged_not_crash() -> None:
    """decide 返回未知动作：记录错误不崩溃。"""
    class WeirdDecider(RuleDecider):
        def decide(self, view: dict[str, Any], affordance: dict[str, Any]) -> GameAction:
            return GameAction("no_such_method")

    fake = FakeClient(
        waits=[_wait(False)],
        views=[_playing_view()],
        affs=[_playing_aff()],
    )
    driver = Driver(fake, WeirdDecider())
    # 直接调 _exec 验证不抛
    await driver._exec(GameAction("no_such_method"))  # noqa: SLF001
    assert True


# --- Task 3 终局权威化 ---


async def test_run_once_returns_authoritative_outcome() -> None:
    """单局 run_once → GameOutcome 承载 gameOver 权威 result/replayId/totalTurn。"""
    fake = FakeClient(
        waits=[
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(False),
            _wait(True, "game:fullSync"),
        ],
        views=[_playing_view(), _game_over_view(result="loss", replay_id="m-42", total_turn=9)],
        affs=[_playing_aff()],
    )
    driver = Driver(fake, RuleDecider())
    outcome = await driver.run_once(max_waits=10)
    assert outcome.exit_code == 0
    assert outcome.result == "loss"  # 权威值，非 LLM/规则猜测
    assert outcome.match_id == "m-42"
    assert outcome.replay_id == "m-42"
    assert outcome.total_turn == 9
    assert driver.state.value == "game_over"


async def test_game_over_view_takes_precedence_over_phase_guess() -> None:
    """权威信号：仅当 gameOver 视图存在才按权威值结算（无 inGame 猜测路径）。"""
    fake = FakeClient(
        waits=[
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(True, "game:fullSync"),
        ],
        # 第二视图带 gameOver：_playing_tick 走权威分支而非 inGame=false 猜测
        views=[_playing_view(), _game_over_view(result="draw", replay_id="m-draw")],
        affs=[_playing_aff()],
    )
    driver = Driver(fake, RuleDecider())
    outcome = await driver.run_once(max_waits=10)
    assert outcome.exit_code == 0
    assert outcome.result == "draw"
    assert outcome.match_id == "m-draw"
    assert "fetch_and_save_replay:m-draw" in fake.calls


async def test_abnormal_end_without_game_over_sets_exit_code_1() -> None:
    """inGame=false 且无 gameOver 权威视图（被踢/房间解散）→ 异常局 exit_code=1。"""
    fake = FakeClient(
        waits=[
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(True, "game:fullSync"),
        ],
        views=[_playing_view(), {"inGame": False}],  # 无 gameOver 字段
        affs=[_playing_aff()],
    )
    driver = Driver(fake, RuleDecider())
    outcome = await driver.run_once(max_waits=10)
    assert outcome.exit_code == 1
    assert outcome.result == ""
    assert outcome.match_id == ""
    assert "gameOver" in outcome.error or outcome.error != ""


# --- 连接稳定性：两级恢复 / 首连重试 / 环境级失败判定 ---


async def test_recover_rebuilds_mcp_transport_before_game_layer() -> None:
    """_recover 两级恢复：先重建 MCP 传输层，再同步游戏层（顺序必须保证）。"""
    fake = FakeClient(statuses=[{"wsState": "connected", "roomId": ""}])
    driver = Driver(fake, RuleDecider())
    from autonomous_driver.state_machine import GamePhase

    driver.state = GamePhase.ERROR
    await driver._recover()  # noqa: SLF001
    assert "reconnect_mcp" in fake.calls
    assert "ensure_connected" in fake.calls
    assert fake.calls.index("reconnect_mcp") < fake.calls.index("ensure_connected")
    assert driver.state == GamePhase.MATCHMAKING


async def test_recover_sets_error_when_reconnect_mcp_fails() -> None:
    """MCP 传输层重建失败 → 置 ERROR（不崩溃、不误排队跳过对局判定）。"""
    class ReconnectFail(FakeClient):
        async def reconnect_mcp(self) -> None:
            self.calls.append("reconnect_mcp")
            raise ConnectionResetError("boom")

    fake = ReconnectFail()
    driver = Driver(fake, RuleDecider())
    from autonomous_driver.state_machine import GamePhase

    driver.state = GamePhase.PLAYING
    await driver._recover()  # noqa: SLF001
    assert driver.state == GamePhase.ERROR
    assert not any("join_match_queue" in c for c in fake.calls)


async def test_connect_with_retry_recovers_after_transient_failure() -> None:
    """首连瞬态失败：指数退避重试后成功，不弃局。"""
    class FlakyConnect(FakeClient):
        def __init__(self) -> None:
            super().__init__()
            self.connect_attempts = 0

        async def connect(self) -> None:
            self.connect_attempts += 1
            self.calls.append("connect")
            if self.connect_attempts == 1:
                raise ConnectionResetError("boom")

    fake = FlakyConnect()
    driver = Driver(fake, RuleDecider(), max_connect_retries=3)
    await driver._connect_with_retry()  # noqa: SLF001
    assert fake.connect_attempts == 2


async def test_connect_with_retry_gives_up_after_exhaustion() -> None:
    """首连重试耗尽：上抛"连接失败"，由 run_once 判为环境级失败。"""
    class AlwaysFail(FakeClient):
        async def connect(self) -> None:
            raise ConnectionResetError("boom")

    fake = AlwaysFail()
    driver = Driver(fake, RuleDecider(), max_connect_retries=2)
    with pytest.raises(Exception, match="连接失败"):
        await driver._connect_with_retry()  # noqa: SLF001


async def test_run_once_connect_failure_is_env_fatal() -> None:
    """首连失败（重试耗尽）→ 异常局；_env_failed 判定为环境级，批量中止。"""
    class AlwaysFail(FakeClient):
        async def connect(self) -> None:
            raise ConnectionResetError("boom")

    fake = AlwaysFail()
    driver = Driver(fake, RuleDecider(), max_connect_retries=1)
    outcome = await driver.run_once()
    assert outcome.exit_code == 1
    assert "连接失败" in outcome.error
    assert driver._env_failed(outcome)  # noqa: SLF001
