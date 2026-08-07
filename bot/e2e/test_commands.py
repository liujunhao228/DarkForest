"""E2E：无状态/会话命令（.help / .cancel / .notify）与 @ 检测。

默认 bot 以 GROUP_REQUIRE_AT_MENTION=false 运行（conftest），.help/.notify 无需对局。
@ 检测用独立 bot 实例（GROUP_REQUIRE_AT_MENTION=true + 独立端口）单独验证。
"""

from __future__ import annotations

import time

from . import _helpers as h
from .bot_runner import start_bot, stop_bot, wait_bot_port
from .conftest import BOT_ID, BOT_PORT, _spawn_tee
from .fake_onebot import FakeOneBot


def test_help_lists_commands(fake_onebot: FakeOneBot) -> None:
    """.help 群聊列出命令（无需对局）。"""
    fake_onebot.send_group_message(h.GROUP_ID, h.USER_A, ".help", timeout=5.0)
    frame = fake_onebot.wait_for("send_group_msg", contains=".match", timeout=15.0)
    assert ".cancel" in fake_onebot.to_text(frame)


def test_notify_toggle_receipt(fake_onebot: FakeOneBot) -> None:
    """.notify 私聊返回推送设置回执。"""
    fake_onebot.send_private_message(h.USER_A, ".notify", timeout=5.0)
    fake_onebot.wait_for("send_private_msg", contains="推送", timeout=15.0)


def test_cancel_after_match(fake_onebot: FakeOneBot) -> None:
    """匹配中 .cancel → 取消排队并回执。"""
    fake_onebot.send_group_message(h.GROUP_ID, h.USER_A, ".match 2 classic", timeout=5.0)
    fake_onebot.wait_for("send_group_msg", contains="匹配中", timeout=h.MATCH_TIMEOUT)
    fake_onebot.send_private_message(h.USER_A, ".cancel", timeout=5.0)
    fake_onebot.wait_for("send_private_msg", timeout=15.0)


def test_group_requires_at_mention_when_enabled(backend_ws: str) -> None:
    """GROUP_REQUIRE_AT_MENTION=true 时：不带 @ 不响应，带 @ 才响应。"""
    port = BOT_PORT + 1
    proc = start_bot(backend_ws, port=port, group_require_at_mention=True)
    _spawn_tee(proc, "bot-at-mention")
    client: FakeOneBot | None = None
    try:
        wait_bot_port(port)
        client = FakeOneBot("127.0.0.1", port, bot_id=BOT_ID)
        client.connect(timeout=30.0)

        # 不带 @ → bot 不应响应（等 3s 无该动作帧）。
        client.send_group_message(h.GROUP_ID, h.USER_A, ".help", timeout=5.0)
        assert not _has_group_help(client, timeout=3.0)

        # 带 @ → 响应。
        client.send_group_message(h.GROUP_ID, h.USER_A, ".help", at_bot=True, timeout=5.0)
        client.wait_for("send_group_msg", contains=".match", timeout=15.0)
    finally:
        if client is not None:
            client.close()
        stop_bot(proc)


def _has_group_help(client: FakeOneBot, timeout: float) -> bool:
    """短暂观察：是否存在 send_group_msg 含 .match 的帧。"""
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        for frame in list(client.sent):
            if frame["action"] == "send_group_msg" and ".match" in FakeOneBot.to_text(frame):
                return True
        time.sleep(0.2)
    return False
