"""隔离栈助手：为需要落局/结算的用例起独立 backend+bot+FakeOneBot。

动机：共享会话级后端上，`.exit` 清理不可靠（先 exit 一方会结束对局，另一方
`.exit` 因对局已结束而不会离房），残留房间会级联卡死后续全部落局用例。
落局用例各自独立起栈，彻底消除跨用例污染。日志 tee 到 bot/e2e/.logs/<name>.log。
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from .backend_runner import (
    base_ws_url,
    start_backend,
    stop_backend,
    wait_backend_ready,
)
from .bot_runner import start_bot, stop_bot, wait_bot_port
from .conftest import BOT_ID, _spawn_tee
from .fake_onebot import FakeOneBot


@contextmanager
def isolated_stack(backend_port: int, bot_port: int, name: str) -> Iterator[FakeOneBot]:
    """起独立 backend+bot，yield 已连接的 FakeOneBot，teardown 清进程树。"""
    backend = None
    bot = None
    client: FakeOneBot | None = None
    try:
        backend = start_backend(port=backend_port)
        _spawn_tee(backend, f"backend-{name}")
        wait_backend_ready(backend_port)

        bot = start_bot(base_ws_url(backend_port), port=bot_port)
        _spawn_tee(bot, f"bot-{name}")
        wait_bot_port(bot_port)

        client = FakeOneBot("127.0.0.1", bot_port, bot_id=BOT_ID)
        client.connect(timeout=30.0)
        yield client
    finally:
        if client is not None:
            client.close()
        if bot is not None:
            stop_bot(bot)
        if backend is not None:
            stop_backend(backend)
