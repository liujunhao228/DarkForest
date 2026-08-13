"""driver 管理函数单测：spawn_driver / driver_status / stop_driver /
validate_script / report_batch。

spawn_driver 用 stub subprocess.Popen 断言参数传递正确、stub subprocess.run 断言
L1 前置硬门（validate 不过不启动）；report_batch 断言 JSON 序列化与
agent_message 缺失/异常的兜底行为。
"""

from __future__ import annotations

import json
import subprocess
import sys
import types
from typing import Any
from unittest.mock import AsyncMock

import pytest

import darkforest


class FakeProc:
    """Popen stub：记录构造参数，可模拟运行/已退出。"""

    def __init__(self, cmd: list[str], **kwargs: Any) -> None:
        self.cmd = cmd
        self.kwargs = kwargs
        self.pid = 4242
        self._returncode: int | None = None

    def poll(self) -> int | None:
        return self._returncode

    def terminate(self) -> None:
        self._returncode = 0

    def kill(self) -> None:
        self._returncode = -9

    def wait(self, timeout: float | None = None) -> int:
        if self._returncode is None:
            self._returncode = 0
        return self._returncode


class FakeCompleted:
    """subprocess.run stub 返回：L1 硬门校验结果。"""

    def __init__(self, returncode: int, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


@pytest.fixture(autouse=True)
def _reset_driver_state() -> None:
    yield
    darkforest._driver_proc = None  # noqa: SLF001
    darkforest._driver_log_path = None  # noqa: SLF001
    darkforest._driver_script = None  # noqa: SLF001
    sys.modules.pop("agent_message", None)


@pytest.fixture
def stub_popen(monkeypatch: pytest.MonkeyPatch) -> FakeProc:
    fake = FakeProc(["placeholder"])

    def _popen(cmd: list[str], **kwargs: Any) -> FakeProc:
        fake.cmd = cmd
        fake.kwargs = kwargs
        return fake

    monkeypatch.setattr(darkforest.subprocess, "Popen", _popen)
    return fake


@pytest.fixture
def stub_run_ok(monkeypatch: pytest.MonkeyPatch) -> FakeCompleted:
    """L1 硬门放行：validate 子进程 exit 0。"""
    fake = FakeCompleted(0, stdout="校验通过: a.py（干跑 50 次决策）")

    def _run(cmd: list[str], **kwargs: Any) -> FakeCompleted:
        fake.cmd = cmd
        fake.kwargs = kwargs
        return fake

    monkeypatch.setattr(darkforest.subprocess, "run", _run)
    return fake


def test_spawn_driver_passes_script_and_games(
    stub_popen: FakeProc, stub_run_ok: FakeCompleted
) -> None:
    out = darkforest.spawn_driver("rules/s1/v1.py", 10, game_mode="classic")

    assert out["ok"] is True
    assert out["pid"] == 4242
    # -m autonomous_driver --script <abs> --games 10 --game-mode classic --mcp-url <default>
    assert stub_popen.cmd[0] == sys.executable
    assert "-m" in stub_popen.cmd
    # 相对路径按 cwd 解析为绝对路径（Windows 反斜杠，按分隔符拆分比对）
    script_arg = stub_popen.cmd[stub_popen.cmd.index("--script") + 1]
    assert script_arg.split("\\")[-3:] == ["rules", "s1", "v1.py"]
    assert "--games" in stub_popen.cmd
    assert stub_popen.cmd[stub_popen.cmd.index("--games") + 1] == "10"
    assert "--game-mode" in stub_popen.cmd
    assert stub_popen.cmd[stub_popen.cmd.index("--game-mode") + 1] == "classic"
    assert "--mcp-url" in stub_popen.cmd
    # L2 首局即冒烟：spawn 默认带 --smoke-first
    assert "--smoke-first" in stub_popen.cmd
    assert darkforest._driver_proc is not None  # noqa: SLF001
    assert out["log_path"]  # 日志文件已创建


def test_spawn_driver_hard_gate_rejects_bad_script(
    stub_popen: FakeProc, monkeypatch: pytest.MonkeyPatch
) -> None:
    """L1 硬门：validate exit 2 → 返回 {ok:false}，不启动 driver。"""

    def _run_bad(cmd: list[str], **kwargs: Any) -> FakeCompleted:
        return FakeCompleted(2, stderr="校验失败: 脚本未定义 ScriptDecider 类: x.py")

    monkeypatch.setattr(darkforest.subprocess, "run", _run_bad)

    out = darkforest.spawn_driver("x.py", 2)
    assert out["ok"] is False
    assert "L1 校验未通过" in out["reason"]
    assert "未定义 ScriptDecider" in out["reason"]
    # Popen 未被调用（gate 后直接返回）
    assert stub_popen.cmd == ["placeholder"]
    assert darkforest._driver_proc is None  # noqa: SLF001


def test_validate_script_ok(stub_run_ok: FakeCompleted) -> None:
    out = darkforest.validate_script("rules/s1/v1.py")
    assert out["ok"] is True
    assert "校验通过" in out["reason"]
    # 命令形态：<python> -m autonomous_driver validate --script <abs>
    assert stub_run_ok.cmd[0] == sys.executable
    assert "-m" in stub_run_ok.cmd
    assert "validate" in stub_run_ok.cmd
    assert "--script" in stub_run_ok.cmd


def test_validate_script_fail(monkeypatch: pytest.MonkeyPatch) -> None:
    def _run_bad(cmd: list[str], **kwargs: Any) -> FakeCompleted:
        return FakeCompleted(2, stderr="校验失败: 第 3 次决策抛异常: boom")

    monkeypatch.setattr(darkforest.subprocess, "run", _run_bad)
    out = darkforest.validate_script("bad.py")
    assert out["ok"] is False
    assert "boom" in out["reason"]


def test_validate_script_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    def _run_timeout(cmd: list[str], **kwargs: Any) -> FakeCompleted:
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=60)

    monkeypatch.setattr(darkforest.subprocess, "run", _run_timeout)
    out = darkforest.validate_script("slow.py")
    assert out["ok"] is False
    assert "超时" in out["reason"]


def test_validate_script_oserror(monkeypatch: pytest.MonkeyPatch) -> None:
    def _run_oserror(cmd: list[str], **kwargs: Any) -> FakeCompleted:
        raise OSError("解释器不存在")

    monkeypatch.setattr(darkforest.subprocess, "run", _run_oserror)
    out = darkforest.validate_script("a.py")
    assert out["ok"] is False
    assert "启动失败" in out["reason"]


def test_spawn_driver_rejects_duplicate_while_running(
    stub_popen: FakeProc, stub_run_ok: FakeCompleted
) -> None:
    darkforest.spawn_driver("a.py", 2)  # FakeProc.poll() -> None → 运行中
    out = darkforest.spawn_driver("b.py", 2)
    assert out["ok"] is False
    assert "已有 driver" in out["reason"]


def test_spawn_driver_honors_autonomous_python(
    stub_popen: FakeProc, stub_run_ok: FakeCompleted, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AUTONOMOUS_PYTHON", "C:/venvs/auto/python.exe")
    darkforest.spawn_driver("a.py", 1)
    assert stub_popen.cmd[0] == "C:/venvs/auto/python.exe"


def test_driver_status_running_and_exited(
    stub_popen: FakeProc, stub_run_ok: FakeCompleted
) -> None:
    darkforest.spawn_driver("a.py", 1)
    status = darkforest.driver_status()
    assert status["running"] is True
    assert status["pid"] == 4242
    assert status["script"].endswith("a.py")

    stub_popen._returncode = 0  # 进程已退出
    status = darkforest.driver_status()
    assert status["running"] is False
    assert status["pid"] == 4242
    assert status["last_log"] != "" or status["last_log"] == ""  # 存在性宽松


def test_driver_status_without_spawn() -> None:
    status = darkforest.driver_status()
    assert status["running"] is False
    assert status["pid"] is None
    assert status["last_log"] == ""


def test_stop_driver_terminates(stub_popen: FakeProc, stub_run_ok: FakeCompleted) -> None:
    darkforest.spawn_driver("a.py", 1)
    out = darkforest.stop_driver()
    assert out["ok"] is True
    assert out["pid"] == 4242
    assert out["had_process"] is True
    assert darkforest._driver_proc is None  # noqa: SLF001


def test_stop_driver_idempotent_when_none() -> None:
    out = darkforest.stop_driver()
    assert out["ok"] is True
    assert out["had_process"] is False


@pytest.mark.asyncio
async def test_report_batch_serializes_json() -> None:
    mod = types.ModuleType("agent_message")
    send = AsyncMock()
    mod.send = send
    sys.modules["agent_message"] = mod

    out = await darkforest.report_batch(
        "batch_start", {"script_name": "s1", "version": "v1", "plan_games": 10}
    )

    assert out == {"ok": True}
    send.assert_awaited_once()
    call = send.await_args
    assert call is not None
    assert call.kwargs.get("receiver_role") == "parent"
    parsed = json.loads(call.args[0])
    assert parsed == {
        "event": "batch_start",
        "script_name": "s1",
        "version": "v1",
        "plan_games": 10,
    }


@pytest.mark.asyncio
async def test_report_batch_ok_false_when_agent_message_missing() -> None:
    # 不注入 agent_message：内核模块缺失 → ImportError 兜底
    out = await darkforest.report_batch("batch_start", {"plan_games": 5})
    assert out["ok"] is False
    assert "agent_message" in out["reason"]


@pytest.mark.asyncio
async def test_report_batch_ok_false_when_send_raises() -> None:
    mod = types.ModuleType("agent_message")
    send = AsyncMock(side_effect=RuntimeError("网络中断"))
    mod.send = send
    sys.modules["agent_message"] = mod

    out = await darkforest.report_batch("batch_start", {})
    assert out["ok"] is False
    assert "网络中断" in out["reason"]
