"""driver 循环驱动语义单测（Swarm Step 14，设计文档 §4.3）。

循环驱动：driver 在每个"可动作"时机调 decide——自己回合的每一步 +
非己方回合的强制响应（broadcastAction / pendingAction 非空时）。
driver 侧 ``needs_decide`` 判定 = 三者任一非空；脚本返回 end_turn 或
无可动动作才停止本轮。

覆盖：
- 非己方回合 + broadcastAction 非空 → 仍调 decide（广播强制响应）
- 非己方回合 + pendingAction 非空 → 仍调 decide（打击挂起强制响应）
- 三者全空（非本人回合且无强制动作）→ 不调 decide（继续等待）
- gameOver 权威视图优先于任何可动动作 → 不决策直接结算
- 同回合多 fullSync（多个可动作时机）→ 反复调 decide，直到 end_turn /
  gameOver（循环驱动全流程）

用 FakeClient（duck typing）按序脚本驱动，无真实网络；RecordingDecider
记录 decide 调用次数与收到的 affordance。
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


def _playing_view(is_my_turn: bool = True) -> dict[str, Any]:
    return {
        "inGame": True,
        "agentView": {
            "self": {"energy": 10},
            "cursor": {"turnPhase": "actionPhase", "isMyTurn": is_my_turn},
        },
    }


def _game_over_view(
    result: str = "win", replay_id: str = "replay-1", total_turn: int = 12
) -> dict[str, Any]:
    return {
        "inGame": False,
        "gameOver": {"result": result, "replayId": replay_id, "totalTurn": total_turn},
    }


def _aff(affordance: dict[str, Any]) -> dict[str, Any]:
    return {"inGame": True, "affordance": affordance}


class FakeClient:
    """按序脚本驱动的 GameMCPClient 替身（duck typing，循环驱动路径专用）。"""

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

    # 行动方法（decide 输出的映射目标，记录调用）
    async def play_card(self, card_uid: str) -> dict[str, Any]:
        self.calls.append(f"play_card:{card_uid}")
        return {"success": True}

    async def strike(self, card_uid: str, target_system: int) -> dict[str, Any]:
        self.calls.append(f"strike:{card_uid}:{target_system}")
        return {"success": True}

    async def respond_broadcast(
        self, agreed: bool, card_uid: str | None = None
    ) -> dict[str, Any]:
        self.calls.append(f"respond_broadcast:{agreed}:{card_uid}")
        return {"success": True}

    async def resolve_strike_action(
        self,
        option: str,
        strike_uid: str | None = None,
        target_system: int | None = None,
    ) -> dict[str, Any]:
        self.calls.append(f"resolve_strike_action:{option}:{strike_uid}:{target_system}")
        return {"success": True}

    async def end_turn(self, discard_cards: list[str] | None = None) -> dict[str, Any]:
        self.calls.append("end_turn")
        return {"success": True}


class RecordingDecider:
    """记录 decide 调用次数与收到的 affordance，按序返回预设动作。"""

    def __init__(self, actions: list[GameAction] | None = None) -> None:
        self.actions = list(actions or [])
        self.calls = 0
        self.seen_affordances: list[dict[str, Any]] = []

    def decide(self, view: dict[str, Any], affordance: dict[str, Any]) -> GameAction:
        self.calls += 1
        self.seen_affordances.append(affordance)
        if self.actions:
            return self.actions.pop(0)
        return GameAction("end_turn")


# --- 非己方回合强制响应（needs_decide 判定） ---


async def test_off_turn_broadcast_action_triggers_decide() -> None:
    """非己方回合 + broadcastAction 非空 → 仍调 decide（广播强制响应）。"""
    fake = FakeClient(
        views=[_playing_view(is_my_turn=False)],
        affs=[
            _aff(
                {
                    "broadcastAction": {
                        "type": "agreeOrRefuse",
                        "legalTargets": [{"type": "cardUid", "value": "b1"}],
                    }
                }
            )
        ],
    )
    decider = RecordingDecider(
        [GameAction("respond_broadcast", {"agreed": True, "card_uid": "b1"})]
    )
    driver = Driver(fake, decider)
    await driver._playing_tick()  # noqa: SLF001

    assert decider.calls == 1, "broadcastAction 非空时非己方回合也应决策"
    assert decider.seen_affordances[0]["broadcastAction"]["type"] == "agreeOrRefuse"
    assert "respond_broadcast:True:b1" in fake.calls, "响应动作应被执行"


async def test_off_turn_pending_action_triggers_decide() -> None:
    """非己方回合 + pendingAction 非空 → 仍调 decide（打击挂起强制响应）。"""
    fake = FakeClient(
        views=[_playing_view(is_my_turn=False)],
        affs=[
            _aff(
                {
                    "pendingAction": {
                        "type": "strikeMove",
                        "legalOptions": ["skip_move"],
                        "legalTargets": [],
                    }
                }
            )
        ],
    )
    decider = RecordingDecider([GameAction("resolve_strike_action", {"option": "skip_move"})])
    driver = Driver(fake, decider)
    await driver._playing_tick()  # noqa: SLF001

    assert decider.calls == 1, "pendingAction 非空时非己方回合也应决策"
    assert "resolve_strike_action:skip_move:None:None" in fake.calls


async def test_no_decide_when_affordance_empty() -> None:
    """非己方回合 + 三者全空 → 不调 decide（继续等待，不产生动作）。"""
    fake = FakeClient(
        views=[_playing_view(is_my_turn=False)],
        affs=[_aff({})],
    )
    decider = RecordingDecider()
    driver = Driver(fake, decider)
    # 预置为 PLAYING（模拟对局中），验证 _playing_tick 不推进状态
    from autonomous_driver.state_machine import GamePhase

    driver.state = GamePhase.PLAYING
    await driver._playing_tick()  # noqa: SLF001

    assert decider.calls == 0, "无 pendingAction / broadcastAction / legalActions 时不应决策"
    assert driver.state.value == "playing", "无可动动作应保持 PLAYING 继续等待"
    assert not [c for c in fake.calls if c.startswith(("play_card", "end_turn"))]


# --- gameOver 权威视图优先 ---


async def test_game_over_view_skips_decide() -> None:
    """gameOver 权威视图优先于任何可动动作：不决策，直接结算。"""
    fake = FakeClient(
        views=[_game_over_view(result="loss", replay_id="m-9", total_turn=7)],
        affs=[_aff({"legalActions": [{"action": "end_turn"}]})],
    )
    decider = RecordingDecider([GameAction("end_turn")])
    driver = Driver(fake, decider)
    await driver._playing_tick()  # noqa: SLF001

    assert decider.calls == 0, "gameOver 视图存在时不应调 decide"
    assert driver.state.value == "game_over"
    assert "fetch_and_save_replay" in fake.calls


# --- 循环驱动全流程：同回合多可动作时机 ---


async def test_loop_driven_multiple_decisions_same_turn() -> None:
    """自己回合循环驱动：多个 fullSync（可动作时机）反复调 decide，直到
    end_turn 收尾 → gameOver 结算。decide 调用次数 = 可动作时机数。"""
    fake = FakeClient(
        waits=[
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(True, "game:fullSync"),  # 可动作时机 1 → play_card
            _wait(True, "game:fullSync"),  # 可动作时机 2 → end_turn
            _wait(True, "game:fullSync"),  # 时机 3：gameOver 结算，不再决策
        ],
        views=[
            _playing_view(),  # tick1
            _playing_view(),  # tick2
            _game_over_view(result="win", replay_id="m-42", total_turn=9),  # tick3
        ],
        affs=[
            _aff(
                {
                    "legalActions": [
                        {
                            "action": "play_card",
                            "cost": {"energy": 1},
                            "legalTargets": [{"type": "cardUid", "value": "h1"}],
                        }
                    ]
                }
            ),
            _aff({"legalActions": [{"action": "end_turn", "cost": {"energy": 0}}]}),
        ],
    )
    decider = RecordingDecider(
        [GameAction("play_card", {"card_uid": "h1"}), GameAction("end_turn")]
    )
    driver = Driver(fake, decider)
    outcome = await driver.run_once(max_waits=10)

    # 两个可动作时机各调一次 decide；gameOver 时机不决策
    assert decider.calls == 2
    assert "play_card:h1" in fake.calls
    assert "end_turn" in fake.calls
    assert outcome.exit_code == 0
    assert outcome.result == "win"
    assert outcome.match_id == "m-42"


async def test_loop_driven_pending_then_free_then_end() -> None:
    """循环驱动混合：pending 强制响应 → 自由动作 → end_turn 收尾（优先级链）。"""
    fake = FakeClient(
        waits=[
            _wait(True, "match:found"),
            _wait(True, "room:gameStarted"),
            _wait(True, "game:fullSync"),  # pending 打击选择
            _wait(True, "game:fullSync"),  # 自由动作 strike
            _wait(True, "game:fullSync"),  # gameOver
        ],
        views=[
            _playing_view(),
            _playing_view(),
            _game_over_view(result="draw", replay_id="m-d", total_turn=6),
        ],
        affs=[
            _aff(
                {
                    "pendingAction": {
                        "type": "strikeSelect",
                        "legalOptions": ["skip_select"],
                        "legalTargets": [],
                    }
                }
            ),
            _aff(
                {
                    "legalActions": [
                        {
                            "action": "strike",
                            "cost": {"energy": 2},
                            "legalTargets": [
                                {"type": "cardUid", "value": "s1"},
                                {"type": "systemId", "value": "5"},
                            ],
                        }
                    ]
                }
            ),
        ],
    )
    decider = RecordingDecider(
        [
            GameAction("resolve_strike_action", {"option": "skip_select"}),
            GameAction("strike", {"card_uid": "s1", "target_system": 5}),
        ]
    )
    driver = Driver(fake, decider)
    outcome = await driver.run_once(max_waits=10)

    assert decider.calls == 2
    assert "resolve_strike_action:skip_select:None:None" in fake.calls
    assert "strike:s1:5" in fake.calls
    assert outcome.exit_code == 0
    assert outcome.result == "draw"
