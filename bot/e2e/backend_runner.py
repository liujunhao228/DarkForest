"""后端（Go）子进程编排：启动 / 探活 / 清理。

E2E 用真实 Go 后端 + Postgres，复用 frontend E2E 的环境约定：
- 从 ``backend/.env`` 解析注入 DATABASE_URL / JWT_SECRET / ADMIN_SECRET_KEY；
- 覆盖 E2E 旁路变量（LOCAL_TRUST_MODE、限流、确定性 RNG、测试注入 API）。
后端启动时会自动执行数据库迁移（cmd/server main.runMigrations）。
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = BOT_DIR.parent / "backend"
DEFAULT_PORT = 18080

_E2E_OVERRIDES: dict[str, str] = {
    "PORT": str(DEFAULT_PORT),
    "LOCAL_TRUST_MODE": "1",
    "DISABLE_RATE_LIMIT": "1",
    "E2E_RAND_SEED": "42",
    "E2E_DETERMINISTIC_UID": "1",
    "E2E_MATCH_CHECK_INTERVAL_MS": "1000",
    "E2E_MATCHMAKING_TIMEOUT_MS": "30000",
    "E2E_FALLBACK_TIMEOUT_MS": "3000",
    "E2E_TEST_API": "1",
}


def _load_backend_env() -> dict[str, str]:
    """解析 backend/.env，返回存在的键值（不做类型转换）。"""
    env_path = BACKEND_DIR / ".env"
    out: dict[str, str] = {}
    if not env_path.exists():
        return out
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        out[key] = value
    return out


def build_backend_env() -> dict[str, str]:
    """组装后端子进程 env：.env 键 + E2E 覆盖（覆盖优先）。"""
    env = os.environ.copy()
    env.update(_load_backend_env())
    env.update(_E2E_OVERRIDES)
    return env


def start_backend(port: int = DEFAULT_PORT) -> subprocess.Popen:
    """启动后端子进程（go run ./cmd/server），返回 Popen 句柄。

    Windows 下以新进程组启动，便于整棵进程树终止。
    """
    overrides = dict(_E2E_OVERRIDES)
    overrides["PORT"] = str(port)
    env = os.environ.copy()
    env.update(_load_backend_env())
    env.update(overrides)

    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

    return subprocess.Popen(
        ["go", "run", "./cmd/server"],
        cwd=str(BACKEND_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=creationflags,
    )


def wait_backend_ready(port: int = DEFAULT_PORT, timeout: float = 120.0) -> None:
    """轮询 GET /api/health；2xx/4xx 均视为就绪，5xx/网络错误重试。

    Raises:
        TimeoutError: 超时未就绪。
    """
    deadline = time.monotonic() + timeout
    url = f"http://127.0.0.1:{port}/api/health"
    last_error: str | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2.0) as resp:
                if resp.status < 500:
                    return
                last_error = f"http {resp.status}"
        except Exception as exc:  # noqa: BLE001 - 就绪探测吞掉一切网络异常
            last_error = f"{type(exc).__name__}: {exc}"
        time.sleep(0.5)
    raise TimeoutError(f"后端未就绪（{url}）: {last_error}")


def stop_backend(proc: subprocess.Popen) -> None:
    """终止后端子进程；Windows 用 taskkill /T /F 兜底整棵进程树。"""
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


def base_ws_url(port: int = DEFAULT_PORT) -> str:
    """返回后端 WS 基址（bot 的 BACKEND_WS_URL 用）。"""
    return f"ws://127.0.0.1:{port}"
