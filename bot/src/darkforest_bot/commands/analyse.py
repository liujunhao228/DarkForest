""".analyse 命令：对本地回放执行《三体》星际战争复盘分析，在触发处回传报告。

用法::

    .analyse [replayId]

- 无参数：使用该 QQ 最近一场已结算对局的回放 ID（由 GameSessionStore 记录）。
- 命令受理后先**即时**回传一条等待提示（LLM 分析耗时较长），再启动分析，避免 QQ 侧长时间静默。
- 回传位置与触发位置一致：私聊触发 → 私聊回复；群聊触发（需@机器人）→ 群聊回复。
- 分析不要求进行中对局：不查 IN_GAME 状态（回放分析是离线任务）。
- subprocess 调用 ``analyser`` CLI（analyser/ 独立包的 console script，
  内部经 mcpserver Streamable HTTP 拉取回放全知视角并由 CrewAI 编排 LLM），
  ``--mcp-url`` 指向 mcpserver 的 MCP 端点（settings.analyse_mcp_url）。
- 本地未命中回放（stderr 含「未在本地找到」）→ 提示先保存/拉取回放；
  其他失败 → 提示「分析失败」+ stderr 摘要。
- 成功 → 回传 markdown 报告（含「复盘报告」「策略评估」两节）；
  回传前经 ``_clean_analyser_stdout`` 剥离 CrewAI 的 Rich 控制台噪声
  （Flow 面板 / ANSI 转义），确保只展示报告本身；超长报告按段落拆分为
  多条消息（每条 <= 4000 字符）。

subprocess 超时由 settings.analyse_timeout 控制（默认 600s；一次分析含 3
阶段并行 + 汇总共多次 LLM 调用，预留充足时间），超时后杀进程并提示。
analyser 二进制路径经 settings.analyse_bin 配置，默认取 PATH 中的 ``analyser``。

设计上下文：docs/designs/2026-08-08-replay-analysis-agent-design.md
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import (
    Bot,
    GroupMessageEvent,
    Message,
    MessageEvent,
)
from nonebot.params import CommandArg

from darkforest_bot.rules.at_mention import require_at_in_group
from darkforest_bot.state import get_game_session_store, get_settings

if TYPE_CHECKING:
    from darkforest_bot.backend.game_session import GameSessionStore
    from darkforest_bot.config import Settings

# nonebot2 command registration.
# 群聊需@机器人才响应（require_at_in_group 规则）；私聊放行。
# 可通过 GROUP_REQUIRE_AT_MENTION=false 全局关闭回退到旧行为。
analyse_cmd = on_command("analyse", rule=require_at_in_group(), priority=10, block=True)

# 单条消息最大长度（超出按段落拆分，群聊/私聊通用）。
MAX_MESSAGE_LEN: int = 4000

# 命令受理后即时回传的等待提示模板（LLM 分析耗时较长，先安抚用户）。
_ACKNOWLEDGE_TEMPLATE: str = (
    "正在分析回放 {replay_id}，LLM 分析耗时较长，请耐心等待，"
    "完成后将回传复盘报告"
)

# stderr 命中这些标记时判定「本地回放未命中」。
# 对齐 mcpserver tools 的未命中错误文案（"未在本地找到"）。
_REPLAY_NOT_FOUND_MARKERS: tuple[str, ...] = ("未在本地找到",)

# 错误摘要截断长度。
_STDERR_SUMMARY_LIMIT: int = 200

# CrewAI Rich 面板框线字符（分析器源头已 suppress_flow_events 关闭，此处为
# 防御性清理：覆盖残余噪声或未来兼容性变化）。
_ANSI_ESC_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
# 面板顶边栏（┌…）、底边收尾（└…/┘…）与内部竖线内容行。
# startswith 需要字符元组（单个字符可有多个变体）。
_PANEL_START_CHARS = ("┌",)
_PANEL_END_CHARS = ("└", "┘")
_PANEL_SIDE_CHARS = ("│", "├", "┤", "┬", "┴")


@dataclass(frozen=True)
class AnalyserResult:
    """analyser CLI 子进程运行结果。"""

    returncode: int
    stdout: str = ""
    stderr: str = ""


@analyse_cmd.handle()
async def _handle_analyse_cmd(
    bot: Bot,
    event: MessageEvent,
    args: Message = CommandArg(),  # noqa: B008 - nonebot2 DI pattern
) -> None:
    """nonebot2 handler — extracts event data and delegates to core logic."""
    if isinstance(event, GroupMessageEvent):
        is_group = True
        group_id: int = event.group_id
    else:
        is_group = False
        group_id = 0
    await handle_analyse_request(
        bot=bot,
        user_id=int(event.get_user_id()),
        is_group=is_group,
        group_id=group_id,
        raw_args=args.extract_plain_text().strip(),
        settings=get_settings(),
        game_session_store=get_game_session_store(),
    )


async def handle_analyse_request(
    bot: Any,
    user_id: int,
    raw_args: str,
    settings: Settings,
    game_session_store: GameSessionStore,
    is_group: bool = False,
    group_id: int = 0,
) -> None:
    """Core .analyse command logic — extracted for testability.

    Args:
        bot: nonebot Bot instance (or mock with call_api in tests).
        user_id: QQ number of the user who issued the command.
        raw_args: Raw argument string after ".analyse" (whitespace-stripped).
        settings: Application settings (analyse_mcp_url / analyse_bin).
        game_session_store: GameSessionStore for the last settled replay lookup.
        is_group: Whether the command was issued in a group (vs private).
        group_id: Group ID if is_group, else 0 (ignored for private replies).
    """
    qq = user_id

    replay_id = _resolve_replay_id(raw_args, game_session_store, qq)
    if replay_id is None:
        await _send(bot, is_group, group_id, qq, "请指定回放ID，例如：.analyse <回放ID>")
        return

    await _send(bot, is_group, group_id, qq, _ACKNOWLEDGE_TEMPLATE.format(replay_id=replay_id))

    result = await run_analyser(replay_id, settings)
    report = _clean_analyser_stdout(result.stdout)

    if result.returncode != 0 or not report.strip():
        if any(
            marker in result.stderr for marker in _REPLAY_NOT_FOUND_MARKERS
        ):
            await _send(
                bot, is_group, group_id, qq,
                "回放未在本地找到，请先保存（如经 mcpserver 拉取）后重试",
            )
        else:
            summary = result.stderr.strip() or f"退出码 {result.returncode}"
            await _send(
                bot, is_group, group_id, qq, f"分析失败：{_extract_error_summary(summary)}"
            )
        return

    for chunk in _chunk_markdown(report, max_len=MAX_MESSAGE_LEN):
        await _send(bot, is_group, group_id, qq, chunk)


def _resolve_replay_id(
    raw_args: str,
    game_session_store: GameSessionStore,
    qq: int,
) -> str | None:
    """解析 .analyse 参数；缺省时退回该 QQ 最近结算对局的回放 ID。"""
    tokens = raw_args.split()
    if tokens:
        return tokens[0]
    return game_session_store.last_replay_id(qq)


async def run_analyser(replay_id: str, settings: Settings) -> AnalyserResult:
    """subprocess 调用 analyser CLI，捕获 stdout/stderr，超时后杀进程。

    命令形如：``analyser <replayId> --mcp-url <url>``。
    超时取自 ``settings.analyse_timeout``（默认 600s）。
    工作目录取 ``settings.analyse_cwd``（analyser 的 Settings 相对 cwd 读
    ``.env`` 里的 LLM 配置，必须指向 analyser 包根目录；空则继承 bot cwd）。
    """
    cmd = [settings.analyse_bin, replay_id, "--mcp-url", settings.analyse_mcp_url]
    cwd = settings.analyse_cwd or None
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
    except FileNotFoundError:
        logger.warning("analyser binary not found", cmd=cmd)
        return AnalyserResult(
            returncode=-1,
            stderr=f"找不到 analyser 可执行文件：{settings.analyse_bin}",
        )

    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(), timeout=settings.analyse_timeout
        )
    except TimeoutError:
        proc.kill()
        await proc.communicate()
        logger.warning(
            "analyser timed out, killed",
            replay_id=replay_id,
            timeout=settings.analyse_timeout,
        )
        return AnalyserResult(
            returncode=-1,
            stderr=f"分析超时（>{int(settings.analyse_timeout)}s）",
        )

    stdout = stdout_b.decode("utf-8", errors="replace") if stdout_b else ""
    stderr = stderr_b.decode("utf-8", errors="replace") if stderr_b else ""
    return AnalyserResult(
        returncode=proc.returncode or 0, stdout=stdout, stderr=stderr
    )


def _clean_analyser_stdout(stdout: str) -> str:
    """剥离 analyser stdout 中的 CrewAI 控制台噪声，只留报告正文。

    CrewAI 会无条件向 stdout 打印 Flow 面板（``┌─🌊 Flow Execution─┐``
    ``│ ... │`` ``└────────┘``）与 ANSI 转义。这里按**面板几何结构**剥离：
    以 ``┌`` 起始入块、以 ``└``/``┘`` 收尾出块，块内列框线内容行全部丢弃；
    **不依赖任何 LLM 内容标记**（「复盘报告」等标题可能因 LLM 输出不稳定而
    缺失/变形），只认边框字符。面板中途被截断（未闭合）时保留后续行，
    避免误吞真实报告。

    Args:
        stdout: analyser CLI 的原始 stdout。
    Returns:
        清理后的纯净报告文本（空白已折叠，首尾 trim）。
    """
    text = _ANSI_ESC_RE.sub("", stdout)
    clean: list[str] = []
    in_panel = False
    for line in text.splitlines():
        s = line.lstrip()
        if in_panel:
            if s.startswith(_PANEL_START_CHARS):
                continue  # 未闭合块内再次出现的顶边：归为延续块
            if s.startswith(_PANEL_END_CHARS):
                in_panel = False
                continue  # 底边收尾，块结束
            if not s or s.startswith(_PANEL_SIDE_CHARS):
                continue  # 块内空白/内容边线
            in_panel = False  # 面板意外中断，保留本行
            clean.append(line)
            continue
        if s.startswith(_PANEL_START_CHARS):
            in_panel = True
            continue  # 顶边入块
        clean.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(clean)).strip()


def _chunk_markdown(text: str, max_len: int = MAX_MESSAGE_LEN) -> list[str]:
    """把长文本按段落切分为 <= max_len 的块。

    优先按段落（``\\n\\n``）贪心合并；单段落仍超长时按行切；单行仍超长时
    硬切。空文本返回 ``[""]`` 单块，保证消息不丢失。
    """
    if not text:
        return [""]
    if len(text) <= max_len:
        return [text]

    chunks: list[str] = []
    current = ""
    for paragraph in text.split("\n\n"):
        candidate = paragraph if not current else f"{current}\n\n{paragraph}"
        if len(candidate) <= max_len:
            current = candidate
            continue
        if current:
            chunks.append(current)
            current = ""
        # 单段落超长：按行贪心合并。
        for line in paragraph.split("\n"):
            candidate = line if not current else f"{current}\n{line}"
            if len(candidate) <= max_len:
                current = candidate
                continue
            if current:
                chunks.append(current)
            # 单行仍超长：硬切。
            current = line
            while len(current) > max_len:
                chunks.append(current[:max_len])
                current = current[max_len:]
    if current:
        chunks.append(current)
    return chunks


# 匹配 crewai / 第三方库的 warning 块首行（``路径:行号: WarningType: ...``）。
_WARNING_HEAD_RE = re.compile(
    r":\s*\d+:\s*(?:User|Deprecation|Future|Syntax|PendingDeprecation)Warning\b"
)


def _extract_error_summary(
    text: str, limit: int = _STDERR_SUMMARY_LIMIT
) -> str:
    """从 analyser stderr 提取真正的错误摘要。

    crewai 会在 stderr 打大量 UserWarning（模块导入期的 ``state`` 字段
    告警等）与第三方噪音，真实错误（traceback / 异常）在其后。策略：
    1. 丢弃 warning 块：首行命中 ``路径:行号: Warning:`` 的行与其后续
       缩进上下文行一并丢弃。
    2. 从剩余行取**尾部** ``limit`` 字符（traceback 的最终异常在结尾）；
       若全被过滤，退回原始 stderr 尾部。
    """
    lines = text.splitlines()
    keep: list[str] = []
    in_warning_block = False
    for line in lines:
        if _WARNING_HEAD_RE.search(line):
            in_warning_block = True
            continue
        if in_warning_block and (not line.strip() or line.startswith((" ", "\t"))):
            continue
        in_warning_block = False
        keep.append(line)

    cleaned = "\n".join(keep).strip() or text.strip()
    if len(cleaned) <= limit:
        return cleaned
    return "…" + cleaned[-limit:]


async def _send(
    bot: Any, is_group: bool, group_id: int, user_id: int, message: Any
) -> None:
    """Reply in the same channel as the trigger (group or private).

    Failures are logged but not raised.
    Group 回复带 group_id；私聊仅带 user_id。
    """
    try:
        if is_group:
            await bot.call_api("send_group_msg", group_id=group_id, message=message)
        else:
            await bot.call_api("send_private_msg", user_id=user_id, message=message)
    except Exception:  # noqa: BLE001 - best-effort reply
        logger.warning(
            "Failed to send reply",
            is_group=is_group,
            user_id=user_id,
            group_id=group_id,
        )
