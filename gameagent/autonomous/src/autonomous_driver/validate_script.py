"""L1 离线校验门（Swarm Step 10，设计文档 §4.5）：``validate_script``。

校验分两段，全部确定性、零对局成本：

1. **导入/结构**：复用 ``load_script_decider``——文件存在 / 可导入 / 定义
   ScriptDecider / 实现 decide / 构造成功。
2. **干跑（dry-run）**：内置 fixture 集（回合开始 / pending 打击选择 /
   广播回应 / 自由动作），循环调 ``decide(view, affordance)`` 直到决策次数
   达上限（默认 50，防脚本内部死循环），逐动作断言：
   - 不抛异常
   - 返回 ``GameAction``
   - 动作名 ∈ 已知动作集（镜像 ``GameMCPClient`` 方法签名）
   - args 键 snake_case 且 ∈ 该动作允许键集

动作名/参数键表**内置在本模块**（不依赖 skill 包——autonomous venv 未必装
darkforest skill，L1 必须自包含）。

CLI 入口 ``python -m autonomous_driver validate --script <path>``（cli.py
validate 子命令）exit 0=通过 / 2=失败；skill 侧 ``spawn_driver`` 前置硬门
子进程调用本命令。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from autonomous_driver.decide import GameAction, ScriptLoadError, load_script_decider

# 干跑决策次数上限（防脚本内部死循环；Open Question 实测校准）
DRY_RUN_MAX_CALLS = 50

# 已知动作集 + 每动作允许的参数键（snake_case，镜像 GameMCPClient 方法签名）。
# 脚本 args 直接作为 client 方法 kwargs 传入——未知键会导致 TypeError，
# 必须在此显式拦截（与 skill validator 的 snake_case 约束一致）。
KNOWN_ACTIONS: dict[str, frozenset[str]] = {
    "play_card": frozenset({"card_uid"}),
    "deploy_card": frozenset({"card_uid"}),
    "strike": frozenset({"card_uid", "target_system"}),
    "broadcast": frozenset({"card_uid", "target_system"}),
    "respond_broadcast": frozenset({"agreed", "card_uid"}),
    "select_broadcast_responder": frozenset({"responder_player_id"}),
    "cancel_broadcast": frozenset(),
    "recycle_card": frozenset({"card_uid"}),
    "end_turn": frozenset({"discard_cards"}),
    "resolve_strike_action": frozenset({"option", "strike_uid", "target_system"}),
    "forfeit_game": frozenset(),
}

# 每动作必填参数键（GameMCPClient 方法签名中的必填位置参数）。
# 缺必填键同样导致 handler(**args) 抛 TypeError——若 L1 不拦，缺参动作会
# 绕过 L2 冒烟阈值（driver._exec 的 TypeError 不计入 rejections），故在此
# 离线阶段一并拦截。可选键（如 respond_broadcast.card_uid、end_turn.discard_cards）
# 不在必填表内。
REQUIRED_KEYS: dict[str, frozenset[str]] = {
    "play_card": frozenset({"card_uid"}),
    "deploy_card": frozenset({"card_uid"}),
    "strike": frozenset({"card_uid", "target_system"}),
    "broadcast": frozenset({"card_uid", "target_system"}),
    "respond_broadcast": frozenset({"agreed"}),
    "select_broadcast_responder": frozenset({"responder_player_id"}),
    "cancel_broadcast": frozenset(),
    "recycle_card": frozenset({"card_uid"}),
    "end_turn": frozenset(),
    "resolve_strike_action": frozenset({"option"}),
    "forfeit_game": frozenset(),
}


@dataclass(frozen=True)
class ValidationResult:
    """L1 校验结果：ok=False 时 reason 为可读失败原因（供 CLI / skill 硬门）。"""

    ok: bool
    reason: str = ""
    steps: int = 0  # 干跑 decide 调用次数


def _fixture_turn_start() -> tuple[dict[str, Any], dict[str, Any]]:
    """回合开始：自由动作集（出牌/部署/回收/end_turn）。"""
    view: dict[str, Any] = {
        "inGame": True,
        "agentView": {
            "self": {"energy": 10, "hand": ["h1", "h2"], "faceUpCards": ["f1"]},
            "cursor": {"turnPhase": "actionPhase", "isMyTurn": True, "totalTurn": 1},
            "events": {"entries": [{"type": "turn_start", "message": "你的回合"}]},
        },
    }
    affordance: dict[str, Any] = {
        "inGame": True,
        "affordance": {
            "legalActions": [
                {
                    "action": "play_card",
                    "cost": {"energy": 1},
                    "legalTargets": [{"type": "cardUid", "value": "h1"}],
                },
                {
                    "action": "deploy_card",
                    "cost": {"energy": 2},
                    "legalTargets": [{"type": "cardUid", "value": "h2"}],
                },
                {
                    "action": "recycle_card",
                    "cost": {"energy": 0},
                    "legalTargets": [{"type": "cardUid", "value": "f1"}],
                },
                {"action": "end_turn", "cost": {"energy": 0}, "legalTargets": []},
            ]
        },
    }
    return view, affordance


def _fixture_pending() -> tuple[dict[str, Any], dict[str, Any]]:
    """强制挂起动作：打击选择（select，带 strikeUid/systemId 目标）。"""
    view: dict[str, Any] = {
        "inGame": True,
        "agentView": {
            "self": {"energy": 10},
            "cursor": {"isMyTurn": True, "totalTurn": 3},
        },
    }
    affordance: dict[str, Any] = {
        "inGame": True,
        "affordance": {
            "pendingAction": {
                "type": "select",
                "legalOptions": ["skip_select", "select"],
                "legalTargets": [
                    {"type": "strikeUid", "value": "st1"},
                    {"type": "systemId", "value": "3"},
                ],
            }
        },
    }
    return view, affordance


def _fixture_broadcast() -> tuple[dict[str, Any], dict[str, Any]]:
    """广播待处理：回应（agreeOrRefuse，非己方回合也要回应）。"""
    view: dict[str, Any] = {
        "inGame": True,
        "agentView": {
            "self": {"energy": 10},
            "cursor": {"isMyTurn": False, "totalTurn": 5},
        },
    }
    affordance: dict[str, Any] = {
        "inGame": True,
        "affordance": {
            "broadcastAction": {
                "type": "agreeOrRefuse",
                "legalTargets": [{"type": "cardUid", "value": "b1"}],
            }
        },
    }
    return view, affordance


def _fixture_strike_free() -> tuple[dict[str, Any], dict[str, Any]]:
    """自由动作：broadcast / strike（带卡牌 + 星系目标）。"""
    view: dict[str, Any] = {
        "inGame": True,
        "agentView": {
            "self": {"energy": 10},
            "cursor": {"isMyTurn": True, "totalTurn": 7},
        },
    }
    affordance: dict[str, Any] = {
        "inGame": True,
        "affordance": {
            "legalActions": [
                {
                    "action": "broadcast",
                    "cost": {"energy": 0},
                    "legalTargets": [
                        {"type": "cardUid", "value": "b1"},
                        {"type": "systemId", "value": "2"},
                    ],
                },
                {
                    "action": "strike",
                    "cost": {"energy": 3},
                    "legalTargets": [
                        {"type": "cardUid", "value": "s1"},
                        {"type": "systemId", "value": "5"},
                    ],
                },
                {"action": "end_turn", "cost": {"energy": 0}, "legalTargets": []},
            ]
        },
    }
    return view, affordance


def _fixtures() -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """L1 干跑 fixture 集（代表性场景；Open Question 按实测扩覆盖）。"""
    return [
        _fixture_turn_start(),
        _fixture_pending(),
        _fixture_broadcast(),
        _fixture_strike_free(),
    ]


def _check_action(action: GameAction, *, call_no: int) -> str:
    """单动作断言：动作名 ∈ 已知动作集、args 键 snake_case 且 ∈ 允许键集、
    必填键齐全。

    返回空串=通过；否则为可读失败原因。
    """
    allowed = KNOWN_ACTIONS.get(action.name)
    if allowed is None:
        return (
            f"第 {call_no} 次决策动作名 {action.name!r} 不在已知动作集 "
            f"{sorted(KNOWN_ACTIONS)} 中"
        )
    unknown = [k for k in action.args if k not in allowed]
    if unknown:
        return (
            f"第 {call_no} 次决策动作 {action.name} 参数名错误（应为 snake_case）："
            f"{unknown}。合法参数：{sorted(allowed)}"
        )
    missing = [k for k in REQUIRED_KEYS.get(action.name, ()) if k not in action.args]
    if missing:
        return (
            f"第 {call_no} 次决策动作 {action.name} 缺少必填参数：{missing}。"
            f"必填参数：{sorted(REQUIRED_KEYS[action.name])}"
        )
    return ""


def validate_script(script_path: str, max_calls: int = DRY_RUN_MAX_CALLS) -> ValidationResult:
    """L1 离线校验：导入/结构 + 干跑。

    :param script_path: 脚本文件路径（rules/<name>/v<N>.py）
    :param max_calls: 干跑 decide 总调用上限（防脚本内部死循环）
    :return: ValidationResult；ok=False 时 reason 可读（供 CLI exit 2 / skill 硬门）
    """
    # ① 导入/结构（ScriptLoadError 即校验失败，reason 直接透传）
    try:
        decider = load_script_decider(script_path)
    except ScriptLoadError as exc:
        return ValidationResult(ok=False, reason=str(exc))

    # ② 干跑：循环喂 fixture（有状态脚本的状态累积也被覆盖），逐动作断言
    fixtures = _fixtures()
    steps = 0
    for call_no in range(1, max_calls + 1):
        view, affordance = fixtures[(call_no - 1) % len(fixtures)]
        try:
            action = decider.decide(view, affordance)
        except Exception as exc:  # noqa: BLE001  脚本任意异常都要转为可读失败
            return ValidationResult(ok=False, reason=f"第 {call_no} 次决策抛异常: {exc}")
        if not isinstance(action, GameAction):
            return ValidationResult(
                ok=False,
                reason=f"第 {call_no} 次决策返回 {type(action).__name__}，应为 GameAction",
            )
        problem = _check_action(action, call_no=call_no)
        if problem:
            return ValidationResult(ok=False, reason=problem)
        steps += 1
    return ValidationResult(ok=True, reason="", steps=steps)
