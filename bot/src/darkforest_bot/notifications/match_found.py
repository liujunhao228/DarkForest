"""match:found notification logic.

Key constraint: the backend's match:found payload contains MatchPlayerInfo
(playerId, displayName, isHost, playerNumber, position) but NOT userId/qq.
The bot therefore cannot CQ:at other players in the group. Instead:
- Group message: text only, listing all player display names + room code.
- Private message: sent only to the current QQ (the one whose WS received
  the match:found event).

Since the bot is a single process with one WS per QQ, each QQ's WS receives
its own match:found. To avoid spamming the group with N identical messages,
group notifications are deduplicated by room_code: only the first WS to
receive match:found for a given room triggers the group message; subsequent
WS instances for the same room only send their own private message.

This module is stateful (the _announced_rooms set). Call reset_announced()
between tests to clear state.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from loguru import logger

from darkforest_bot.backend.protocol import MatchPlayerInfo

if TYPE_CHECKING:
    from nonebot.adapters.onebot.v11 import Bot

# Module-level state for group message deduplication by room_code.
_announced_rooms: set[str] = set()
_announce_lock: asyncio.Lock = asyncio.Lock()


async def notify_match_found(
    bot: Bot,
    group_id: int,
    current_qq: int,
    players: list[MatchPlayerInfo],
    room_code: str,
) -> None:
    """Send match:found notifications.

    - Group message (deduplicated by room_code): text listing all player
      names and the room code. Only sent once per room.
    - Private message: sent to current_qq only, with the room code.

    Failures in either channel are logged as warnings and do not block the
    other channel. The caller (match command handler) is responsible for
    state transitions; this function only sends messages.
    """
    # --- Group message (deduplicated) ---
    async with _announce_lock:
        should_announce_group = room_code not in _announced_rooms
        if should_announce_group:
            _announced_rooms.add(room_code)

    if should_announce_group:
        names = "、".join(p.display_name for p in players)
        group_msg = f"匹配成功！房间 {room_code}，玩家：{names}。请查看私信开始对局"
        try:
            await bot.call_api(
                "send_group_msg",
                group_id=group_id,
                message=group_msg,
            )
        except Exception:
            logger.warning(
                "Group message failed",
                group_id=group_id,
                room_code=room_code,
            )

    # --- Private message (always sent to current QQ) ---
    private_msg = f"对局开始，房间 {room_code}。bot 将自动准备，对局即将开始..."
    try:
        await bot.call_api(
            "send_private_msg",
            user_id=current_qq,
            message=private_msg,
        )
    except Exception:
        logger.warning(
            "Private message failed",
            user_id=current_qq,
            room_code=room_code,
        )


def reset_announced() -> None:
    """Clear the announced-rooms set. Used by tests to reset state."""
    _announced_rooms.clear()
