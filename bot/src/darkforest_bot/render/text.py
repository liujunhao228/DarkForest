"""Text summary formatters for QQ bot private-message replies.

Pure functions:
- ``render_text_summary`` — turn-line + phase + local player's energy and hand.
- ``render_logs`` — last N log entries with turn and type labels.
- ``render_pending_hint`` — one-line PendingAction or broadcast-response hint
  (P4). Appended to push / .state replies when the local player has something
  to act on.

All functions are pure (no I/O, no side effects, no logging) so they are
trivially testable. ``ViewState`` is the typed cache built by the
``game_session`` module from fullSync/deltaSync events.
"""

from __future__ import annotations

from darkforest_bot.backend.view_state import Card, ViewState

# Card type → Chinese label for hand summary. Unknown types fall through
# unchanged so the bot can ship new card types without code changes.
_CARD_TYPE_LABELS: dict[str, str] = {
    "broadcast": "广播",
    "strike": "打击",
    "defense": "防御",
    "facility": "设施",
}

# Broadcast subtype → Chinese label for hand summary. Mirrors the frontend's
# (cooperation/合作, disguise/伪装). Unknown subtypes fall through unchanged.
_BROADCAST_SUBTYPE_LABELS: dict[str, str] = {
    "cooperation": "合作",
    "disguise": "伪装",
}

# Log type → Chinese label. Same fallthrough rule as card types.
_LOG_TYPE_LABELS: dict[str, str] = {
    "info": "信息",
    "action": "行动",
    "combat": "战斗",
    "system": "系统",
    "broadcast": "广播",
}


def _card_type_label(card_type: str) -> str:
    return _CARD_TYPE_LABELS.get(card_type, card_type)


def _broadcast_subtype_label(subtype: str | None) -> str | None:
    if subtype is None:
        return None
    return _BROADCAST_SUBTYPE_LABELS.get(subtype, subtype)


def _log_type_label(log_type: str) -> str:
    return _LOG_TYPE_LABELS.get(log_type, log_type)


def render_player_list(state: ViewState, local_player_id: str) -> str:
    """渲染本局玩家列表，每行带 1-based 序号。

    每行格式：``{idx}. {name}{suffix}``，其中 suffix 为 `` (你)``（本地玩家）
    和 `` (淘汰)``（已淘汰玩家）的组合。该序号即玩家局内 ID，供 ``.strike``
    等命令指定目标玩家使用。

    ``state.players`` 为空时返回空串（调用方应跳过）。

    Args:
        state: Typed ViewState cache.
        local_player_id: 本地玩家 ID，用于标记 ``(你)``。

    Returns:
        多行字符串，首行为 ``"玩家列表:"``；players 为空时返回 ``""``。
    """
    if not state.players:
        return ""

    lines: list[str] = ["玩家列表:"]
    for idx, p in enumerate(state.players, start=1):
        suffix = ""
        if p.id == local_player_id:
            suffix += " (你)"
        if p.eliminated:
            suffix += " (淘汰)"
        lines.append(f"{idx}. {p.name}{suffix}")
    return "\n".join(lines)


def render_local_face_up(state: ViewState, local_player_id: str) -> str:
    """Render the local player's own 场上门牌 (face-up cards) in brief text form.

    Same grouping/labeling rule as ``render_opponents_face_up`` but for the
    local player. Returns ``""`` when the local player is not found in
    ``state.players`` or has no face-up cards (no noise otherwise).
    """
    local = next(
        (p for p in state.players if p.id == local_player_id), None
    )
    if local is None or not local.face_up_cards:
        return ""

    chunks: list[str] = ["你的门牌："]
    chunks.extend(_render_face_up_brief(local.face_up_cards))
    return "\n".join(chunks)


def render_opponents_face_up(state: ViewState, local_player_id: str) -> str:
    """Render each opponent's 场上门牌 (face-up cards) in brief text form.

    Mirrors the frontend's "简略" (brief) door-card display mode
    (``OnlinePlayerHand.tsx`` / ``groupCardsByDefId``): cards are grouped by
    ``defId``, each line is ``[类型] 名称 ×数量``. Since QQ text cannot show a
    color dot, the card's type label replaces the frontend's colored swatch.

    Opponents exclude the local player and eliminated players, and only
    opponents who actually have face-up cards are listed (no noise otherwise).
    Returns ``""`` when there is nobody to show.
    """
    opponents = [
        p
        for p in state.players
        if p.id != local_player_id and not p.eliminated and p.face_up_cards
    ]
    if not opponents:
        return ""

    chunks: list[str] = []
    for opp in opponents:
        chunks.append(f"{opp.name} 的门牌：")
        chunks.extend(_render_face_up_brief(opp.face_up_cards))
    return "\n".join(chunks)


def render_flying_strikes(state: ViewState) -> str:
    """Render in-flight strikes in text form.

    Mirrors the frontend ``FlyingStrikesList`` component: a ``飞行中的打击``
    header, then per strike ``{strikeName} (Lv.{level})`` (with a ``待生效``
    mark when ``arrived``), ``发射者: {owner}`` (a ``(你)`` suffix for own
    strikes), and ``位置: {position} → 目标: {targetSystem}``.

    Returns ``""`` when there are no in-flight strikes (callers should skip).
    """
    strikes = state.flying_strikes
    if not strikes:
        return ""

    players_by_id = {p.id: p.name for p in state.players}
    lines: list[str] = ["飞行中的打击："]
    first = True
    for s in strikes:
        if not first:
            lines.append("")
        first = False
        line = f"{s.strike_name} (Lv.{s.level})"
        if s.arrived:
            line += " · 待生效"
        lines.append(line)
        owner = players_by_id.get(s.owner_id)
        if owner is None:
            owner_str = str(s.owner_id)
        elif s.owner_id == state.local_player_id:
            owner_str = f"{owner} (你)"
        else:
            owner_str = owner
        lines.append(f"发射者: {owner_str}")
        lines.append(f"位置: {s.position} → 目标: {s.target_system}")
    return "\n".join(lines)


def _group_by_def_id(cards: list[Card]) -> list[tuple[Card, int]]:
    """Group cards by defId, preserving first-seen order. Mirrors frontend ``groupCardsByDefId``."""
    order: list[str] = []
    groups: dict[str, list[Card]] = {}
    for card in cards:
        if card.def_id not in groups:
            groups[card.def_id] = []
            order.append(card.def_id)
        groups[card.def_id].append(card)
    return [(groups[did][0], len(groups[did])) for did in order]


def _render_face_up_brief(cards: list[Card]) -> list[str]:
    """Render face-up cards as brief lines grouped by def_id.

    Each line: ``[类型] 名称 ×数量``. The type label replaces the frontend's
    color dot (unavailable in plain text).
    """
    lines: list[str] = []
    for card, count in _group_by_def_id(cards):
        label = _card_type_label(card.type)
        lines.append(f"[{label}] {card.name} ×{count}")
    return lines


def render_text_summary(state: ViewState, local_player_id: str) -> str:
    """Render a multi-line text summary for a private-message reply.

    Layout:
        Line 1: 回合 N | 阶段: <turnPhase> | 你的能量: <energy>
        Line 2: 当前轮到: <current_player_name>
        (blank)
        <玩家列表 segment>            ← always present when players non-empty
        (blank)
        你的手牌:
        1. [类型] 名称 (费用 N)
        (blank)
        <你的门牌 segment>            ← only when local player has face-up cards
        (blank)
        <对手门牌 segment>            ← only when opponents exist
        (blank)
        <飞行中的打击 segment>         ← only when in-flight strikes exist

    If the local player is not found in ``state.players``, energy shows
    "未知" and the hand section shows "（空）" (we cannot know whose hand
    to render). If the local player exists but ``hand`` is empty, the
    hand section also shows "（空）".

    Args:
        state: Typed ViewState cache (non-None).
        local_player_id: QQ-side local player id. Usually matches
            ``state.local_player_id``, but passed explicitly so the
            caller can override it (e.g. for replay or spectator views).

    Returns:
        Multi-line string with no trailing newline.
    """
    # Resolve local player's energy.
    local_player = next(
        (p for p in state.players if p.id == local_player_id), None
    )
    if local_player is not None:
        energy_str = str(local_player.energy)
    else:
        energy_str = "未知"

    # Resolve current player's name.
    current_player = next(
        (p for p in state.players if p.id == state.current_player_id), None
    )
    if current_player is not None:
        current_name = current_player.name
    else:
        current_name = "未知"

    lines: list[str] = []
    lines.append(
        f"回合 {state.total_turn} | 阶段: {state.turn_phase} | 你的能量: {energy_str}"
    )
    lines.append(f"当前轮到: {current_name}")

    # 玩家列表段：展示每个玩家的 1-based 局内序号，供 .strike 等命令使用。
    player_list_segment = render_player_list(state, local_player_id)
    if player_list_segment:
        lines.append("")
        lines.append(player_list_segment)

    lines.append("")
    lines.append("你的手牌:")

    if local_player is None or not local_player.hand:
        lines.append("（空）")
    else:
        for idx, card in enumerate(local_player.hand, start=1):
            label = _card_type_label(card.type)
            subtype_label = (
                _broadcast_subtype_label(card.subtype)
                if card.type == "broadcast"
                else None
            )
            if subtype_label:
                label = f"{label}·{subtype_label}"
            lines.append(f"{idx}. [{label}] {card.name} (费用 {card.energy})")

    # Append local / opponent face-up cards and in-flight strikes sections
    # (when present). Used by both .state and the turn-advance push callback.
    local_face_up_segment = render_local_face_up(state, local_player_id)
    opponents_segment = render_opponents_face_up(state, local_player_id)
    strikes_segment = render_flying_strikes(state)

    if local_face_up_segment:
        lines.append("")
        lines.append(local_face_up_segment)
    if opponents_segment:
        lines.append("")
        lines.append(opponents_segment)
    if strikes_segment:
        if not local_face_up_segment and not opponents_segment:
            lines.append("")
        lines.append(strikes_segment)

    return "\n".join(lines)


def render_logs(state: ViewState, *, limit: int = 10) -> str:
    """Render the last ``limit`` log entries as a multi-line string.

    Each line: ``[回合N] [类型] 消息``. If ``state.logs`` is empty,
    returns ``"（暂无日志）"``.

    Args:
        state: Typed ViewState cache.
        limit: Max number of recent logs to render. Defaults to 10.
            The caller is responsible for clamping to a max (e.g. 50)
            before calling — this function only slices.

    Returns:
        Multi-line string with no trailing newline.
    """
    if not state.logs:
        return "（暂无日志）"

    # Slice the last `limit` entries. Negative-limit edge case: if limit
    # <= 0, treat as "no logs requested" → return empty-pool message.
    if limit <= 0:
        return "（暂无日志）"

    recent = state.logs[-limit:]
    lines: list[str] = []
    for log in recent:
        label = _log_type_label(log.type)
        lines.append(f"[回合{log.turn}] [{label}] {log.message}")

    return "\n".join(lines)


def render_pending_hint(state: ViewState, local_player_id: str) -> str:
    """Render a one-line pending-action or broadcast-response hint.

    Returns a non-empty string when the local player has something to act on:

    - If ``state.pending_action`` is set, returns a hint specific to its
      ``type`` (e.g. ``strikeSelect`` → ".pick <序号> 选择或 .skip 跳过").
      Unknown pending types fall back to ``"待处理操作：<type>"``.
    - Else if ``state.broadcast`` is set and the local player appears in
      ``broadcast.responses`` with ``must_respond=True`` and
      ``responded=False``, returns ``"广播进行中，.agree/.refuse [N] 响应"``.
    - Otherwise returns ``""`` (empty string = no hint, caller should skip
      appending).

    Args:
        state: Typed ViewState cache.
        local_player_id: QQ-side local player id (usually matches
            ``state.local_player_id`` but passed explicitly for override).

    Returns:
        Single-line hint string, or ``""`` if no pending action and no
        broadcast response is required of the local player.
    """
    pa = state.pending_action
    if pa is not None:
        if pa.type == "strikeSelect":
            return (
                f"你有 {len(pa.strike_uids)} 个打击待处理，"
                f".pick <序号> 选择或 .skip 跳过"
            )
        if pa.type == "strikeMove":
            return "打击需移动，.move <序号> <星系> 或 .skip 跳过"
        if pa.type == "announceStrike":
            return (
                f"打击已到达星系 {pa.target_system}，"
                f".announce 宣布或 .skip 跳过"
            )
        if pa.type == "strikeMissedFree":
            return (
                "打击落空，.retarget <序号> <星系> / "
                ".discard <序号> / .skip"
            )
        if pa.type == "strikeMissedRequireTarget":
            return "打击落空必须重定向，.retarget <序号> <星系>"
        return f"待处理操作：{pa.type}"

    broadcast = state.broadcast
    if broadcast is not None:
        for r in broadcast.responses:
            if (
                r.player_id == local_player_id
                and r.must_respond
                and not r.responded
            ):
                return "广播进行中，.agree/.refuse [N] 响应"
    return ""
