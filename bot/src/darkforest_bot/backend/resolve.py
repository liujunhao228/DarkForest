"""Command parameter resolvers for P4 game action commands.

Pure functions that translate user-facing command arguments (1-based indices,
player names) into backend identifiers (card UIDs, strike UIDs, player IDs).

All functions are pure (no I/O, no side effects) and raise :class:`ResolveError`
on invalid input. They never return ``None`` — callers can rely on the returned
value being valid.

``Any`` does not appear in this module's public signatures.
"""

from __future__ import annotations

from darkforest_bot.backend.view_state import (
    Card,
    FlyingStrikeView,
    PlayerView,
    ViewState,
)


class ResolveError(ValueError):
    """Raised when a command argument cannot be resolved to a backend identifier.

    Carries a user-friendly message suitable for direct private-message reply.
    """


def resolve_hand_card(view_state: ViewState, index_1based: int) -> Card:
    """Resolve a 1-based hand index to the local player's Card.

    Args:
        view_state: Current ViewState cache (must contain local player's hand).
        index_1based: 1-based index into the local player's hand (1 = first card).

    Returns:
        The Card at the requested position.

    Raises:
        ResolveError: If local player not found, or index is out of range.
    """
    local_player: PlayerView | None = None
    for p in view_state.players:
        if p.id == view_state.local_player_id:
            local_player = p
            break
    if local_player is None:
        raise ResolveError("未找到本地玩家")
    hand = local_player.hand
    if index_1based < 1 or index_1based > len(hand):
        raise ResolveError(
            f"手牌序号 {index_1based} 越界，当前手牌 {len(hand)} 张"
        )
    return hand[index_1based - 1]


def resolve_faceup_card(view_state: ViewState, index_1based: int) -> Card:
    """Resolve a 1-based face-up card index to the local player's Card.

    Mirrors :func:`resolve_hand_card` but targets the local player's
    ``face_up_cards`` field. Used by ``.recycle`` (回收场上已部署的牌).

    Args:
        view_state: Current ViewState cache (must contain local player's face-up cards).
        index_1based: 1-based index into the local player's face-up cards (1 = first card).

    Returns:
        The Card at the requested position.

    Raises:
        ResolveError: If local player not found, or index is out of range.
    """
    local_player: PlayerView | None = None
    for p in view_state.players:
        if p.id == view_state.local_player_id:
            local_player = p
            break
    if local_player is None:
        raise ResolveError("未找到本地玩家")
    face_up = local_player.face_up_cards
    if index_1based < 1 or index_1based > len(face_up):
        raise ResolveError(
            f"场上牌序号 {index_1based} 越界，当前场上牌 {len(face_up)} 张"
        )
    return face_up[index_1based - 1]


def assert_card_type(
    card: Card,
    allowed_types: tuple[str, ...],
    action_label: str,
) -> None:
    """Assert that a card's type is in ``allowed_types``.

    Args:
        card: The card to check.
        allowed_types: Tuple of allowed card type strings (e.g. ``("facility", "defense")``).
        action_label: Human-readable action name for the error message (e.g. ``".deploy"``).

    Raises:
        ResolveError: If ``card.type`` is not in ``allowed_types``. The message
            is user-friendly and suitable for direct private-message reply.
    """
    if card.type not in allowed_types:
        raise ResolveError(
            f"【{card.name}】是 {card.type} 卡，不能用于 {action_label}"
        )


def resolve_strike(view_state: ViewState, index_1based: int) -> FlyingStrikeView:
    """Resolve a 1-based strike index to one of the local player's flying strikes.

    Only strikes owned by the local player are considered (filtered from
    ``view_state.flying_strikes`` preserving original order).

    Args:
        view_state: Current ViewState cache.
        index_1based: 1-based index into the local player's flying strikes.

    Returns:
        The FlyingStrikeView at the requested position.

    Raises:
        ResolveError: If index is out of range.
    """
    owned = [
        s
        for s in view_state.flying_strikes
        if s.owner_id == view_state.local_player_id
    ]
    if index_1based < 1 or index_1based > len(owned):
        raise ResolveError(
            f"打击序号 {index_1based} 越界，当前你的打击 {len(owned)} 个"
        )
    return owned[index_1based - 1]


def resolve_player_by_name(view_state: ViewState, name: str) -> PlayerView:
    """Resolve a player name (or unique prefix) to a PlayerView.

    Matching strategy:
        1. Exact case-sensitive match on ``player.name``.
        2. If no exact match, case-insensitive prefix match on
           ``player.name.lower().startswith(name.lower())``.
        3. Ambiguous prefix matches raise ResolveError listing candidates.

    Args:
        view_state: Current ViewState cache.
        name: Player name or unique prefix supplied by the user.

    Returns:
        The matched PlayerView.

    Raises:
        ResolveError: If no player matches, or if the prefix is ambiguous.
    """
    # 1. Exact match (case-sensitive)
    for p in view_state.players:
        if p.name == name:
            return p
    # 2. Case-insensitive prefix match
    lowered = name.lower()
    candidates = [
        p for p in view_state.players if p.name.lower().startswith(lowered)
    ]
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise ResolveError(f"未找到玩家 '{name}'")
    names_sorted = sorted(p.name for p in candidates)
    raise ResolveError(f"玩家名 '{name}' 歧义，匹配到：{', '.join(names_sorted)}")


def resolve_player_by_index(
    view_state: ViewState, index_1based: int
) -> PlayerView:
    """Resolve a 1-based player index to a PlayerView.

    The index is the 1-based position in ``view_state.players``，即玩家在本局
    内的序号（正整数）。用于 ``.strike`` 等需要指定目标玩家的命令（如科技锁死
    需锁定具体玩家），替代旧的玩家名匹配。

    Args:
        view_state: Current ViewState cache.
        index_1based: 1-based index into ``view_state.players`` (1 = first player).

    Returns:
        The matched PlayerView.

    Raises:
        ResolveError: If index is out of range.
    """
    if index_1based < 1 or index_1based > len(view_state.players):
        raise ResolveError(
            f"玩家序号 {index_1based} 越界，当前玩家 {len(view_state.players)} 名"
        )
    return view_state.players[index_1based - 1]


def resolve_responder(view_state: ViewState, name: str) -> str:
    """Resolve a broadcast responder name (or unique prefix) to a player ID.

    Args:
        view_state: Current ViewState cache. ``view_state.broadcast`` must be
            non-None (a broadcast must be in progress).
        name: Responder name or unique prefix supplied by the user.

    Returns:
        The matched responder's player_id.

    Raises:
        ResolveError: If no broadcast is in progress, no responder matches,
            or the prefix is ambiguous.
    """
    if view_state.broadcast is None:
        raise ResolveError("当前无广播进行中")
    responses = view_state.broadcast.responses
    # 1. Exact match on player_name (case-sensitive)
    for r in responses:
        if r.player_name == name:
            return r.player_id
    # 2. Case-insensitive prefix match
    lowered = name.lower()
    candidates = [
        r for r in responses if r.player_name.lower().startswith(lowered)
    ]
    if len(candidates) == 1:
        return candidates[0].player_id
    if not candidates:
        raise ResolveError(f"未找到响应者 '{name}'")
    names_sorted = sorted(r.player_name for r in candidates)
    raise ResolveError(f"响应者名 '{name}' 歧义，匹配到：{', '.join(names_sorted)}")
