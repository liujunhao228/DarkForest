"""E2E 会话级 fixtures：真实 Go 后端 + bot 子进程 + FakeOneBot 客户端。

编排链路：
    1. 后端子进程（go run ./cmd/server，PORT=18080，LOCAL_TRUST_MODE 等 E2E env）
    2. bot 子进程（python -m darkforest_bot.main，连后端 /ws，监听 18081）
    3. FakeOneBot 连 bot 反转 WS（同时作为就绪探活与测试客户端）

生命周期用后台事件循环线程承载（见 fake_onebot.py），fixture 为同步函数，
无需 pytest-asyncio 的 loop 作用域配合。子进程日志 tee 到 bot/e2e/.logs/ 便于诊断。
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from pathlib import Path

import pytest

from .backend_runner import (
    base_ws_url,
    start_backend,
    stop_backend,
    wait_backend_ready,
)
from .bot_runner import start_bot, stop_bot, wait_bot_port
from .fake_onebot import FakeOneBot

pytestmark = [pytest.mark.e2e]

BACKEND_PORT = 18080
BOT_PORT = 18081
BOT_ID = 20000001
LOGS_DIR = Path(__file__).parent / ".logs"


def _tee_subprocess(proc, name: str) -> None:
    """把子进程 stdout 逐行写入日志文件并转发给 logging，供失败诊断。"""
    LOGS_DIR.mkdir(exist_ok=True)
    log_path = LOGS_DIR / f"{name}.log"
    with log_path.open("a", encoding="utf-8") as fh:
        assert proc.stdout is not None
        for line in iter(proc.stdout.readline, ""):
            fh.write(line)
            fh.flush()


def _spawn_tee(proc, name: str) -> threading.Thread:
    thread = threading.Thread(target=_tee_subprocess, args=(proc, name), daemon=True)
    thread.start()
    return thread


@pytest.fixture(scope="session")
def backend_ws() -> Iterator[str]:
    """启动真实 Go 后端，yield WS 基址，teardown 终止并清进程树。"""
    proc = start_backend(port=BACKEND_PORT)
    tee = _spawn_tee(proc, "backend")
    try:
        wait_backend_ready(port=BACKEND_PORT)
        yield base_ws_url(BACKEND_PORT)
    finally:
        stop_backend(proc)
        tee.join(timeout=2.0)


@pytest.fixture(scope="session")
def bot_proc(backend_ws: str) -> Iterator[object]:
    """启动 bot 子进程（连后端 /ws，监听 BOT_PORT）。"""
    proc = start_bot(backend_ws, port=BOT_PORT)
    tee = _spawn_tee(proc, "bot")
    try:
        wait_bot_port(BOT_PORT)
        yield proc
    finally:
        stop_bot(proc)
        tee.join(timeout=2.0)


@pytest.fixture(scope="session")
def fake_onebot(bot_proc: object) -> Iterator[FakeOneBot]:
    """FakeOneBot 连接 bot 反转 WS；同时作为就绪探活（失败即抛）。"""
    client = FakeOneBot("127.0.0.1", BOT_PORT, bot_id=BOT_ID)
    try:
        client.connect(timeout=30.0)
        yield client
    finally:
        client.close()
