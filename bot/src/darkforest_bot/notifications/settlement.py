"""对局结算群聊推送模块。

对局结束后，往发起匹配的群聊推送一条结算消息：排行榜图片 + 短 caption 文字
（胜者 / 回放 ID / 回合数）。数据源为终局全知视角 ViewState。

对应后端设计：
    docs/designs/2026-08-07-bot-settlement-push-design.md
    docs/designs/2026-08-10-settlement-leaderboard-design.md
    docs/plans/2026-08-10-settlement-leaderboard-workflow.md

设计约束：
- 推送失败仅 ``log.warning`` 记录，绝不抛异常，避免影响会话状态机。
- 群聊图片消息用 ``render_leaderboard`` 渲染的 PNG 经 base64 打包为
  OneBot ``ImageSegment``，后接 ``TextSegment``（短 caption）。
- 排行榜渲染器（``render.leaderboard``）复用私聊回合推送的星图渲染器
  调色板与字体加载；不再渲染终局星图。
"""

from __future__ import annotations

import base64
from typing import TYPE_CHECKING

from loguru import logger
from nonebot.adapters.onebot.v11 import Message, MessageSegment

from darkforest_bot.backend.view_state import ViewState
from darkforest_bot.render.leaderboard import render_leaderboard

if TYPE_CHECKING:
    from nonebot.adapters.onebot.v11 import Bot

_DEFAULT_FONT_PATH = "C:\\Windows\\Fonts\\msyh.ttc"


def _lookup_player_name(vs: ViewState, player_id: str | None) -> str:
    """按玩家 ID 查询显示名；未找到返回空串。"""
    if player_id is None:
        return ""
    return next((p.name for p in vs.players if p.id == player_id), "")


def _lookup_winner_name(vs: ViewState) -> str:
    """返回胜者姓名；VS.winner 为 None 或查不到时返回空串。"""
    return _lookup_player_name(vs, vs.winner)


def render_settlement_message(vs: ViewState) -> str:
    """拼装结算短 caption 文字（不含图片）。

    格式：
        🏆 胜者: {winner_name} | 📋 回放: {replay_id} | 回合: {total_turn}
    详细统计（每人能量/毁星/打击/广播/位置）由排行榜图片承载。
    """
    winner_name = _lookup_winner_name(vs)
    replay_id = vs.replay_id or ""
    return f"🏆 胜者: {winner_name} | 📋 回放: {replay_id} | 回合: {vs.total_turn}"


async def push_settlement(
    bot: Bot,
    group_id: int,
    vs: ViewState,
    *,
    font_path: str = _DEFAULT_FONT_PATH,
) -> None:
    """往群聊推送一条结算消息（排行榜图片 + 短 caption 文字）。

    推送失败仅告警，不抛异常。
    """
    try:
        png = render_leaderboard(vs, font_path=font_path)
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
