"""bot（nonebot）子进程编排：启动 / 探活 / 清理。

bot 以 ``python -m darkforest_bot.main`` 起在独立子进程，E2E 的 pytest 进程内
不再调用 nonebot.init（避免与 tests/conftest 冲突）。后端 WS 走 LOCAL_TRUST_MODE
（/ws?qq=&name=），bot 反转 WS 服务器监听 BOT_WS_HOST:BOT_WS_PORT 供 FakeOneBot 连接。
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_PORT = 18081


def start_bot(
    backend_ws_url: str,
    port: int = DEFAULT_PORT,
    *,
    group_require_at_mention: bool = False,
) -> subprocess.Popen:
    """启动 bot 子进程，返回 Popen 句柄。"""
    env = os.environ.copy()
    env.update(
        {
            "BOT_WS_HOST": "127.0.0.1",
            "BOT_WS_PORT": str(port),
            "BACKEND_WS_URL": f"{backend_ws_url}/ws",
            "GROUP_REQUIRE_AT_MENTION": "true" if group_require_at_mention else "false",
            "MATCH_COUNT_MIN": "2",
            "MATCH_COUNT_MAX": "5",
            "ACTION_ERROR_TIMEOUT": "1.0",
            "STATE_REQUEST_TIMEOUT": "15.0",
            "LOG_LEVEL": "INFO",
        }
    )

    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

    return subprocess.Popen(
        [sys.executable, "-m", "darkforest_bot.main"],
        cwd=str(BOT_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=creationflags,
    )


def wait_bot_port(port: int = DEFAULT_PORT, timeout: float = 60.0) -> None:
    """等 bot 反转 WS 端口可接受 TCP 连接（粗探活，最终以 FakeOneBot 握手为准）。"""
    deadline = time.monotonic() + timeout
    last_error: str | None = None
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1.0):
                return
        except OSError as exc:
            last_error = str(exc)
        time.sleep(0.5)
    raise TimeoutError(f"bot 端口 {port} 未就绪: {last_error}")


def stop_bot(proc: subprocess.Popen) -> None:
    """终止 bot 子进程；Windows 用 taskkill /T /F 兜底整棵进程树。"""
    if proc.poll() is None:
        try:
            proc.terminate()
        except OSError:
            pass
    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                capture_output=True,
                timeout=10,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass
    else:
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
