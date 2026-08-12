"""批量模式单测（Task 2）：run_batch 按 games 循环、局间 reset 隔离、异常局不裂变。

用 FakeClient（duck typing）脚本驱动，无真实网络。FakeDecider 记录
reset / on_game_end 钩子调用，验证脚本协议在批量语义下的接线。
"""

from __future__ import annotations

from typing import Any

from autonomous_driver.decide import GameAction, RuleDecider
from autonomous_driver.driver import Driver
from autonomous_driver.mcp_client import GameEvent, WaitForEventResult


def _evt(t: str) -> GameEvent:
    return GameEvent(type=t, timestamp=0)


def _wait(has_event: bool, *types: str) -> WaitForEventResult:
    return WaitForEventResult(
        hasEvent=has_event,
        events=[_evt(t) for t in types] if has_event else [],
    )


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
    """get_agent_view.gameOver 权威视图（GameOverView）。"""
    return {
        "inGame": False,
        "gameOver": {"result": result, "replayId": replay_id, "totalTurn": total_turn},
    }


def _playing_aff() -> dict[str, Any]:
    return {"inGame": True, "affordance": {"legalActions": [{"action": "end_turn"}]}}


class FakeClient:
    """按序脚本驱动的 GameMCPClient 替身（duck typing，精简版：仅批量路径用到的调用）。"""

    def __init__(
        self,
        waits: list[WaitForEventResult] | None = None,
        views: list[dict[str, Any]] | None = None,
        affs: list[dict[str, Any]] | None = None,
    ) -> None:
        self._waits = waits or []
        self._views = views or []
        self._affs = affs or []
        self.calls: list[str] = []

    def _next(self, pool: list[Any], name: str) -> Any:
        self.calls.append(name)
        return pool.pop(0) if pool else {}

    async def connect(self) -> None:
        self.calls.append("connect")

    async def close(self) -> None:
        self.calls.append("close")

    async def ensure_connected(self) -> dict[str, Any]:
        self.calls.append("ensure_connected")
        return {"connected": True}

    async def join_match_queue(
        self, game_mode: str = "classic", preferred_count: int = 2
    ) -> dict[str, Any]:
        self.calls.append(f"join_match_queue:{game_mode}:{preferred_count}")
        return {"joined": True}

    async def get_connection_status(self) -> dict[str, Any]:
        return {"wsState": "connected", "roomId": ""}

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

    async def fetch_and_save_replay(self) -> dict[str, Any]:
        self.calls.append("fetch_and_save_replay")
        return {"replayId": "replay-1"}

    async def end_turn(self, discard_cards: list[str] | None = None) -> dict[str, Any]:
        self.calls.append("end_turn")
        return {"success": True}


class FakeDecider:
    """记录 reset / on_game_end 钩子调用的假决策器（脚本协议验证）。"""

    def __init__(self) -> None:
        self.resets = 0
        self.game_ends: list[tuple[str, str]] = []

    def reset(self) -> None:
        self.resets += 1

    def on_game_end(self, match_id: str, result: str) -> None:
        self.game_ends.append((match_id, result))

    def decide(self, view: dict[str, Any], affordance: dict[str, Any]) -> GameAction:
        return GameAction("end_turn")


def _two_game_fake() -> FakeClient:
    """两局完整脚本：每局 match:found → gameStarted → fullSync → 权威终局视图。"""
    return FakeClient(
        waits=[
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(True, "game:fullSync"),
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(True, "game:fullSync"),
        ],
        views=[
            _playing_view(),
            _game_over_view(result="loss", replay_id="r1", total_turn=9),
            _playing_view(),
            _game_over_view(result="win", replay_id="r2", total_turn=7),
        ],
        affs=[_playing_aff(), _playing_aff()],
    )


async def test_run_batch_plays_n_games_with_reset_isolation() -> None:
    """run_batch(2)：两局完整打完，局间 reset 隔离 + on_game_end 钩子。"""
    decider = FakeDecider()
    driver = Driver(_two_game_fake(), decider)
    outcomes = await driver.run_batch(2, max_waits=20)
    assert len(outcomes) == 2
    assert outcomes[0].exit_code == 0 and outcomes[0].result == "loss"
    assert outcomes[0].match_id == "r1"
    assert outcomes[1].exit_code == 0 and outcomes[1].result == "win"
    assert outcomes[1].match_id == "r2"
    # 钩子按局调用：reset 每局一次，on_game_end 每局一次（含权威 result）
    assert decider.resets == 2
    assert decider.game_ends == [("r1", "loss"), ("r2", "win")]
    # 批量结束后停在最后一局终局状态（正常）；reset() 随时回初始（下一批可复用）
    assert driver.state.value == "game_over"
    driver.reset()
    assert driver.state.value == "idle"
    assert driver.requeue_count == 0


async def test_run_batch_returns_match_id_list() -> None:
    """run_batch 返回结果可提取 match_ids 列表（batch_end 事件数据源）。"""
    driver = Driver(_two_game_fake(), FakeDecider())
    outcomes = await driver.run_batch(2, max_waits=20)
    match_ids = [o.match_id for o in outcomes if o.match_id]
    assert match_ids == ["r1", "r2"]


async def test_run_batch_abnormal_game_does_not_break_batch() -> None:
    """批量中一局异常（无 gameOver 权威视图）→ exit_code=1，不裂变后续局。"""
    fake = FakeClient(
        waits=[
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(True, "game:fullSync"),
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(True, "game:fullSync"),
        ],
        views=[
            _playing_view(),
            _game_over_view(result="win", replay_id="ok-1"),
            _playing_view(),
            {"inGame": False},  # 局2 异常：无 gameOver 权威视图
        ],
        affs=[_playing_aff(), _playing_aff()],
    )
    decider = FakeDecider()
    driver = Driver(fake, decider)
    outcomes = await driver.run_batch(2, max_waits=20)
    assert len(outcomes) == 2
    assert outcomes[0].exit_code == 0 and outcomes[0].match_id == "ok-1"
    assert outcomes[1].exit_code == 1  # 异常局标记，供上层局级重试
    assert outcomes[1].match_id == ""  # 不取 stale 回放 ID
    # on_game_end 仍按局调用，异常局 result 为空串（不猜测胜负）
    assert decider.game_ends == [("ok-1", "win"), ("", "")]
    assert decider.resets == 2


async def test_run_batch_zero_games_returns_empty() -> None:
    """run_batch(0)：不跑任何局，返回空列表（边界防护）。"""
    driver = Driver(FakeClient(), FakeDecider())
    outcomes = await driver.run_batch(0)
    assert outcomes == []


async def test_run_batch_connects_per_game() -> None:
    """批量语义：每局独立 connect/close（局间完全隔离，MCP session 不跨局复用）。"""
    fake = _two_game_fake()
    driver = Driver(fake, FakeDecider())
    await driver.run_batch(2, max_waits=20)
    assert fake.calls.count("connect") == 2
    assert fake.calls.count("close") == 2


async def test_run_compat_returns_int() -> None:
    """POC 兼容层：run() 仍返回 int 退出码（e2e/duel 与旧单测依赖）。"""
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
    code = await driver.run(max_waits=10)
    assert code == 0
    assert isinstance(code, int)
