""".notify command handler.

Usage in group/private message:
- ``.notify`` — 显示当前推送设置。
- ``.notify <broadcast|strike|other> <on|off>`` — 开关某个可关闭类别。
- ``.notify all <on|off>`` — 同时开关 broadcast / strike / other。
- ``.notify reset`` — 恢复默认设置。

不可关闭类别（turn_change / game_over / pending_action）不在此命令内暴露。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import (
    Bot,
    GroupMessageEvent,
    Message,
    MessageEvent,
    PrivateMessageEvent,
)
from nonebot.params import CommandArg

from darkforest_bot.notifications.notify_config import NotifyConfig
from darkforest_bot.state import get_notify_config_store

if TYPE_CHECKING:
    from darkforest_bot.notifications.notify_config import NotifyConfigStore

# 可开关类别枚举。
TOGGLEABLE = frozenset({"broadcast", "strike", "other"})

# nonebot2 command registration.
notify_cmd = on_command("notify", priority=10, block=True)


@notify_cmd.handle()
async def _handle_notify_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — extracts event data and delegates to core logic."""
    user_id = int(event.get_user_id())
    raw_args = args.extract_plain_text().strip()
    result = await handle_notify_request(
        user_id=user_id,
        raw_args=raw_args,
        store=get_notify_config_store(),
    )
    await _reply(bot, event, result)


async def handle_notify_request(
    user_id: int,
    raw_args: str,
    store: NotifyConfigStore,
) -> str:
    """核心逻辑：解析 .notify 参数并返回回复文本。

    Args:
        user_id: QQ 号。
        raw_args: 命令后的原始文本（已 strip）。
        store: NotifyConfigStore 用于读写配置（get/set/reset 为 async）。
    """
    tokens = raw_args.split() if raw_args else []

    # 无参数：显示当前配置。
    if not tokens:
        cfg = store.get(user_id)
        return (
            f"当前推送设置：\n"
            f"  broadcast: {'on' if cfg.broadcast else 'off'}\n"
            f"  strike: {'on' if cfg.strike else 'off'}\n"
            f"  other: {'on' if cfg.other else 'off'}\n"
            f"（turn_change / game_over / pending_action 不可关闭）\n"
            f"用法：.notify <broadcast|strike|other|all> <on|off> | .notify reset"
        )

    # reset：恢复默认。
    if tokens[0] == "reset" and len(tokens) == 1:
        await store.reset(user_id)
        return "已重置为默认设置"

    # <cat> <on|off>。
    if (
        len(tokens) == 2
        and tokens[0] in TOGGLEABLE
        and tokens[1] in {"on", "off"}
    ):
        cat = tokens[0]
        val = tokens[1] == "on"
        cfg = store.get(user_id)
        new_cfg = NotifyConfig(
            broadcast=val if cat == "broadcast" else cfg.broadcast,
            strike=val if cat == "strike" else cfg.strike,
            other=val if cat == "other" else cfg.other,
        )
        await store.set(user_id, new_cfg)
        return f"已设置 {cat} = {tokens[1]}"

    # all on|off。
    if len(tokens) == 2 and tokens[0] == "all" and tokens[1] in {"on", "off"}:
        val = tokens[1] == "on"
        new_cfg = NotifyConfig(broadcast=val, strike=val, other=val)
        await store.set(user_id, new_cfg)
        return f"已设置 all = {tokens[1]}"

    return "参数无效，用法 .notify [<broadcast|strike|other|all> <on|off>|reset]"


async def _reply(bot: Bot, event: MessageEvent, text: str) -> None:
    """按事件类型发送回复（群聊 → send_group_msg；私聊 → send_private_msg）。"""
    try:
        if isinstance(event, GroupMessageEvent):
            await bot.call_api("send_group_msg", group_id=event.group_id, message=text)
        elif isinstance(event, PrivateMessageEvent):
            await bot.call_api("send_private_msg", user_id=event.user_id, message=text)
        else:
            logger.warning("notify: unknown event type, cannot reply", type=type(event).__name__)
    except Exception:
        logger.warning("Failed to send notify reply", text=text)
