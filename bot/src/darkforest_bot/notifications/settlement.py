"""对局结算群聊推送模块。

对局结束后，往发起匹配的群聊推送一条结算消息：终局星图图片 + 结算文字
（胜者 / 每人统计 / 总回合 / 回放 ID）。数据源为终局全知视角 ViewState。

对应后端设计：
    docs/designs/2026-08-07-bot-settlement-push-design.md
    docs/plans/2026-08-07-bot-settlement-push-workflow.md

设计约束：
- 推送失败仅 ``log.warning`` 记录，绝不抛异常，避免影响会话状态机。
- 群聊图片消息用 ``render_starmap`` 渲染的 PNG 经 base64 打包为
  OneBot ``ImageSegment``，后接 ``TextSegment``。
"""

from __future__ import annotations

import base64
from typing import TYPE_CHECKING

from loguru import logger
from nonebot.adapters.onebot.v11 import Message, MessageSegment

from darkforest_bot.backend.view_state import ViewState
from darkforest_bot.render.starmap import render_starmap

if TYPE_CHECKING:
    from nonebot.adapters.onebot.v11 import Bot


def _lookup_player_name(vs: ViewState, player_id: str | None) -> str:
    """按玩家 ID 查询显示名；未找到返回空串。"""
    if player_id is None:
        return ""
    return next((p.name for p in vs.players if p.id == player_id), "")


def _lookup_winner_name(vs: ViewState) -> str:
    """返回胜者姓名；VS.winner 为 None 或查不到时返回空串。"""
    return _lookup_player_name(vs, vs.winner)


def render_settlement_message(vs: ViewState) -> str:
    """拼装结算文字（不含图片）。

    格式：
        头部：🏆 胜者: {winner_name} | 📋 回放: {replay_id} | 回合: {total_turn}
        每人一行：{name} ⚡{energy} 💥{strike_count} 📡{broadcast_success_count}
                  🔥{destroyed_star_count}
    按 ``vs.players`` 顺序列出全量玩家（含已淘汰者）。
    """
    winner_name = _lookup_winner_name(vs)
    replay_id = vs.replay_id or ""
    header = f"🏆 胜者: {winner_name} | 📋 回放: {replay_id} | 回合: {vs.total_turn}"

    lines = [header]
    for p in vs.players:
        line = (
            f"{p.name} ⚡{p.energy} 💥{p.strike_count} "
            f"📡{p.broadcast_success_count} 🔥{p.destroyed_star_count}"
        )
        lines.append(line)

    return "\n".join(lines)


async def push_settlement(bot: Bot, group_id: int, vs: ViewState) -> None:
    """往群聊推送一条结算消息（星图图片 + 结算文字）。

    推送失败仅告警，不抛异常。
    """
    try:
        png = render_starmap(vs)
        b64 = base64.b64encode(png).decode("ascii")
        text = render_settlement_message(vs)
        msg = Message(
            [
                MessageSegment.image(f"base64://{b64}"),
                MessageSegment.text("\n" + text),
            ]
        )
        await bot.call_api("send_group_msg", group_id=group_id, message=msg)
    except Exception:  # noqa: BLE001 — 推送失败仅告警
        logger.warning(
            "群聊结算消息推送失败",
            group_id=group_id,
            replay_id=vs.replay_id,
        )


__all__ = [
    "push_settlement",
    "render_settlement_message",
]