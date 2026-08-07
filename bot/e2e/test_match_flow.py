"""E2E：.match 全链路 → 出牌校验 → .forfeit 结算推送。

走真实 Go 后端（LOCAL_TRUST_MODE）+ 真实 nonebot bot + FakeOneBot（替代 bot 传输），
断言 bot 经真实 OneBot 路径发出的群聊/私聊帧（含真实 base64 星图 PNG）。

每用例各自独立起 backend+bot 栈（共享_stack.isolated_stack），消除共享后端上
`.exit` 清理受限导致的跨用例房间残留污染。
"""

from __future__ import annotations

import pytest

from . import _helpers as h
from ._stack import isolated_stack
from .fake_onebot import FakeOneBot

_SETTLE_BACKEND_PORT = 18102
_SETTLE_BOT_PORT = 18103
_FLOW_BACKEND_PORT = 18100
_FLOW_BOT_PORT = 18101


@pytest.fixture
def isolated_match() -> FakeOneBot:
    """独立栈 FakeOneBot，供测试各自落局。"""
    with isolated_stack(_FLOW_BACKEND_PORT, _FLOW_BOT_PORT, "match-flow") as client:
        yield client


def test_match_full_flow_to_settlement(isolated_match: FakeOneBot) -> None:
    """匹配 → 开局 → 弃权 → 结算群聊推送（图片 + 结算文字）。"""
    with isolated_stack(_SETTLE_BACKEND_PORT, _SETTLE_BOT_PORT, "match-settle") as client:
        try:
            h.start_match(client)

            # 玩家 B 弃权 → 对局结束 → 群聊结算消息（真实渲染 PNG + 胜者为 A）。
            client.send_private_message(h.USER_B, ".forfeit", timeout=5.0)
            settlement = client.wait_for(
                "send_group_msg", contains="胜者", has_image=True, timeout=h.MATCH_TIMEOUT
            )
            assert "回放" in client.to_text(settlement)
            assert client.extract_image_b64(settlement) is not None
        finally:
            h.end_match(client)


def test_match_reply_text(isolated_match: FakeOneBot) -> None:
    """匹配过程各阶段回复文案与阶段（群聊公告 / 私聊开始/对局）。"""
    client = isolated_match
    try:
        client.send_group_message(h.GROUP_ID, h.USER_A, ".match 2 classic", timeout=5.0)
        grp = client.wait_for("send_group_msg", contains="匹配中", timeout=h.MATCH_TIMEOUT)
        assert grp["params"]["group_id"] == h.GROUP_ID

        client.send_group_message(h.GROUP_ID, h.USER_B, ".match 2 classic", timeout=5.0)
        client.wait_for("send_group_msg", contains="匹配成功", timeout=h.MATCH_TIMEOUT)
        priv = client.wait_for(
            "send_private_msg", contains="对局开始，房间", timeout=h.MATCH_TIMEOUT
        )
        assert "房间" in client.to_text(priv)

        client.wait_for("send_private_msg", contains="对局已开始", timeout=h.MATCH_TIMEOUT)
        client.wait_for("send_private_msg", contains="对局已开始", timeout=h.MATCH_TIMEOUT)
    finally:
        h.end_match(client)
