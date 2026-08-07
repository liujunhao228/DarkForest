""".exit 命令：弃权并离开房间。

流程：先发送 ``forfeit`` action（自己被淘汰，同 .forfeit 的投降语义），随后
发送 ``room:leave`` 离开当前房间，清理游戏会话并将会话状态重置为 IDLE。

判定规则：
- 发送 forfeit 成功后（后端未回 game:error）→ 离开房间。
- 发送 forfeit 失败（后端回 game:error）：若本地玩家已淘汰（ViewState 中
  该玩家 eliminated=True），视为 forfeit 成功 → 仍离开房间（此时回复
  ``你已离开房间``，不对已淘汰玩家说"已弃权"）；否则中止，不离开房间并回复
  失败原因。

无参数。仅在 IN_GAME 状态可用。离开房间后 WS 连接保留（可立即再次 .match）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import Bot, Message, MessageEvent
from nonebot.params import CommandArg

from darkforest_bot.backend.protocol import ClientEvent
from darkforest_bot.commands.forfeit import send_forfeit_action
from darkforest_bot.rules.at_mention import require_at_in_group
from darkforest_bot.session.states import SessionState
from darkforest_bot.state import (
    get_game_session_store,
    get_pool,
    get_session_manager,
    get_settings,
)

if TYPE_CHECKING:
    from darkforest_bot.backend.game_session import GameSessionStore
    from darkforest_bot.backend.pool import WSConnectionPool
    from darkforest_bot.config import Settings
    from darkforest_bot.session.manager import SessionManager

# nonebot2 command registration.
# 群聊需@机器人才响应（require_at_in_group 规则）；私聊放行。
# 可通过 GROUP_REQUIRE_AT_MENTION=false 全局关闭回退到旧行为。
exit_cmd = on_command("exit", rule=require_at_in_group(), priority=10, block=True)


@exit_cmd.handle()
async def _handle_exit_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: ARG001, B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — delegates to core logic."""
    await handle_exit_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        session_manager=get_session_manager(),
        game_session_store=get_game_session_store(),
        pool=get_pool(),
        settings=get_settings(),
    )


async def handle_exit_request(
    bot: Any,
    user_id: int,
    session_manager: SessionManager,
    game_session_store: GameSessionStore,
    pool: WSConnectionPool,
    settings: Settings,
) -> None:
    """.exit — 弃权并离开房间。"""
    qq = user_id

    # 1. 状态检查 — 仅 IN_GAME 可弃权离开。
    async with session_manager.acquire(qq):
        session = session_manager.get_or_create(qq)
        if session.state != SessionState.IN_GAME:
            await _reply_private(bot, qq, "当前不在对局中")
            return
        room_id = session.room_id
        if room_id is None:
            # IN_GAME 理应已在房间中；防御性兜底。
            await _reply_private(bot, qq, "当前不在房间中")
            return

    # 2. WS 连接检查。
    ws = pool.get(qq)
    if ws is None:
        await _reply_private(bot, qq, "连接不可用")
        return

    # 3. 发送 forfeit action。
    result = await send_forfeit_action(ws, settings)
    if result is not None and not _is_local_eliminated(game_session_store, qq):
        # 弃权失败且本地玩家尚未淘汰 → 中止，不离开房间。
        await _reply_private(bot, qq, f"操作失败：{result.message}")
        return

    # 4. 成功（或已淘汰视为成功）→ 离开房间。
    was_eliminated = _is_local_eliminated(game_session_store, qq)
    try:
        await ws.send(ClientEvent.ROOM_LEAVE, room_id=room_id)
    except Exception:
        logger.exception("exit: room:leave send failed", qq=qq)
        await _reply_private(bot, qq, "离开房间失败，请稍后重试")
        return

    # 5. 清理游戏会话（退订游戏事件 + 清缓存）。
    try:
        await game_session_store.stop(qq)
    except Exception:
        logger.exception("exit: game session stop failed", qq=qq)

    # 6. 会话重置为 IDLE、清空 room_id，保留 WS 连接。
    async with session_manager.acquire(qq):
        session = session_manager.get_or_create(qq)
        if session.state == SessionState.IN_GAME:
            session_manager.transition(qq, SessionState.IDLE)
        session.room_id = None

    if was_eliminated:
        await _reply_private(bot, qq, "你已离开房间")
    else:
        await _reply_private(bot, qq, "已弃权并离开房间")


def _is_local_eliminated(game_session_store: GameSessionStore, qq: int) -> bool:
    """判断本地玩家是否已在缓存 ViewState 中被标记为淘汰。

    仅用于 .exit 判定"弃权失败但已淘汰"。无缓存或未找到本地玩家时返回 False。
    """
    game_session = game_session_store.get(qq)
    if game_session is None or game_session.view_state is None:
        return False
    vs = game_session.view_state
    for p in vs.players:
        if p.id == vs.local_player_id:
            return p.eliminated
    return False


async def _reply_private(bot: Any, user_id: int, message: Any) -> None:
    """Send a private message. Failures are logged but not raised."""
    try:
        await bot.call_api("send_private_msg", user_id=user_id, message=message)
    except Exception:  # noqa: BLE001 - best-effort reply
        logger.warning("Failed to send private message", user_id=user_id)
