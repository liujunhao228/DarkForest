"""L2 首局即冒烟单测（Swarm Step 10，设计文档 §4.5）：run_batch(smoke_first=True)。

- 首局 exit_code≠0（无 gameOver 权威视图的异常局）→ 中止剩余局 + smoke_aborted
- 首局 rejections ≥ 阈值（后端拒绝 success=false）→ 中止剩余局 + smoke_aborted
- 首局正常 → 整批打完，smoke_aborted=False
- smoke_first=False（默认）→ 首局异常不中止（沿用批量容错语义）

用 FakeClient（duck typing）脚本驱动，无真实网络。
"""

from __future__ import annotations

from typing import Any

from autonomous_driver.decide import GameAction
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
    return {
        "inGame": False,
        "gameOver": {"result": result, "replayId": replay_id, "totalTurn": total_turn},
    }


def _playing_aff() -> dict[str, Any]:
    return {"inGame": True, "affordance": {"legalActions": [{"action": "end_turn"}]}}


class FakeClient:
    """按序脚本驱动的 GameMCPClient 替身（duck typing）。

    ``reject_end_turns`` 控制 end_turn 返回 success=false 的次数（模拟后端
    拒绝，触发 rejections 计数）。
    """

    def __init__(
        self,
        waits: list[WaitForEventResult] | None = None,
        views: list[dict[str, Any]] | None = None,
        affs: list[dict[str, Any]] | None = None,
        reject_end_turns: int = 0,
    ) -> None:
        self._waits = waits or []
        self._views = views or []
        self._affs = affs or []
        self._reject_left = reject_end_turns
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
        if self._reject_left > 0:
            self._reject_left -= 1
            return {"success": False, "error": "阶段不匹配", "errorCode": "PHASE_MISMATCH"}
        return {"success": True}


class EndTurnDecider:
    """恒返回 end_turn 的决策器（每回合调一次 end_turn 可被拒绝计数）。"""

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


async def test_smoke_first_normal_batch_plays_all() -> None:
    """首局正常：整批 2 局打完，smoke_aborted=False。"""
    driver = Driver(_two_game_fake(), EndTurnDecider())
    outcomes = await driver.run_batch(2, max_waits=20, smoke_first=True)
    assert len(outcomes) == 2
    assert outcomes[0].result == "loss" and outcomes[1].result == "win"
    assert driver.smoke_aborted is False


async def test_smoke_first_abnormal_first_game_aborts() -> None:
    """首局异常（无 gameOver 权威视图）→ 中止，只打 1 局，smoke_aborted=True。"""
    fake = FakeClient(
        waits=[
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(True, "game:fullSync"),
            _wait(True, "match:found"),  # 不应被消费（中止）
        ],
        views=[
            _playing_view(),
            {"inGame": False},  # 局1 异常：被踢/房间解散
        ],
        affs=[_playing_aff()],
    )
    driver = Driver(fake, EndTurnDecider())
    outcomes = await driver.run_batch(3, max_waits=20, smoke_first=True)
    assert len(outcomes) == 1
    assert outcomes[0].exit_code == 1
    assert driver.smoke_aborted is True
    # 第二局没跑（只入队一次）
    assert fake.calls.count("join_match_queue:classic:2") == 1


async def test_smoke_first_rejections_threshold_aborts() -> None:
    """首局 rejections ≥ 阈值（后端拒绝 5 次）→ 中止，GameOutcome.rejections 计数。"""
    # 每次事件迭代触发一次 playing tick（gameStarted + 4×fullSync = 5 次 end_turn 全被拒绝）
    fake = FakeClient(
        waits=[_wait(True, "match:found"), _wait(True, "room:gameStarted")]
        + [_wait(True, "game:fullSync")] * 5,
        views=[_playing_view()] * 5
        + [_game_over_view(result="win", replay_id="r1", total_turn=9)],
        affs=[_playing_aff()] * 5,
        reject_end_turns=5,
    )
    driver = Driver(fake, EndTurnDecider(), smoke_rejection_threshold=5)
    outcomes = await driver.run_batch(3, max_waits=20, smoke_first=True)
    assert len(outcomes) == 1
    assert outcomes[0].exit_code == 0  # 对局正常结束（拒绝不致命）
    assert outcomes[0].rejections >= 5
    assert driver.smoke_aborted is True


async def test_smoke_first_below_threshold_plays_all() -> None:
    """首局 rejections 低于阈值：不中止，整批打完。"""
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
            _game_over_view(result="loss", replay_id="r1", total_turn=9),
            _playing_view(),
            _game_over_view(result="win", replay_id="r2", total_turn=7),
        ],
        affs=[_playing_aff(), _playing_aff()],
        reject_end_turns=2,  # 低于阈值 5
    )
    driver = Driver(fake, EndTurnDecider(), smoke_rejection_threshold=5)
    outcomes = await driver.run_batch(2, max_waits=20, smoke_first=True)
    assert len(outcomes) == 2
    assert outcomes[0].rejections == 1  # 每局 1 次拒绝，低于阈值 5
    assert outcomes[1].rejections == 1
    assert driver.smoke_aborted is False


async def test_smoke_first_off_keeps_batch_tolerance() -> None:
    """smoke_first=False（默认）：首局异常不中止，后续局照打（POC 容错语义）。"""
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
            {"inGame": False},  # 局1 异常
            _playing_view(),
            _game_over_view(result="win", replay_id="r2", total_turn=7),
        ],
        affs=[_playing_aff(), _playing_aff()],
    )
    driver = Driver(fake, EndTurnDecider())
    outcomes = await driver.run_batch(2, max_waits=20, smoke_first=False)
    assert len(outcomes) == 2
    assert outcomes[0].exit_code == 1
    assert outcomes[1].exit_code == 0
    assert driver.smoke_aborted is False


async def test_smoke_aborted_resets_between_batches() -> None:
    """smoke_aborted 是批量级标记：下一批 run_batch 重新置 False。"""
    bad_fake = FakeClient(
        waits=[
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(True, "game:fullSync"),
        ],
        views=[_playing_view(), {"inGame": False}],
        affs=[_playing_aff()],
    )
    driver = Driver(bad_fake, EndTurnDecider())
    await driver.run_batch(3, max_waits=20, smoke_first=True)
    assert driver.smoke_aborted is True

    await driver.run_batch(0)  # 空批：标记复位
    assert driver.smoke_aborted is False
