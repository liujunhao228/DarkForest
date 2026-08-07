"""E2E：重连韧性——后端重启后 bot 自动重连并重置会话。

独立起一套 backend+bot（不与会话级 fixtures 共享），以验证连接重建路径：
断开 → 重连成功 → on_reconnect 清会话 + 私信"连接断开，请重新 .match"。
"""

from __future__ import annotations

from . import _helpers as h
from .backend_runner import (
    base_ws_url,
    start_backend,
    stop_backend,
    wait_backend_ready,
)
from .bot_runner import start_bot, stop_bot, wait_bot_port
from .conftest import BOT_ID, _spawn_tee
from .fake_onebot import FakeOneBot

_BACKEND_PORT = 18084
_BOT_PORT = 18085


def test_backend_restart_resets_session() -> None:
    backend = None
    bot = None
    client: FakeOneBot | None = None
    try:
        backend = start_backend(port=_BACKEND_PORT)
        _spawn_tee(backend, "backend-reconnect")
        wait_backend_ready(_BACKEND_PORT)

        bot = start_bot(base_ws_url(_BACKEND_PORT), port=_BOT_PORT)
        _spawn_tee(bot, "bot-reconnect")
        wait_bot_port(_BOT_PORT)

        client = FakeOneBot("127.0.0.1", _BOT_PORT, bot_id=BOT_ID)
        client.connect(timeout=30.0)

        # 让玩家 A 建立到后端的 WS（.match 触发连后端并进入 MATCHMAKING）。
        client.send_group_message(h.GROUP_ID, h.USER_A, ".match 2 classic", timeout=5.0)
        client.wait_for("send_group_msg", contains="匹配中", timeout=h.MATCH_TIMEOUT)

        # 杀掉后端 → bot 的 WSClient 进入重连循环。
        stop_backend(backend)
        backend = None

        # 重启后端 → bot 重连成功 → on_reconnect 私信提示重来。
        backend = start_backend(port=_BACKEND_PORT)
        _spawn_tee(backend, "backend-reconnect-2")
        wait_backend_ready(_BACKEND_PORT)

        client.wait_for(
            "send_private_msg", contains="连接断开，请重新 .match", timeout=60.0
        )
    finally:
        if client is not None:
            client.close()
        if bot is not None:
            stop_bot(bot)
        if backend is not None:
            stop_backend(backend)
