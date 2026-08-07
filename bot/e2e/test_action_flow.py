"""E2E：对局内动作校验——无效出牌报错 / .state 渲染星图。

独立 backend+bot 栈（共享_stack.isolated_stack）逐用例起，避免共享后端上
`.exit` 清理受限导致的房间残留跨用例污染。
"""

from __future__ import annotations

import pytest

from . import _helpers as h
from ._stack import isolated_stack
from .fake_onebot import FakeOneBot


@pytest.fixture
def action_client() -> FakeOneBot:
    with isolated_stack(18110, 18111, "action") as client:
        yield client


def test_backend_reject_reports_error(action_client: FakeOneBot) -> None:
    """后端 game:error → 私信"操作失败：<msg>"。

    手牌随机，扫一手牌：用 1..N 手牌序号发起 .strike，目标星系取极大值
    （必然超界 → 后端校验失败），直到出现含"操作失败"的私信即证明错误管线打通。
    """
    client = action_client
    try:
        h.start_match(client)

        for n in range(1, 10):
            client.send_private_message(h.USER_A, f".strike {n} 999999999", timeout=2.0)
            try:
                frame = client.wait_for("send_private_msg", timeout=2.0)
            except TimeoutError:
                continue
            text = client.to_text(frame)
            if "操作失败" in text:
                assert len(text) > 0
                return
        pytest.fail("多个手牌序号均未触发后端 game:error（操作失败）")
    finally:
        h.end_match(client)


def test_state_renders_starmap_image(action_client: FakeOneBot) -> None:
    """.state → 私信含 base64 星图 PNG（真实 render_starmap 产物）。"""
    client = action_client
    try:
        h.start_match(client)

        client.send_private_message(h.USER_A, ".state", timeout=5.0)
        frame = client.wait_for("send_private_msg", has_image=True, timeout=h.MATCH_TIMEOUT)
        assert client.extract_image_b64(frame) is not None
    finally:
        h.end_match(client)
