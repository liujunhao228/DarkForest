"""E2E 共享流程助手：起一局 2 人对局 / 清理会话。"""

from __future__ import annotations

import time

from .fake_onebot import FakeOneBot

GROUP_ID = 20001
USER_A = 10001
USER_B = 10002
MATCH_TIMEOUT = 30.0


def start_match(client: FakeOneBot, group_id: int = GROUP_ID) -> None:
    """两个用户在大厅发 .match 2 classic，等待对局真正开始（收到"对局已开始"）。"""
    client.send_group_message(group_id, USER_A, ".match 2 classic")
    client.wait_for("send_group_msg", contains="匹配中", timeout=MATCH_TIMEOUT)
    client.send_group_message(group_id, USER_B, ".match 2 classic", timeout=5.0)
    client.wait_for("send_group_msg", contains="匹配中", timeout=MATCH_TIMEOUT)

    # 匹配成功：群聊公告（去重仅一次）+ 双方私信
    client.wait_for("send_group_msg", contains="匹配成功", timeout=MATCH_TIMEOUT)
    client.wait_for("send_private_msg", contains="对局开始，房间", timeout=MATCH_TIMEOUT)
    client.wait_for("send_private_msg", contains="对局开始，房间", timeout=MATCH_TIMEOUT)

    # 自动准备 → 开局 → 对局已开始
    client.wait_for("send_private_msg", contains="对局已开始", timeout=MATCH_TIMEOUT)
    client.wait_for("send_private_msg", contains="对局已开始", timeout=MATCH_TIMEOUT)


def end_match(client: FakeOneBot) -> None:
    """用 .exit 让两个玩家弃权离房，会话回到 IDLE（对后续用例幂等）。

    只发送 + 略作休眠，不主动消费回执（残留帧由后续 contains-based 断言天然容忍）。
    """
    client.send_private_message(USER_A, ".exit", timeout=5.0)
    client.send_private_message(USER_B, ".exit", timeout=5.0)
    time.sleep(0.5)
