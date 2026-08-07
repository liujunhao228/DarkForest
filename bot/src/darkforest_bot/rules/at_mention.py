"""群聊@机器人检测规则。

提供 require_at_in_group() 规则：群聊消息必须包含 @机器人 才会触发命令；
私聊消息直接放行。可通过 GROUP_REQUIRE_AT_MENTION=false 全局关闭（用于
SnowLuma @ 解析异常时回退到旧行为）。

为什么不需要事件预处理器：
OneBot v11 适配器在分发前（nonebot/adapters/onebot/v11/bot.py 的
handle_event → _check_at_me）已经把消息开头/结尾的 @机器人 段从
event.message 里剥掉，并据此设置 event.to_me = True。因此命令解析始终能
看到纯文本开头的消息，@ 检测只需信任适配器算好的 to_me 字段即可，无需在
预处理器里再剥一遍消息（重复剥反而会因 event.message 已被剥而误判"未被@"）。

实现说明：
- 群聊：优先用 event.to_me（适配器语义，覆盖开头/结尾 @ 两种形式）。
- 兜底：_mentions_bot 扫描 event.original_message（构造时保留的原始消息，
  @ 段完整）与纯文本提及 "@<self_id>"，处理 @ 出现在消息中段的情况。
- OneBot v11 的 self_id 是 int，at 段的 qq 可能是 int 或 str，统一转 str。
"""

from __future__ import annotations

from nonebot.adapters import Bot
from nonebot.adapters.onebot.v11 import GroupMessageEvent, MessageEvent
from nonebot.rule import Rule
from nonebot.typing import T_State

from darkforest_bot.config import load_settings


async def _at_mention_check(bot: Bot, event: MessageEvent, state: T_State) -> bool:
    """nonebot2 Rule 依赖检查函数。

    GROUP_REQUIRE_AT_MENTION=false 时全局放行（回退到旧行为）。
    群聊必须被 @ 过（event.to_me）或原始消息里包含 @ 本机器人才放行；
    私聊直接放行。
    """
    if not load_settings().group_require_at_mention:
        return True
    if not isinstance(event, GroupMessageEvent):
        return True
    if event.to_me:
        return True
    # 兜底：适配器仅在开头/结尾识别 to_me，@ 出现在消息中段时按内容判定。
    return _mentions_bot(event)


def _mentions_bot(event: MessageEvent) -> bool:
    """检查消息是否@了机器人（不修改消息）。

    私聊消息直接返回 True（不受@约束）。
    群消息优先扫描 event.original_message（未被适配器剥离的原始消息），
    匹配两种形式：
    1. 标准 at 段：seg.type == "at" 且 data.qq == self_id。
    2. 纯文本提及：text 段含 "@<self_id>"。
    """
    if not isinstance(event, GroupMessageEvent):
        return True
    bot_id = str(event.self_id)
    source = getattr(event, "original_message", event.message)
    for seg in source:
        if seg.type == "at" and str(seg.data.get("qq", "")) == bot_id:
            return True
        if seg.type == "text":
            text = str(seg.data.get("text", ""))
            if f"@{bot_id}" in text:
                return True
    return False


def require_at_in_group() -> Rule:
    """构造规则：群聊需@机器人才响应；私聊放行。

    可被 GROUP_REQUIRE_AT_MENTION=false 关闭。
    """
    return Rule(_at_mention_check)
