"""显式状态机：事件批驱动的对局流转（纯逻辑，无 IO，可单测）。

状态：IDLE → CONNECTING → MATCHMAKING → IN_ROOM → PLAYING → GAME_OVER / ERROR。
迁移由 wait_for_event 返回的事件批驱动；PLAYING 内的"是否决策"由快照检查
（check_playing）驱动。状态机只产出"待执行动作"，不直接调工具——driver
主循环把 DriverAction 映射为 GameMCPClient 调用。

设计铁律（对齐设计文档）：
- 以状态为准、事件为驱动：事件丢失不影响状态机（状态由 fullSync 兜底）；
  迁移只依赖事件类型，不依赖事件 payload 完整性。
- 单消费者：一实例一状态机实例。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from autonomous_driver.mcp_client import GameEvent


class GamePhase(StrEnum):
    """对局驾驶器状态。"""

    IDLE = "idle"
    CONNECTING = "connecting"
    MATCHMAKING = "matchmaking"
    IN_ROOM = "in_room"
    PLAYING = "playing"
    GAME_OVER = "game_over"
    ERROR = "error"


@dataclass(frozen=True)
class DriverAction:
    """状态机产出的待执行动作。

    name 语义（driver 主循环映射）：
    - connect          → GameMCPClient.ensure_connected
    - join_queue       → GameMCPClient.join_match_queue
    - decide           → 调决策大脑（规则策略），执行返回的 Action
    - fetch_replay     → GameMCPClient.fetch_and_save_replay
    - log              → driver 日志（不调工具）
    """

    name: str
    args: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Transition:
    """状态迁移结果：新状态 + 待执行动作列表。"""

    state: GamePhase
    actions: list[DriverAction] = field(default_factory=list)


# 事件类型常量（对齐 gamesdk protocol.go 的入队事件）
EVENT_MATCH_FOUND = "match:found"
EVENT_MATCH_QUEUE_CANCELLED = "match:queueCancelled"
EVENT_MATCH_ERROR = "match:error"
EVENT_ROOM_JOINED = "room:joined"
EVENT_ROOM_GAME_STARTED = "room:gameStarted"
EVENT_ROOM_ACTIVE_ROOM_FOUND = "room:activeRoomFound"
EVENT_GAME_FULL_SYNC = "game:fullSync"
EVENT_RECONNECT = "reconnect"

# 匹配失败类事件（→ ERROR）
_MATCH_FAILURE_EVENTS = (EVENT_MATCH_ERROR, EVENT_MATCH_QUEUE_CANCELLED)


def initial() -> GamePhase:
    """驾驶器初始状态。"""
    return GamePhase.IDLE


def transition(state: GamePhase, events: list[GameEvent]) -> Transition:
    """事件批 → 状态迁移（纯逻辑）。

    规则（按优先级，取第一个触发迁移的事件）：
    - 任意状态收到 room:activeRoomFound → IN_ROOM（存在可重连的进行中对局）
    - MATCHMAKING 收到 match:found → IN_ROOM
    - IN_ROOM 收到 room:gameStarted → PLAYING
    - MATCHMAKING 收到 match:error / match:queueCancelled → ERROR
    - 其余事件不迁移（保持当前状态，动作为空）
    """
    for evt in events:
        t = evt.type
        if t == EVENT_ROOM_ACTIVE_ROOM_FOUND:
            return Transition(GamePhase.IN_ROOM)
        if state == GamePhase.MATCHMAKING and t == EVENT_MATCH_FOUND:
            return Transition(GamePhase.IN_ROOM)
        if state == GamePhase.IN_ROOM and t == EVENT_ROOM_GAME_STARTED:
            return Transition(GamePhase.PLAYING)
        if state == GamePhase.MATCHMAKING and t in _MATCH_FAILURE_EVENTS:
            return Transition(
                GamePhase.ERROR,
                [DriverAction("log", {"level": "warn", "msg": f"匹配失败事件: {t}"})],
            )
    return Transition(state)


def check_playing(
    *,
    phase: str | None = None,
    game_over: dict[str, Any] | None = None,
    is_my_turn: bool = False,
    has_pending: bool = False,
) -> Transition:
    """PLAYING 状态的快照检查（每轮事件后由 driver 调用）。

    - game_over 非空（get_agent_view.gameOver 权威视图，Task 3 终局权威化主信号）
      → GAME_OVER，动作 fetch_replay
    - phase == "gameOver"（ViewState.Phase 旧兼容信号）→ GAME_OVER，动作 fetch_replay
    - is_my_turn 或 has_pending（affordance）→ 保持 PLAYING，动作 decide
    - 否则 → 保持 PLAYING，无动作（继续等待）
    """
    if game_over is not None or phase == "gameOver":
        return Transition(GamePhase.GAME_OVER, [DriverAction("fetch_replay")])
    if is_my_turn or has_pending:
        return Transition(GamePhase.PLAYING, [DriverAction("decide")])
    return Transition(GamePhase.PLAYING)
