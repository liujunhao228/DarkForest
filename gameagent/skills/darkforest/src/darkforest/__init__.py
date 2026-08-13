"""DarkForest 游戏 API 顶层模块。

供 prime-agent 的 IPython 内核预导入后由游戏 Agent 直接调用。所有函数均为
``async``，内部经 ``DarkForestMCPClient``（Streamable HTTP 长连接）转发到
mcpserver；返回值是解析后的 JSON 结构（dict），不是裸文本。

用法：:

    import darkforest

    await darkforest.connect("ai1")
    await darkforest.join_match_queue()
    loop:
        evt = await darkforest.wait_for_event(30)
        ...
        await darkforest.end_turn()
    await darkforest.disconnect()

每个子 Agent 对应一个独立进程（IPython 内核），模块级共享一个 client 实例即可
（对应 mcpserver 一个 session / 账户池条目）。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .mcp_client import DarkForestMCPClient
from .validator import validate_action

__all__ = [
    "connect",
    "disconnect",
    "get_view",
    "get_affordances",
    "get_recent_delta",
    "wait_for_event",
    "join_match_queue",
    "cancel_match_queue",
    "wait_for_match",
    "play_card",
    "deploy_card",
    "strike",
    "broadcast",
    "respond_broadcast",
    "select_broadcast_responder",
    "cancel_broadcast",
    "recycle_card",
    "end_turn",
    "lightspeed_ship",
    "forfeit_game",
    "validate_action",
    # Swarm：driver 管理 + 阶段汇报
    "spawn_driver",
    "driver_status",
    "stop_driver",
    "validate_script",
    "report_batch",
    # Swarm：复盘流程（读回放 → 发布 vN+1）
    "review_cycle",
    "publish_version",
]

_DEFAULT_MCP_URL = "http://localhost:9090/mcp"
_client: DarkForestMCPClient | None = None
# 最近一次 connect 的 agent_name（不随 disconnect 清空）：review_cycle 等
# 临时连接缺省用它——trust 模式账池只有播种名单，子 Agent 实际连过的名字
# 一定在名单内，比写死的 "reviewer" 更可靠。
_last_agent_name = ""

# --- Swarm：driver 子进程句柄（模块级单句柄，与 _client 同生命周期语义） ---
_driver_proc: subprocess.Popen[str] | None = None
_driver_log_path: str | None = None
_driver_script: str | None = None


def _require_client() -> DarkForestMCPClient:
    if _client is None:
        raise RuntimeError("尚未连接：请先 await darkforest.connect(agent_name)")
    return _client


# --- 连接 / 生命周期 ---


async def connect(agent_name: str) -> dict[str, Any]:
    """建立 MCP 长连接并调用 ``ensure_connected``。

    ``agent_name`` 是 mcpserver 账户池里的 agent sid（信任模式无需鉴权头）。
    重复调用幂等，返回 ``{connected, accountId, displayName, playerId}``。
    """
    global _client, _last_agent_name
    if _client is None:
        url = os.environ.get("MCP_URL", _DEFAULT_MCP_URL)
        _client = DarkForestMCPClient(url, agent_name)
        await _client.connect()
    _last_agent_name = agent_name
    return await _client.call_tool("ensure_connected")


async def disconnect() -> dict[str, Any]:
    """调用 ``disconnect``，断开游戏连接并归还账户到池。返回 ``{success}``。"""
    try:
        return await _require_client().call_tool("disconnect")
    finally:
        global _client
        if _client is not None:
            await _client.close()
            _client = None


# --- 查询 / 感知 ---


async def get_view() -> dict[str, Any]:
    """调 ``get_agent_view``：返回五层语义视图，仅游戏中填充，否则 ``{inGame: false}``。"""
    return await _require_client().call_tool("get_agent_view")


async def get_affordances() -> dict[str, Any]:
    """调 ``get_affordances``：返回当前合法动作集 ``{inGame, affordance}``。"""
    return await _require_client().call_tool("get_affordances")


async def get_recent_delta() -> dict[str, Any]:
    """调 ``get_recent_delta``：返回最近一次 fullSync 的结构化 diff。"""
    return await _require_client().call_tool("get_recent_delta")


async def wait_for_event(timeout_seconds: int = 30) -> dict[str, Any]:
    """调 ``wait_for_event``：阻塞等待新游戏事件，返回 ``{hasEvent, events, delta}``。"""
    return await _require_client().call_tool(
        "wait_for_event", {"timeoutSeconds": timeout_seconds}
    )


# --- 匹配 / 队列 ---


async def join_match_queue(
    preferred_count: int = 2, game_mode: str = "classic"
) -> dict[str, Any]:
    """调 ``join_match_queue``：加入快速匹配队列，人数达到 ``preferred_count`` 即开房。"""
    return await _require_client().call_tool(
        "join_match_queue",
        {"preferredCount": preferred_count, "gameMode": game_mode},
    )


async def cancel_match_queue() -> dict[str, Any]:
    """调 ``cancel_match_queue``：取消快速匹配队列。返回 ``{cancelled}``。"""
    return await _require_client().call_tool("cancel_match_queue")


async def wait_for_match(
    preferred_count: int = 2,
    game_mode: str = "classic",
    wait_seconds: int = 20,
) -> dict[str, Any]:
    """加入快速匹配队列并以 keep-alive 方式持续等待，直到匹配成功。

    LLM 只需 ``await`` 一次：本函数在 Python 侧自持循环，``wait_for_event``
    超时或收到 ``match:error TIMEOUT``（被后端 30s 队列超时踢出）后立即重新
    ``join_match_queue``（后端 ``ON CONFLICT`` 重置 ``joined_at``，永不被踢）。
    两个子 Agent 只要都进入本函数就持续同时在队列，后端每 5 秒轮询即开房，
    与各自的 LLM 决策/好奇度无关。

    匹配成功（``match:found``）时返回本次 ``wait_for_event`` 的完整输出
    ``{hasEvent, events, delta}``，供主循环直接进入对局。

    注意：排队期间后端 30s 超时会踢队，必须保持本函数自持的循环；不要在
    排队期间调用 ``get_queue_info`` / ``get_my_queues`` / ``get_match_status``
    （它们会排空事件队列，可能吞掉 ``match:found``）。
    """
    client = _require_client()

    async def _join() -> None:
        await client.call_tool(
            "join_match_queue",
            {"preferredCount": preferred_count, "gameMode": game_mode},
        )

    await _join()
    while True:
        out = await client.call_tool("wait_for_event", {"timeoutSeconds": wait_seconds})
        events = out.get("events") or []
        if any(e.get("type") == "match:found" for e in events):
            return out
        timed_out = not out.get("hasEvent")
        timeout_error = any(
            e.get("type") == "match:error"
            and (e.get("payload") or {}).get("code") == "TIMEOUT"
            for e in events
        )
        if timed_out or timeout_error:
            # 后端 30s 队列超时踢队（或接近超时）→ 立即重入队刷新 joined_at
            await _join()
            continue
        # 其他排队期事件（match:queueJoined / match:queueUpdate 等）忽略，继续等


# --- 动作 ---


async def play_card(card_uid: str) -> dict[str, Any]:
    """调 ``play_card``：出牌。"""
    return await _require_client().call_tool("play_card", {"cardUid": card_uid})


async def deploy_card(card_uid: str) -> dict[str, Any]:
    """调 ``deploy_card``：部署设施卡。"""
    return await _require_client().call_tool("deploy_card", {"cardUid": card_uid})


async def strike(
    card_uid: str, target_system: int, target_player_id: str = ""
) -> dict[str, Any]:
    """调 ``strike``：发射打击卡牌。仅「科技锁死」卡允许传 ``target_player_id``。"""
    args: dict[str, Any] = {"cardUid": card_uid, "targetSystem": target_system}
    if target_player_id:
        args["targetPlayerId"] = target_player_id
    return await _require_client().call_tool("strike", args)


async def broadcast(card_uid: str, target_system: int) -> dict[str, Any]:
    """调 ``broadcast``：发起广播。"""
    return await _require_client().call_tool(
        "broadcast", {"cardUid": card_uid, "targetSystem": target_system}
    )


async def respond_broadcast(agreed: bool, card_uid: str = "") -> dict[str, Any]:
    """调 ``respond_broadcast``：同意合作（``agreed=true`` 时必须传广播卡）或伪装。"""
    args: dict[str, Any] = {"agreed": agreed}
    if card_uid:
        args["cardUid"] = card_uid
    return await _require_client().call_tool("respond_broadcast", args)


async def select_broadcast_responder(responder_id: str) -> dict[str, Any]:
    """调 ``select_broadcast_responder``：广播发起者选择响应者。"""
    return await _require_client().call_tool(
        "select_broadcast_responder", {"responderId": responder_id}
    )


async def cancel_broadcast() -> dict[str, Any]:
    """调 ``cancel_broadcast``：取消当前广播。"""
    return await _require_client().call_tool("cancel_broadcast")


async def recycle_card(card_uid: str) -> dict[str, Any]:
    """调 ``recycle_card``：回收场上明牌。"""
    return await _require_client().call_tool("recycle_card", {"cardUid": card_uid})


async def end_turn(
    discard_cards: list[str] | None = None, public_discard: bool = False
) -> dict[str, Any]:
    """调 ``end_turn``：结束当前回合，可同时弃牌。"""
    args: dict[str, Any] = {}
    if discard_cards:
        args["discardCards"] = discard_cards
    if public_discard:
        args["publicDiscard"] = True
    return await _require_client().call_tool("end_turn", args)


async def lightspeed_ship(
    mode: str,
    target_system: int,
    carry_energy: int,
    message: str,
    leave_behind: bool,
    broadcast_on_inherit: bool | None = None,
) -> dict[str, Any]:
    """调 ``lightspeed_ship``：光速飞船跃迁（普通 / 文明遗迹模式行为分化）。"""
    args: dict[str, Any] = {
        "mode": mode,
        "targetSystem": target_system,
        "carryEnergy": carry_energy,
        "message": message,
        "leaveBehind": leave_behind,
    }
    if broadcast_on_inherit is not None:
        args["broadcastOnInherit"] = broadcast_on_inherit
    return await _require_client().call_tool("lightspeed_ship", args)


async def forfeit_game() -> dict[str, Any]:
    """调 ``forfeit_game``：主动弃权并触发结算。"""
    return await _require_client().call_tool("forfeit_game")


# --- Swarm：driver 管理（脚本作者/复盘教练侧） ---


def _autonomous_venv_python() -> str:
    """探测 autonomous 子包（gameagent/autonomous，uv）的 venv 解释器。

    Windows: ``.venv/Scripts/python.exe``；POSIX: ``.venv/bin/python[3]``。
    找不到返回空串（调用方回退 sys.executable）。
    """
    here = Path(__file__).resolve()
    # src/darkforest → src → darkforest(skill) → skills → gameagent
    gameagent_root = here.parents[4]
    venv_root = gameagent_root / "autonomous" / ".venv"
    if not venv_root.is_dir():
        return ""
    for name in ("Scripts/python.exe", "bin/python", "bin/python3"):
        candidate = venv_root / name
        if candidate.is_file():
            return str(candidate)
    return ""


def _driver_python() -> str:
    """定位 driver 解释器：env AUTONOMOUS_PYTHON → autonomous/.venv 自动探测 → sys.executable。

    子 Agent 的 sys.executable 是 IPython 内核的解释器（大概率 3.11，缺
    mcp/typer/autonomous_driver 依赖）——E2E 实测直接跑 validate 报
    ``No module named 'autonomous_driver'``。autonomous 是 gameagent 下的
    uv 子包，其 venv（.venv）装有全部依赖，是本函数自动探测的目标；
    AUTONOMOUS_PYTHON 仍为最高优先级（宿主显式指定）。
    """
    explicit = os.environ.get("AUTONOMOUS_PYTHON")
    if explicit:
        return explicit
    probed = _autonomous_venv_python()
    if probed:
        return probed
    return sys.executable


def _driver_env() -> dict[str, str]:
    """driver/validate 子进程环境：清除内核会话的 Python 路径污染。

    子 Agent 的 IPython 内核可能向环境注入 PYTHONHOME / VIRTUAL_ENV /
    PYTHONPATH（指向内核 venv，如 3.11 的 kernel-venv）——autonomous venv
    （3.12）子进程继承后要么 ``No module named 'encodings'``（PYTHONHOME
    错配导致运行时崩溃），要么 3.11 site-packages 混入 import 路径造成
    DLL 冲突/卡死（E2E 实测 ai1 子 Agent 曾在此卡 5 分钟）。这里移除这三
    个变量，并把 PYTHONPATH 显式指向 autonomous/src（``python -m
    autonomous_driver`` 只把 cwd 加入 sys.path，cwd=autonomous 时不含 src
    子目录，找不到包）。
    """
    env = os.environ.copy()
    env.pop("PYTHONHOME", None)
    env.pop("VIRTUAL_ENV", None)
    env.pop("PYTHONPATH", None)
    here = Path(__file__).resolve()
    gameagent_root = here.parents[4]
    src_dir = gameagent_root / "autonomous" / "src"
    if src_dir.is_dir():
        env["PYTHONPATH"] = str(src_dir)
    return env


def _driver_error_hint(stderr: str) -> str:
    """validate 子进程失败诊断：ModuleNotFoundError 大概率是解释器不是 autonomous venv。"""
    if "ModuleNotFoundError" in stderr or "No module named" in stderr:
        return (
            "（提示：当前解释器不是 autonomous venv，请设置 AUTONOMOUS_PYTHON "
            "指向 gameagent/autonomous/.venv 的解释器）"
        )
    if "encodings" in stderr or "DLL load failed" in stderr:
        return (
            "（提示：子进程继承了内核会话的 PYTHONHOME/PYTHONPATH 污染，"
            "请设置 AUTONOMOUS_PYTHON 指向 autonomous venv 且确保 PYTHONHOME 未指向内核）"
        )
    return ""


# 环境级错误识别表（driver 日志 → 快速失败提示）。顺序即优先级：具体模式在前
# （"账户池中没有可用账户" 优先于通用 "连接/排队失败"——日志里环境错误经常
# 同时命中多条）。
_ENV_ERROR_HINTS: tuple[tuple[str, str], ...] = (
    (
        "账户池中没有可用账户",
        "【环境问题】账户池已耗尽（其他对局占用中），不是脚本问题——修复脚本无意义，"
        "请直接上报 driver_failed 并停止重试",
    ),
    (
        "借用账户失败",
        "【环境问题】账户借用失败（账户池资源不足），不是脚本问题——请直接上报 "
        "driver_failed 并停止重试",
    ),
    (
        "重连/重排超过",
        "【环境问题】重连/重排超限（匹配环境持续异常），不是脚本问题——请直接上报 "
        "driver_failed 并停止重试",
    ),
    (
        "match:error",
        "【环境问题】匹配服务失败（队列超时/无对手），不是脚本问题——请直接上报 "
        "driver_failed 并停止重试",
    ),
    (
        "连接/排队失败",
        "【环境问题】连接/排队失败（服务不可用或资源不足），不是脚本问题——请直接上报 "
        "driver_failed 并停止重试",
    ),
)


def _env_error_hint(log_text: str) -> str:
    """从 driver 日志检测环境级错误（与脚本质量无关，修复脚本无意义）。

    命中返回可读提示（供子 Agent 直接上报 driver_failed），未命中返回空串。
    背景（2026-08-13 日志分析）：ai2 遇「账户池中没有可用账户」后误判为脚本
    问题，连续 7 个 LLM 回合读 driver/state_machine 源码排查烧 token——本
    函数让 driver_status 在 driver 退出后把环境错误显式标注出来。
    """
    for marker, hint in _ENV_ERROR_HINTS:
        if marker in log_text:
            return hint
    return ""


def _driver_cwd() -> str:
    """driver 子进程工作目录：autonomous 包根（装 autonomous_driver 的 venv 同链）。

    skill 包位于 gameagent/skills/darkforest/src/darkforest/，autonomous 包
    位于 gameagent/autonomous/（uv 子包）。向上四级取 gameagent 根再进
    autonomous；不存在则退回 skill 包目录（autonomous_driver 已装进环境时
    无所谓 cwd）。
    """
    here = Path(__file__).resolve()
    # src/darkforest → src → darkforest(skill) → skills → gameagent
    gameagent_root = here.parents[4]
    candidate = gameagent_root / "autonomous"
    if candidate.is_dir():
        return str(candidate)
    return str(here.parent)


def validate_script(script_path: str, python: str = "") -> dict[str, Any]:
    """L1 离线校验门：子进程跑 driver ``validate``，返回 ``{ok, reason}``。

    命令 ``python -m autonomous_driver validate --script <abs path>``（解释器取
    env ``AUTONOMOUS_PYTHON``，缺省 ``sys.executable``；cwd 与 spawn_driver 一致
    ——对齐真实运行的包环境）。exit 0=通过 / 2=失败，reason 取失败输出。

    与 ``spawn_driver`` 的硬门关系：spawn 前会先跑本函数，ok=False 直接拒绝
    启动（子 Agent 无法跳过）。本函数单独暴露供写脚本后自检拿 reason。
    """
    interp = python or _driver_python()
    script_abs = str(Path(script_path).resolve())
    cmd = [interp, "-m", "autonomous_driver", "validate", "--script", script_abs]
    try:
        proc = subprocess.run(
            cmd,
            cwd=_driver_cwd(),
            env=_driver_env(),
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "L1 校验超时（60s）"}
    except OSError as exc:
        return {"ok": False, "reason": f"L1 校验进程启动失败: {exc}"}
    if proc.returncode == 0:
        return {"ok": True, "reason": (proc.stdout or "").strip()}
    reason = (proc.stderr or proc.stdout or "").strip() or f"exit={proc.returncode}"
    hint = _driver_error_hint(proc.stderr or "")
    if hint:
        reason = f"{reason} {hint}"
    return {"ok": False, "reason": reason}


def spawn_driver(
    script_path: str,
    games: int,
    game_mode: str = "classic",
    mcp_url: str = "",
) -> dict[str, Any]:
    """启动 driver 子进程批量打 N 局（脚本协议 decider）。

    **前置硬门（L1 离线校验，设计文档 §4.5）**：spawn 前先子进程跑
    ``validate``（validate_script），exit≠0 直接返回 ``{ok: false, reason}``
    不启动 driver——结构性执行，子 Agent 无法跳过；坏脚本零对局成本拦截。

    ``subprocess.Popen`` 拉起 ``python -m autonomous_driver --script <path>
    --games N --game-mode <mode> --mcp-url <url> --smoke-first``（默认带
    ``--smoke-first``：批量第一局兼作动态冒烟，首局异常/拒绝超阈值即中止，
    止损 ≤1 局），stdout/stderr 合并写入临时日志文件（driver_status 读其尾部）。
    模块级保存句柄，同一时刻只允许一个 driver（重复 spawn 返回
    ``{ok: false, reason}``）。

    返回 ``{ok, pid, log_path}``；启动即抛（FileNotFoundError 等）不吞，
    由调用方（子 Agent）捕获后重试/上报 driver_failed。
    """
    global _driver_proc, _driver_log_path, _driver_script
    if _driver_proc is not None and _driver_proc.poll() is None:
        return {"ok": False, "reason": "已有 driver 在运行，先 stop_driver 或等其结束"}

    # L1 前置硬门：校验不过拒绝启动（结构性执行，不依赖子 Agent 自觉）。
    # 解释器不是 autonomous venv 时 validate 子进程 ModuleNotFoundError，
    # gate reason 会带 AUTONOMOUS_PYTHON 提示（_driver_error_hint）。
    gate = validate_script(script_path)
    if not gate["ok"]:
        return {"ok": False, "reason": f"L1 校验未通过，拒绝启动 driver: {gate['reason']}"}

    url = mcp_url or os.environ.get("MCP_URL", _DEFAULT_MCP_URL)
    script_abs = str(Path(script_path).resolve())
    cmd = [
        _driver_python(),
        "-m",
        "autonomous_driver",
        "--script",
        script_abs,
        "--games",
        str(games),
        "--game-mode",
        game_mode,
        "--mcp-url",
        url,
        "--smoke-first",
    ]
    log_fd, log_path = tempfile.mkstemp(prefix="df-driver-", suffix=".log", text=True)
    with os.fdopen(log_fd, "w", encoding="utf-8") as f:
        f.write(f"$ {' '.join(cmd)}\n")
    log_handle = open(log_path, "a", encoding="utf-8")  # noqa: SIM115  生命周期与子进程一致
    proc = subprocess.Popen(
        cmd,
        cwd=_driver_cwd(),
        env=_driver_env(),
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        text=True,
    )
    # log_handle 归 Popen 持有（Popen 关闭时一并关闭），此处保持引用防 GC
    _driver_proc = proc
    _driver_log_path = log_path
    _driver_script = script_abs
    return {"ok": True, "pid": proc.pid, "log_path": log_path}


def driver_status() -> dict[str, Any]:
    """查询 driver 子进程状态。

    返回 ``{running, pid, script, log_path, last_log, env_error}``：``running``
    为子进程是否存活；``last_log`` 是日志尾部最近 500 字符（进程结束后用于排查
    失败原因）；``env_error`` 仅在进程已退出且日志命中环境级错误（账户池耗尽 /
    借用账户失败 / 匹配失败 / 连接失败 / 重排超限）时非空——子 Agent 见到它应
    **直接上报 driver_failed**（环境问题修复脚本无意义，不要读源码排查）。
    未 spawn 过返回 ``{running: false, pid: null, last_log: "", env_error: ""}``。
    """
    global _driver_proc, _driver_log_path, _driver_script
    if _driver_proc is None:
        return {
            "running": False,
            "pid": None,
            "script": None,
            "log_path": None,
            "last_log": "",
            "env_error": "",
        }

    running = _driver_proc.poll() is None
    pid = _driver_proc.pid
    last_log = ""
    env_error = ""
    if _driver_log_path:
        try:
            p = Path(_driver_log_path)
            if p.exists():
                size = p.stat().st_size
                with open(p, encoding="utf-8", errors="replace") as f:
                    f.seek(max(0, size - 500))
                    last_log = f.read()
                if not running:
                    # 进程已退出：读全文检测环境级错误（尾部 500 字符可能被
                    # 多局日志覆盖），供子 Agent 快速失败
                    full = p.read_text(encoding="utf-8", errors="replace")
                    env_error = _env_error_hint(full)
        except OSError:
            last_log = "（日志读取失败）"
    return {
        "running": running,
        "pid": pid,
        "script": _driver_script,
        "log_path": _driver_log_path,
        "last_log": last_log,
        "env_error": env_error,
    }


def stop_driver(timeout_seconds: float = 5.0) -> dict[str, Any]:
    """终止 driver 子进程（terminate → 超时 kill）。幂等。

    返回 ``{ok, pid, had_process}``；进程退出后清空模块级句柄与日志路径
    （日志文件保留，供 driver_status 读取历史——注意 status 基于句柄，
    停掉后请以返回值为准，不再查 status）。
    """
    global _driver_proc, _driver_log_path, _driver_script
    proc = _driver_proc
    if proc is None or proc.poll() is not None:
        _driver_proc = None
        return {"ok": True, "pid": proc.pid if proc else None, "had_process": False}

    pid = proc.pid
    proc.terminate()
    try:
        proc.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=timeout_seconds)
    _driver_proc = None
    _driver_log_path = None
    _driver_script = None
    return {"ok": True, "pid": pid, "had_process": True}


async def report_batch(event: str, payload: dict[str, Any]) -> dict[str, Any]:
    """向父 Agent（编排器）上报阶段事件（agent_message JSON 协议）。

    ``message`` 必须是 JSON 字符串（``{"event": <event>, **payload}``，
    ensure_ascii=False），经 ``agent_message.send(message, receiver_role=
    "parent")`` 发送；``agent_message`` 是内核注入模块，本地 pytest 不存在
    ——try/except 兜底返回 ``{ok: false, reason}``，不影响对局流程。

    事件名与字段须与编排器解析器对齐（script_ready / batch_start /
    batch_end / driver_failed / review_done / v_published），字段 snake_case。
    """
    try:
        # 内核注入模块，运行时才可 import；本地 mypy 无该模块，必须 ignore
        # （import-not-found 是预期的静态检查结果，不是运行期问题）
        import agent_message  # type: ignore[import-not-found]
    except Exception as exc:
        return {"ok": False, "reason": f"agent_message 不可用: {exc}"}

    message = json.dumps({"event": event, **payload}, ensure_ascii=False)
    try:
        await agent_message.send(message, receiver_role="parent")
    except Exception as exc:
        return {"ok": False, "reason": f"{exc}"}
    return {"ok": True}


# --- Swarm：复盘流程（临时 MCP 连接读回放 → 分析 → 发布 vN+1） ---
#
# 对局期间子 Agent 不持有活跃 MCP 连接（driver 全流程接管）；复盘阶段才
# 临时建立独立连接（不复用模块级 _client 对局连接），读完全部回放即断开
# （close 异常忽略——与 mcp_client.close 幂等容错一致）。拉取/摘要逻辑
# 全部确定性，LLM 只消费返回的紧凑摘要做策略分析，然后调 publish_version
# 发布新版本脚本。


def _rules_dir() -> Path:
    """定位 gameagent/rules/ 版本脚本目录（不存在则创建）。"""
    here = Path(__file__).resolve()
    # src/darkforest → src → darkforest(skill) → skills → gameagent
    gameagent_root = here.parents[4]
    rules = gameagent_root / "rules"
    rules.mkdir(parents=True, exist_ok=True)
    return rules


def _fmt_action(action: dict[str, Any]) -> str:
    """动作记录 → 紧凑可读描述（data 卡 uid 等噪音保留但截断）。"""
    name = str(action.get("action", ""))
    data = action.get("data")
    if not data:
        return name
    compact = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(compact) > 120:
        compact = compact[:117] + "..."
    return f"{name}({compact})"


def _compact_players(ov: dict[str, Any]) -> list[dict[str, Any]]:
    """全知视角玩家列表 → 复盘摘要（手牌只留卡名）。"""
    out: list[dict[str, Any]] = []
    for p in ov.get("players") or []:
        out.append(
            {
                "name": p.get("name", ""),
                "energy": p.get("energy", 0),
                "position": p.get("position", 0),
                "eliminated": p.get("eliminated", False),
                "elimination_reason": p.get("eliminationReason", ""),
                "hand": [c.get("name", "") for c in (p.get("hand") or [])],
                "face_up": [c.get("name", "") for c in (p.get("faceUpCards") or [])],
            }
        )
    return out


def _compact_turns(deltas_out: dict[str, Any]) -> list[dict[str, Any]]:
    """get_replay_deltas 输出 → 逐回合动作流摘要。"""
    out: list[dict[str, Any]] = []
    for d in deltas_out.get("deltas") or []:
        out.append(
            {
                "turn": d.get("turn", 0),
                "player": d.get("playerName", ""),
                "actions": [_fmt_action(a) for a in (d.get("actions") or [])],
            }
        )
    return out


def _compact_final_state(ov: dict[str, Any]) -> dict[str, Any]:
    """终局帧补充信息（飞行打击 / 毁星 / 星系效果）。"""
    return {
        "flying_strikes": [
            {
                "strike_name": s.get("strikeName", ""),
                "owner_name": s.get("ownerName", ""),
                "target_system": s.get("targetSystem", 0),
                "eta_turns": s.get("etaTurns", 0),
                "threat_level": s.get("threatLevel", ""),
                "explain": s.get("explain", ""),
            }
            for s in ov.get("flyingStrikes") or []
        ],
        "destroyed_stars": list(ov.get("destroyedStars") or []),
        "star_effects": [
            {
                "system_id": e.get("systemId", 0),
                "type": e.get("type", ""),
                "applied_at_turn": e.get("appliedAtTurn", 0),
                "duration": e.get("duration", 0),
            }
            for e in ov.get("starEffects") or []
        ],
    }


async def _review_one(client: DarkForestMCPClient, match_id: str) -> dict[str, Any]:
    """拉取单个回放并整理紧凑摘要。失败不抛，返回带 error 字段的摘要。"""
    replay_id = match_id
    try:
        # ① 探测本地是否已落库（driver 局终 fetch_and_save_replay 通常已落库）
        first = await client.call_tool(
            "get_replay_semantic_view", {"replayId": match_id, "turn": 0}
        )
        if not first.get("found"):
            # ② 未命中 → 拉取落库：先按能力令牌 replayId（driver match_id 语义），
            #    失败再按对局 ID matchId 兜底
            fetched = await client.call_tool(
                "fetch_shared_replay", {"replayId": match_id}
            )
            if not fetched.get("saved"):
                fetched = await client.call_tool(
                    "fetch_and_save_replay", {"matchId": match_id}
                )
            if not fetched.get("saved"):
                raise RuntimeError(
                    f"回放拉取失败: {fetched.get('message') or 'saved=false'}"
                )
            replay_id = str(fetched.get("replayId") or match_id)
            first = await client.call_tool(
                "get_replay_semantic_view", {"replayId": replay_id, "turn": 0}
            )
            if not first.get("found"):
                raise RuntimeError("回放落库后仍无法读取语义视图")

        ov0 = first.get("omniscientView") or {}
        # ③ 动作流 + 总回合数
        deltas_out = await client.call_tool(
            "get_replay_deltas", {"replayId": replay_id, "fromTurn": 1}
        )
        total_turns = int(deltas_out.get("totalTurns") or 0)
        # ④ 终局帧（totalTurns=0 时 turn=0 即终局帧，直接复用 ov0）
        last = await client.call_tool(
            "get_replay_semantic_view",
            {"replayId": replay_id, "turn": total_turns},
        )
        ov_last = last.get("omniscientView") or ov0

        return {
            "match_id": match_id,
            "replay_id": replay_id,
            "error": "",
            "game_mode": ov0.get("gameMode", "") or ov_last.get("gameMode", ""),
            "total_turns": total_turns,
            "winner": ov_last.get("winner", ""),
            "players": _compact_players(ov_last),
            "turns": _compact_turns(deltas_out),
            "final_state": _compact_final_state(ov_last),
        }
    except Exception as exc:  # noqa: BLE001  单局失败不扩散，由 LLM 决定跳过
        return {
            "match_id": match_id,
            "replay_id": replay_id,
            "error": f"{exc}",
            "game_mode": "",
            "total_turns": 0,
            "winner": "",
            "players": [],
            "turns": [],
            "final_state": {},
        }


async def review_cycle(
    script_name: str,
    match_ids: list[str],
    agent_name: str = "",
    mcp_url: str = "",
) -> dict[str, Any]:
    """复盘：临时 MCP 连接读回放 → 紧凑摘要（供 LLM 分析）。

    临时建立**独立** MCP 连接（不复用模块级对局连接，对局期间子 Agent 无
    活跃连接；复盘读完即断、断开异常忽略）。对每个 match_id：本地已有回放
    直接读；未落库则先拉取再读。整理为紧凑摘要返回，单局失败不抛异常
    （该局摘要带 ``error`` 字段）。

    ``agent_name`` 是复盘期临时借用的账户 sid（trust 模式账池已播种的名字）；
    缺省取最近一次 ``connect`` 使用的名字（子 Agent 实际连过的，必在播种名单
    内），兜底 "reviewer"。``ensure_connected`` 失败不致命——本地已有回放时
    不需要游戏连接，仅需要拉取回放的局会带 error。

    返回 ``{script_name, match_ids, replay_summaries, connected}``：
    ``replay_summaries`` 每项含 match_id / replay_id / game_mode /
    total_turns / winner / players（终局手牌/位置/淘汰）/ turns（逐回合动作流）/
    final_state（飞行打击/毁星/星系效果）。
    """
    url = mcp_url or os.environ.get("MCP_URL", _DEFAULT_MCP_URL)
    agent = agent_name or _last_agent_name or "reviewer"
    client = DarkForestMCPClient(url, agent)
    connected = False
    summaries: list[dict[str, Any]] = []
    try:
        await client.connect()
        try:
            await client.call_tool("ensure_connected")
            connected = True
        except Exception:  # noqa: BLE001  本地回放可读；需拉取的局会带 error
            connected = False
        for mid in match_ids:
            summaries.append(await _review_one(client, mid))
    finally:
        try:
            await client.close()
        except Exception:  # noqa: BLE001  断开即目的，异常忽略（幂等容错）
            pass
    return {
        "script_name": script_name,
        "match_ids": match_ids,
        "replay_summaries": summaries,
        "connected": connected,
    }


def _next_version(current: str) -> str:
    """版本号递增：'' → v1，vN → vN+1。非 vN 形态一律回退 v1。"""
    if not current:
        return "v1"
    m = re.fullmatch(r"v(\d+)", current)
    if m is None:
        return "v1"
    return f"v{int(m.group(1)) + 1}"


def publish_version(
    script_name: str,
    code: str,
    stats: dict[str, Any] | None = None,
    notes: str = "",
) -> dict[str, Any]:
    """发布脚本新版本：写 ``rules/<script_name>/vN+1.py`` 并更新 manifest.json。

    确定性操作（LLM 不手算版本号、不手写 JSON）：版本号从 manifest 的
    ``current`` 自动递增（无 manifest 或坏 manifest → v1）。``stats`` 记录进
    manifest ``history[version].stats``（如 batch_end 的
    ``{games, wins, losses, draws}`` 胜率记录），``notes`` 为版本变更说明。
    返回 ``{ok, version, script_path, manifest_path}``。
    """
    dir_ = _rules_dir() / script_name
    dir_.mkdir(parents=True, exist_ok=True)
    manifest_path = dir_ / "manifest.json"
    manifest: dict[str, Any] = {
        "name": script_name,
        "versions": [],
        "current": "",
        "history": {},
    }
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            manifest = {"name": script_name, "versions": [], "current": "", "history": {}}

    version = _next_version(str(manifest.get("current") or ""))
    script_path = dir_ / f"{version}.py"
    script_path.write_text(code, encoding="utf-8")

    versions = list(manifest.get("versions") or [])
    if version not in versions:
        versions.append(version)
    history = dict(manifest.get("history") or {})
    history[version] = {
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "stats": stats or {},
        "notes": notes,
    }
    manifest.update({"versions": versions, "current": version, "history": history})
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {
        "ok": True,
        "version": version,
        "script_path": str(script_path),
        "manifest_path": str(manifest_path),
    }
