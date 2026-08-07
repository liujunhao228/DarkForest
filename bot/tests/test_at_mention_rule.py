"""Tests for rules/at_mention.py — 群聊@机器人检测规则。

覆盖：
- _mentions_bot：私聊放行；群聊 at 段（int/str qq）/ 纯文本提及判定；
  优先扫描未被适配器剥离的 original_message
- _at_mention_check：GROUP_REQUIRE_AT_MENTION=false 全局放行；true 时按
  event.to_me（OneBot v11 适配器 _check_at_me 已算好）判定，@ 在中段时
  用 original_message 兜底；私聊放行
"""

from __future__ import annotations

from nonebot.adapters.onebot.v11 import (
    GroupMessageEvent,
    Message,
    MessageSegment,
    PrivateMessageEvent,
)
from nonebot.adapters.onebot.v11.event import Sender

from darkforest_bot.config import load_settings
from darkforest_bot.rules.at_mention import _at_mention_check, _mentions_bot

SELF_ID = 100000123


def _sender() -> Sender:
    return Sender(user_id=123)


def _private_event() -> PrivateMessageEvent:
    return PrivateMessageEvent(
        time=1,
        self_id=SELF_ID,
        post_type="message",
        sub_type="friend",
        user_id=123,
        message_type="private",
        message_id=1,
        message=Message([MessageSegment.text(".help")]),
        raw_message=".help",
        font=0,
        sender=_sender(),
    )


def _group_event(
    message: Message, *, to_me: bool = False, original_message: Message | None = None
) -> GroupMessageEvent:
    event = GroupMessageEvent(
        time=1,
        self_id=SELF_ID,
        post_type="message",
        sub_type="normal",
        user_id=123,
        message_type="group",
        message_id=1,
        message=message,
        raw_message=".help",
        font=0,
        sender=_sender(),
        group_id=999,
        to_me=to_me,
    )
    if original_message is not None:
        event.original_message = original_message
    return event


def _set_require_at_mention(monkeypatch, value: bool) -> None:
    """设置 GROUP_REQUIRE_AT_MENTION 并让 Settings 以 lru_cache 重载。"""
    monkeypatch.setenv("GROUP_REQUIRE_AT_MENTION", str(value).lower())
    load_settings.cache_clear()


# ---------------------------------------------------------------------------
# _mentions_bot
# ---------------------------------------------------------------------------


def test_is_at_bot_private_always_true() -> None:
    """私聊消息不受@约束，直接返回 True。"""
    assert _mentions_bot(_private_event()) is True


def test_is_at_bot_group_with_matching_at() -> None:
    """群聊含匹配 self_id 的 at 段（str qq）时返回 True。"""
    event = _group_event(
        Message([MessageSegment.text(".help")]),
        original_message=Message([MessageSegment.at(str(SELF_ID)), MessageSegment.text(".help")]),
    )
    assert _mentions_bot(event) is True


def test_is_at_bot_group_at_with_int_qq() -> None:
    """SnowLuma 数组格式下 at 段 qq 为 int 时也应识别（统一转 str 比较）。"""
    event = _group_event(
        Message([MessageSegment.text(".help")]),
        original_message=Message(
            [MessageSegment(type="at", data={"qq": SELF_ID}), MessageSegment.text(".help")]
        ),
    )
    assert _mentions_bot(event) is True


def test_is_at_bot_group_with_nonmatching_at() -> None:
    """群聊 at 的 qq 不匹配 self_id 时返回 False。"""
    event = _group_event(
        Message([MessageSegment.text(".help")]),
        original_message=Message([MessageSegment.at("222"), MessageSegment.text(".help")]),
    )
    assert _mentions_bot(event) is False


def test_is_at_bot_group_text_mention_matching() -> None:
    """SnowLuma 把@转成纯文本 "@<self_id>" 时也应识别。"""
    event = _group_event(
        Message([MessageSegment.text(".help")]),
        original_message=Message([MessageSegment.text(f"@{SELF_ID} .help")]),
    )
    assert _mentions_bot(event) is True


def test_is_at_bot_group_text_mention_nonmatching() -> None:
    """文本中的 "@<其他QQ>" 不应误判为@机器人。"""
    event = _group_event(
        Message([MessageSegment.text(".help")]),
        original_message=Message([MessageSegment.text("@222 .help")]),
    )
    assert _mentions_bot(event) is False


def test_is_at_bot_group_without_at() -> None:
    """群聊无 at 段时返回 False。"""
    event = _group_event(Message([MessageSegment.text(".help")]))
    assert _mentions_bot(event) is False


def test_is_at_bot_group_multiple_at_one_matches() -> None:
    """群聊含多个 at 段，其中一个匹配即返回 True。"""
    event = _group_event(
        Message([MessageSegment.text(".help")]),
        original_message=Message(
            [
                MessageSegment.at("100000000"),
                MessageSegment.at(str(SELF_ID)),
                MessageSegment.text(".help"),
            ]
        ),
    )
    assert _mentions_bot(event) is True


def test_is_at_bot_group_falls_back_to_original_message() -> None:
    """event.message 已被适配器剥离、@ 仅存于 original_message 时仍应识别。

    这是线上真实场景：OneBot v11 适配器 _check_at_me 会 pop 掉开头的 @。
    """
    event = _group_event(
        Message([MessageSegment.text(".help")]),
        original_message=Message([MessageSegment.at(str(SELF_ID)), MessageSegment.text(" .help")]),
    )
    assert _mentions_bot(event) is True


# ---------------------------------------------------------------------------
# _at_mention_check
# ---------------------------------------------------------------------------


async def test_at_mention_check_disabled_always_true(monkeypatch) -> None:
    """group_require_at_mention=False 时群聊不@也放行（回退旧行为）。"""
    _set_require_at_mention(monkeypatch, False)
    event = _group_event(Message([MessageSegment.text(".help")]))
    assert await _at_mention_check(bot=None, event=event, state={}) is True


async def test_at_mention_check_enabled_to_me_true(monkeypatch) -> None:
    """group_require_at_mention=True 时依赖适配器算好的 to_me 放行。"""
    _set_require_at_mention(monkeypatch, True)
    event = _group_event(
        Message([MessageSegment.text(".help")]),
        to_me=True,
        original_message=Message([MessageSegment.at(str(SELF_ID)), MessageSegment.text(".help")]),
    )
    assert await _at_mention_check(bot=None, event=event, state={}) is True


async def test_at_mention_check_enabled_requires_at(monkeypatch) -> None:
    """group_require_at_mention=True 且未被@时拒绝；私聊放行。"""
    _set_require_at_mention(monkeypatch, True)
    group_without_at = _group_event(Message([MessageSegment.text(".help")]))
    group_with_other_at = _group_event(
        Message([MessageSegment.text(".help")]),
        original_message=Message([MessageSegment.at("222"), MessageSegment.text(".help")]),
    )
    private = _private_event()

    assert await _at_mention_check(bot=None, event=group_without_at, state={}) is False
    assert await _at_mention_check(bot=None, event=group_with_other_at, state={}) is False
    assert await _at_mention_check(bot=None, event=private, state={}) is True


async def test_at_mention_check_at_in_body(monkeypatch) -> None:
    """to_me 为 False 时，@ 在消息中段仍应放行（original_message 兜底）。"""
    _set_require_at_mention(monkeypatch, True)
    event = _group_event(
        Message([MessageSegment.text(".play"), MessageSegment.at(str(SELF_ID))]),
        original_message=Message([MessageSegment.text(".play"), MessageSegment.at(str(SELF_ID))]),
    )
    assert await _at_mention_check(bot=None, event=event, state={}) is True
