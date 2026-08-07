"""广播交互提示渲染器。

为 push_callback 与 .state 命令提供广播者侧进度提示与结算/取消结果提示。

两个公开函数均为纯计算，无 I/O：
- ``render_broadcast_broadcaster_hint(vs)`` — 当本地玩家是广播者时按
  ``vs.broadcast.phase`` 输出 4 节点提示（waiting/select/reveal/None）。
- ``render_broadcast_resolution_hint(vs, last_broadcast_card_uid, local_player_id)``
  — 在 ``vs.logs`` 末尾倒查最近 5 条找最近一条 ``type="broadcast"`` 日志，
  按本地玩家角色（广播者/响应者/旁观者）将日志原文替换为个人视角输出。

未识别的日志格式回退为 ``"广播已结束，.log 查看详情"``。
"""

from __future__ import annotations

from darkforest_bot.backend.view_state import (
    BroadcastStateView,
    LogEntry,
    PlayerView,
    ViewState,
)

# 最近 N 条日志中查找 broadcast 类型结算日志。
_BROADCAST_LOG_SEARCH_WINDOW: int = 5


def render_broadcast_broadcaster_hint(vs: ViewState) -> str:
    """渲染广播者侧的进度提示。

    仅当本地玩家是 ``vs.broadcast.broadcaster_id`` 时输出提示；否则返回空串。

    按 ``vs.broadcast.phase`` 分支：
    - ``"waiting"``：列出待响应 / 已同意 / 已拒绝的玩家名。
    - ``"select"``：列出已同意者，提示 ``.select``。
    - ``"reveal"``：返回空串（select 后立即 resolve，由 resolution hint 接管）。
    - broadcast 为 None：返回空串（由 resolution hint 处理）。
    """
    broadcast = vs.broadcast
    if broadcast is None:
        return ""
    if broadcast.broadcaster_id != vs.local_player_id:
        return ""
    return _render_broadcaster_hint_for_phase(broadcast)


def _render_broadcaster_hint_for_phase(broadcast: BroadcastStateView) -> str:
    """按 broadcast.phase 分支输出提示文字。"""
    phase = broadcast.phase
    if phase == "waiting":
        return _render_waiting_hint(broadcast)
    if phase == "select":
        return _render_select_hint(broadcast)
    # reveal 与未知 phase 均不推送（reveal 由 resolution hint 接管，未知保守返回空）。
    return ""


def _render_waiting_hint(broadcast: BroadcastStateView) -> str:
    """渲染 waiting 阶段的响应进度。"""
    pending_names = [
        r.player_name
        for r in broadcast.responses
        if not r.responded and r.can_respond
    ]
    agreed_names = [
        r.player_name
        for r in broadcast.responses
        if r.responded and r.agreed
    ]
    refused_names = [
        r.player_name
        for r in broadcast.responses
        if r.responded and not r.agreed
    ]
    pending = ", ".join(pending_names) if pending_names else "无"
    agreed = ", ".join(agreed_names) if agreed_names else "无"
    refused = ", ".join(refused_names) if refused_names else "无"
    return (
        f"广播进行中（星系 {broadcast.target_system}）："
        f"待响应 {pending}；已同意 {agreed}；已拒绝 {refused}。.bcancel 取消"
    )


def _render_select_hint(broadcast: BroadcastStateView) -> str:
    """渲染 select 阶段（全部响应完毕，有 agree）的提示。"""
    agreed_names = [
        r.player_name
        for r in broadcast.responses
        if r.responded and r.agreed
    ]
    agreed = ", ".join(agreed_names) if agreed_names else "无"
    return (
        f"全部响应完毕。同意者：{agreed}。"
        f".select <玩家名> 选择 / .bcancel 取消"
    )


def render_broadcast_resolution_hint(
    vs: ViewState,
    last_broadcast_card_uid: str,
    local_player_id: str,
) -> str:
    """渲染广播结算/取消结果提示（个人视角）。

    在 ``vs.logs`` 末尾倒查最近 5 条找最近一条 ``type="broadcast"`` 日志，
    按本地玩家角色（广播者/被选中响应者）将日志原文替换为个人视角输出。

    本函数仅在 ``push_callback`` 触发时被调用，而 ``push_callback`` 仅对
    当事人（广播者或被选中响应者）触发（旁观者 ``push_key`` 不变化）。
    因此本函数可假设本地一定是当事人，仅根据日志原文中的玩家名判定
    本地是伪装者还是被伪装者。未识别日志格式回退为
    ``"广播已结束，.log 查看详情"``。

    Args:
        vs: 当前 ViewState 缓存。
        last_broadcast_card_uid: 上一次推送时的 ``broadcast.card_uid``，
            为空串时直接返回空（无活跃广播历史）。
        local_player_id: 本地玩家 ID。

    Returns:
        个人视角的结算/取消提示文字；无 broadcast 日志或无活跃广播历史
        时返回空串或回退提示。
    """
    if not last_broadcast_card_uid:
        return ""

    log = _find_last_broadcast_log(vs.logs)
    if log is None:
        return "广播已结束，.log 查看详情"

    local_name = _lookup_player_name(vs.players, local_player_id)
    if local_name is None:
        # 本地玩家不在 players 中（异常状态），返回原文保守处理。
        return log.message

    return _render_personal_perspective(log.message, local_name)


def _find_last_broadcast_log(logs: list[LogEntry]) -> LogEntry | None:
    """在 logs 末尾倒查最近 _BROADCAST_LOG_SEARCH_WINDOW 条找 type=broadcast 日志。"""
    # 只看末尾 5 条，避免遍历整个 logs。
    window = logs[-_BROADCAST_LOG_SEARCH_WINDOW:]
    for log in reversed(window):
        if log.type == "broadcast":
            return log
    return None


def _lookup_player_name(
    players: list[PlayerView], player_id: str
) -> str | None:
    """从 players 列表中按 id 查找玩家名。"""
    for p in players:
        if p.id == player_id:
            return p.name
    return None


def _render_personal_perspective(
    message: str,
    local_name: str,
) -> str:
    """将日志原文按本地玩家角色替换为个人视角。

    本函数假设本地一定是当事人（由 push_callback 触发条件保证）。
    按日志原文中的玩家名判定本地是伪装者/合作者/广播者。

    Args:
        message: 原始日志文本（如 "双方合作! Alice 和 Bob 各获得 3 点能量"）。
        local_name: 本地玩家名（如 "Alice"）。

    Returns:
        个人视角的提示文字；未识别格式回退为 ".log 查看详情"。
    """
    try:
        # 合作场景：双方合作! X 和 Y 各获得 3 点能量
        if "双方合作!" in message and "各获得 3 点能量" in message:
            return _render_cooperation_perspective(message, local_name)

        # 单方伪装场景：X 伪装成功! 获得 5 点能量
        if "伪装成功!" in message and "获得 5 点能量" in message:
            return _render_bluff_perspective(message, local_name)

        # 双方伪装场景：双方伪装! 无人获得能量
        if "双方伪装!" in message and "无人获得能量" in message:
            # 本地一定是当事人（push_callback 只对当事人触发）
            return "双方伪装，无人获得能量"

        # 取消场景：无人回应(广播)?, X 获得 1 点能量
        if "无人回应" in message and "获得 1 点能量" in message:
            return _render_cancellation_perspective(message, local_name)

        # 未识别格式
        return "广播已结束，.log 查看详情"
    except Exception:
        # 解析异常时保守回退
        return "广播已结束，.log 查看详情"


def _render_cooperation_perspective(
    message: str,
    local_name: str,
) -> str:
    """渲染合作结算的个人视角。

    日志格式：``"双方合作! Alice 和 Bob 各获得 3 点能量"``
    本地是 Alice → "你与 Bob 双方合作，你获得 3 能量、抽 1 牌，对方获得 3 能量"
    本地是 Bob → "你与 Alice 双方合作，你获得 3 能量、抽 1 牌，对方获得 3 能量"

    若 local_name 不在两个名字中（异常），返回原文保守处理。
    """
    prefix_marker = "双方合作!"
    suffix_marker = " 各获得 3 点能量"
    start = message.index(prefix_marker) + len(prefix_marker)
    end = message.index(suffix_marker, start)
    names_segment = message[start:end].strip()
    # names_segment 形如 "Alice 和 Bob"
    parts = names_segment.split(" 和 ")
    if len(parts) != 2:
        return message
    p1_name, p2_name = parts[0].strip(), parts[1].strip()

    if local_name == p1_name:
        other = p2_name
    elif local_name == p2_name:
        other = p1_name
    else:
        # 本地不在双方中（异常），返回原文。
        return message

    return (
        f"你与 {other} 双方合作，你获得 3 能量、抽 1 牌，"
        f"对方获得 3 能量"
    )


def _render_bluff_perspective(
    message: str,
    local_name: str,
) -> str:
    """渲染伪装结算的个人视角。

    日志格式：``"X 伪装成功! 获得 5 点能量"``
    X 是伪装者（可能是广播者或响应者）。伪装者获得 5 能量。

    本地是伪装者 X → "你伪装成功，获得 5 能量"
    本地是被伪装者（对方伪装）→ "对方 X 伪装成功，对方获得 5 能量"

    本函数假设本地一定是当事人（push_callback 触发条件保证），
    所以本地不是伪装者时一定是被伪装者。
    """
    marker = " 伪装成功!"
    end = message.index(marker)
    bluffer_name = message[:end].strip()

    if bluffer_name == local_name:
        return "你伪装成功，获得 5 能量"

    # 本地是被伪装者（对方伪装）
    return f"对方 {bluffer_name} 伪装成功，对方获得 5 能量"


def _render_cancellation_perspective(
    message: str,
    local_name: str,
) -> str:
    """渲染取消结算的个人视角。

    日志格式（两种）：
    - ``"无人回应, X 获得 1 点能量"`` （CancelBroadcast 主动取消，X 是广播者）
    - ``"无人回应广播, X 获得 1 点能量"`` （InitiateBroadcast 无人可响应）

    本地是 X（广播者） → "广播取消，你退还 1 能量"
    本地不是 X → "广播取消，{X} 退还 1 能量"
    """
    marker = " 获得 1 点能量"
    end = message.index(marker)
    # 取 end 之前最后一个 ", " 之后的内容。
    prefix = message[:end]
    last_comma = prefix.rfind(", ")
    if last_comma == -1:
        return "广播已结束，.log 查看详情"
    broadcaster_name = prefix[last_comma + 2 :].strip()

    if broadcaster_name == local_name:
        return "广播取消，你退还 1 能量"
    return f"广播取消，{broadcaster_name} 退还 1 能量"
