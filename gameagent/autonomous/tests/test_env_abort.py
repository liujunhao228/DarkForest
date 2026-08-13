"""环境级失败中止单测（2026-08-13 修复 2：账户池/连接/匹配失败止损）。

背景：双 driver 并行 + 2 账户池时，ai2 第 3 局「账户池中没有可用账户」批量
中止后 ai1 无人匹配，第 2/3 局连续 match:error 直到重排超限（进程滞留占账户
拖垮对方重试）。修复：run_batch 遇环境级失败（连接/排队失败、账户池耗尽、
匹配失败、重排超限）在第 2+ 局也中止剩余局——环境问题重试无意义。

覆盖：
- 第 2 局连接/排队失败（账户池）→ env_aborted=True，整批提前结束
- 首局失败 + smoke_first → 冒烟门先中止（smoke_aborted=True，env 分支不触）
- _env_failed 判定：正常终局 / 无关错误 / 环境关键词
- env_aborted 是批量级标记：下一批 run_batch 重置 False

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
    """按序脚本驱动的 GameMCPClient 替身。

    ``fail_join_at`` 控制第 N 次（1-based）``join_match_queue`` 抛异常（模拟
    连接/排队失败，如账户池耗尽）；0=从不抛。
    """

    def __init__(
        self,
        waits: list[WaitForEventResult] | None = None,
        views: list[dict[str, Any]] | None = None,
        affs: list[dict[str, Any]] | None = None,
        fail_join_at: int = 0,
        join_error_text: str = "账户池中没有可用账户",
    ) -> None:
        self._waits = waits or []
        self._views = views or []
        self._affs = affs or []
        self._fail_join_at = fail_join_at
        self._join_error_text = join_error_text
        self._join_call = 0
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
        self._join_call += 1
        self.calls.append(f"join_match_queue:{game_mode}:{preferred_count}")
        if self._fail_join_at > 0 and self._join_call == self._fail_join_at:
            raise RuntimeError(self._join_error_text)
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


class EndTurnDecider:
    """恒返回 end_turn 的决策器。"""

    def decide(self, view: dict[str, Any], affordance: dict[str, Any]) -> GameAction:
        return GameAction("end_turn")


def _two_game_fake(fail_join_at: int = 0) -> FakeClient:
    """两局正常脚本（每局 match:found → gameStarted → fullSync → 终局）。"""
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
            _game_over_view(result="win", replay_id="r1", total_turn=7),
            _playing_view(),
            _game_over_view(result="loss", replay_id="r2", total_turn=9),
        ],
        affs=[_playing_aff(), _playing_aff()],
        fail_join_at=fail_join_at,
    )


async def test_env_failed_second_game_aborts_batch() -> None:
    """第 2 局连接/排队失败（账户池耗尽）→ env_aborted=True，整批只打 2 局。"""
    fake = _two_game_fake(fail_join_at=2)  # 第 1 局 join 成功，第 2 局抛
    driver = Driver(fake, EndTurnDecider())
    outcomes = await driver.run_batch(3, max_waits=20, smoke_first=False)
    assert len(outcomes) == 2, "第 2 局环境失败后不应再打第 3 局"
    assert outcomes[0].result == "win"
    assert outcomes[1].exit_code == 1
    assert "账户池" in outcomes[1].error
    assert driver.env_aborted is True
    assert driver.smoke_aborted is False  # 非冒烟门触发的批量中止


async def test_env_failed_first_game_with_smoke_first_uses_smoke_gate() -> None:
    """首局环境失败 + smoke_first → 冒烟门中止（smoke_aborted=True）。"""
    fake = FakeClient(
        waits=[_wait(True, "match:found")],
        views=[_playing_view()],
        fail_join_at=1,
    )
    driver = Driver(fake, EndTurnDecider())
    outcomes = await driver.run_batch(2, max_waits=20, smoke_first=True)
    assert len(outcomes) == 1
    assert driver.smoke_aborted is True
    assert driver.env_aborted is False  # 冒烟门先 break，env 分支不触


async def test_env_failed_detection() -> None:
    """_env_failed 判定：正常终局 / 无关错误 / 环境关键词。"""
    driver = Driver(_two_game_fake(), EndTurnDecider())

    ok = driver._compose_outcome(0)
    assert driver._env_failed(ok) is False

    env_account = driver._compose_outcome(
        1,
        error_note=(
            "连接/排队失败: MCP 工具返回非 JSON 内容（无法解析）："
            "获取游戏会话失败: 借用账户失败: 账户池中没有可用账户"
        ),
    )
    assert driver._env_failed(env_account) is True

    env_requeue = driver._compose_outcome(
        1, error_note="重连/重排超过 5 次上限，放弃本场对局"
    )
    assert driver._env_failed(env_requeue) is True

    env_occupied = driver._compose_outcome(
        1, error_note="借用账户失败: 账号 ai1 已被会话 abc123 占用"
    )
    assert driver._env_failed(env_occupied) is True

    unrelated = driver._compose_outcome(1, error_note="主循环异常: boom")
    assert driver._env_failed(unrelated) is False


async def test_env_aborted_resets_between_batches() -> None:
    """env_aborted 是批量级标记：环境失败批置 True，下一批正常批重置 False。"""
    driver = Driver(FakeClient(fail_join_at=1), EndTurnDecider())
    outcomes = await driver.run_batch(2, max_waits=20, smoke_first=False)
    assert len(outcomes) == 1
    assert driver.env_aborted is True

    driver2 = Driver(_two_game_fake(), EndTurnDecider())
    outcomes2 = await driver2.run_batch(2, max_waits=20, smoke_first=False)
    assert len(outcomes2) == 2
    assert driver2.env_aborted is False
