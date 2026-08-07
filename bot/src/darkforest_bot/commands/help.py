""".help command handler.

Usage: 无状态命令总览，支持文本与图片两种输出。

两种模式：
- 无参数：按当前会话阶段（IDLE/MATCHMAKING/IN_ROOM/IN_GAME）展示全部命令
  总览，当前阶段可用命令置顶并标注，其余命令列在后面。
- .help <命令名>：返回该命令的详细用法字符串。

图片输出：
- .help img：将命令总览（Markdown 排版）渲染为 PNG 图片。
- .help img <命令名>：将该命令详情渲染为 PNG 图片。
  图片由 render/markdown_image.py 的自研极简 Markdown 渲染器生成，复用
  render/starmap.py 的中文字体加载与深色主题风格。

.help 自身可在任何状态下使用，不要求 IN_GAME；文本模式不读 backend，仅图片
模式需要字体路径（来自 load_settings().render_font_path）。
详情文本硬编码在本模块（更稳、可测、可控），不动态抓取各命令 docstring。
.announce 是内部命令（strike.py 中注册但不对外公开），故不列入总览。
"""

from __future__ import annotations

import base64
from typing import TYPE_CHECKING, Any

from loguru import logger
from nonebot import on_command
from nonebot.adapters.onebot.v11 import (
    Bot,
    GroupMessageEvent,
    Message,
    MessageEvent,
    MessageSegment,
)
from nonebot.params import CommandArg

from darkforest_bot.config import load_settings
from darkforest_bot.render.markdown_image import render_markdown
from darkforest_bot.session.states import SessionState
from darkforest_bot.state import get_session_manager

if TYPE_CHECKING:
    from darkforest_bot.session.manager import SessionManager

# 命令总览：类别 → [(命令名, 用法, 一句话说明)]。
# .help 自身不在此列（隐藏命令），仅在 COMMAND_DETAILS 中提供详情。
# .announce 为内部命令，亦不列入总览。
HELP_OVERVIEW: dict[str, list[tuple[str, str, str]]] = {
    "基础/匹配": [
        ("match", ".match [人数] [模式]", "加入匹配队列（群聊）"),
        ("cancel", ".cancel", "取消匹配"),
        ("state", ".state", "查看当前星图与手牌"),
        ("log", ".log [数量]", "查看最近日志"),
    ],
    "对局内指令": [
        ("play", ".play <手牌序号>", "出牌"),
        ("deploy", ".deploy <手牌序号>", "部署卡牌"),
        ("recycle", ".recycle <手牌序号>", "回收手牌"),
        ("strike", ".strike <手牌序号> <星系> [玩家名]", "发起打击"),
        ("broadcast", ".broadcast <手牌序号> <星系>", "发起广播"),
        ("jump", ".jump <星系> [携带能量] [消息]", "跃迁"),
        ("end", ".end [priv] [手牌序号...]", "结束回合"),
        ("exit", ".exit", "弃权退出当前对局（自己被淘汰）"),
    ],
    "广播响应": [
        ("agree", ".agree <手牌序号>", "同意广播"),
        ("refuse", ".refuse", "拒绝广播"),
        ("select", ".select <玩家名>", "选择广播响应者"),
        ("bcancel", ".bcancel", "取消自己发起的广播"),
    ],
    "打击生命周期": [
        ("move", ".move <打击序号> <星系>", "移动打击"),
        ("pick", ".pick <打击序号>", "选择待处理打击"),
        ("retarget", ".retarget <打击序号> <星系>", "重新指定打击目标"),
        ("discard", ".discard <打击序号>", "丢弃落空的打击"),
        ("skip", ".skip", "跳过当前待处理操作"),
    ],
}

# 单命令详细用法：命令名 → 详细说明字符串。
# 复用各命令 docstring 的用法；.help 自身亦提供详情。
COMMAND_DETAILS: dict[str, str] = {
    "match": (
        ".match [人数] [模式]\n"
        "  加入匹配队列。\n"
        "  人数：3-5（默认 4）；模式：classic / civilization_relics（默认 classic）。\n"
        "  仅在群聊使用。匹配成功后所有玩家收到私信通知。"
    ),
    "cancel": (
        ".cancel\n"
        "  取消匹配队列。\n"
        "  仅在 MATCHMAKING 状态可用。对局中离开房间请使用其他命令。"
    ),
    "state": (
        ".state\n"
        "  查看当前星图与手牌。\n"
        "  发送缓存的 ViewState 渲染为星图 PNG + 文字摘要到私信。\n"
        "  缓存为空时会请求 backend 全量同步后再渲染。"
    ),
    "log": (
        ".log [数量]\n"
        "  查看最近 N 条日志（默认 10，上限 50）。\n"
        "  日志来源于本地缓存的 ViewState，需要先 .state 加载缓存。"
    ),
    "play": (
        ".play <手牌序号>\n"
        "  出牌（playCard）。\n"
        "  手牌序号为 1-based，可在 .state 输出中查看。"
    ),
    "deploy": (
        ".deploy <手牌序号>\n"
        "  部署卡牌（deployCard）。\n"
        "  手牌序号为 1-based。"
    ),
    "recycle": (
        ".recycle <手牌序号>\n"
        "  回收手牌（recycleCard）。\n"
        "  手牌序号为 1-based。"
    ),
    "strike": (
        ".strike <手牌序号> <星系> [玩家名]\n"
        "  发起打击。\n"
        "  手牌序号 1-based；星系为星图编号；玩家名可选，用于多目标场景。"
    ),
    "broadcast": (
        ".broadcast <手牌序号> <星系>\n"
        "  发起广播。\n"
        "  手牌序号 1-based；星系为广播目标编号。"
    ),
    "jump": (
        ".jump <星系> [携带能量] [消息]\n"
        "  跃迁到目标星系（lightspeedShip）。\n"
        "  携带能量为非负整数；消息为剩余文本。\n"
        "  例：.jump 5、.jump 5 3、.jump 5 3 hello world"
    ),
    "end": (
        ".end [priv] [手牌序号...]\n"
        "  结束回合，可弃手牌。\n"
        "  priv：私密弃牌（默认公开）。\n"
        "  例：.end、.end 1 3、.end priv 1 3"
    ),
    "exit": (
        ".exit\n"
        "  弃权退出当前对局，自己被淘汰。\n"
        "  手牌/设施/飞行中打击全部入弃牌堆，不奖励其他玩家能量。\n"
        "  当前玩家弃权时回合推进到下一玩家；仅剩一名存活玩家时其获胜。"
    ),
    "agree": (
        ".agree <手牌序号>\n"
        "  同意当前广播。\n"
        "  手牌序号为你用于回应的广播牌（type=broadcast）1-based 序号；"
        "  未指定回应卡时后端会静默忽略同意。"
    ),
    "refuse": (
        ".refuse\n"
        "  拒绝当前广播。无参数。"
    ),
    "select": (
        ".select <玩家名>\n"
        "  在广播 select 阶段选择响应者。"
    ),
    "bcancel": (
        ".bcancel\n"
        "  取消自己发起的广播。\n"
        "  命名独立于 .cancel 以避免与取消匹配冲突。"
    ),
    "move": (
        ".move <打击序号> <星系>\n"
        "  strikeMove 阶段移动打击到目标星系。\n"
        "  打击序号为 1-based，对应场上飞行中的打击。"
    ),
    "pick": (
        ".pick <打击序号>\n"
        "  strikeSelect 阶段从待处理列表中选择一个打击。\n"
        "  序号是针对 PendingAction.strike_uids 列表的 1-based 索引。"
    ),
    "retarget": (
        ".retarget <打击序号> <星系>\n"
        "  重新指定打击目标。\n"
        "  上下文敏感：strikeMove 阶段派发 retargetStrike；\n"
        "  strikeMissedFree / strikeMissedRequireTarget 阶段派发 retargetMissedStrike。"
    ),
    "discard": (
        ".discard <打击序号>\n"
        "  strikeMissedFree 阶段丢弃落空的打击。\n"
        "  打击序号为 1-based。"
    ),
    "skip": (
        ".skip\n"
        "  跳过当前待处理操作。\n"
        "  上下文敏感：根据 PendingAction.type 派发不同 backend action\n"
        "  （strikeSelect / strikeMove / announceStrike / strikeMissedFree）。"
    ),
    "help": (
        ".help [命令名] / .help img [命令名]\n"
        "  无参数：按当前会话阶段展示全部命令总览，当前可用命令置顶并标注。\n"
        "  有参数：查看该命令的详细用法。\n"
        "  img：将总览或命令详情渲染为图片（Markdown 排版）。\n"
        "  例：.help、.help strike、.help img、.help img jump"
    ),
}

# 各状态对应的"当前可用"类别（按置顶顺序排列）。未列出的类别归入"其他命令"。
_STATE_PRIORITY_CATEGORIES: dict[SessionState, list[str]] = {
    SessionState.IDLE: ["基础/匹配"],
    SessionState.MATCHMAKING: ["基础/匹配"],
    SessionState.IN_ROOM: ["基础/匹配"],
    SessionState.IN_GAME: ["对局内指令", "广播响应", "打击生命周期"],
}

# 阶段中文标签（用于总览头部）。
_STATE_LABEL: dict[SessionState, str] = {
    SessionState.IDLE: "空闲",
    SessionState.MATCHMAKING: "匹配中",
    SessionState.IN_ROOM: "房间内",
    SessionState.IN_GAME: "对局中",
}

# 图片模式参数：.help img / .help img <命令名>。首个 token（不区分大小写）
# 等于此值即进入图片模式。
_IMAGE_FLAG = "img"

# 帮助图片输出宽度（像素），兼顾移动端聊天可读性与图片体积。
_IMAGE_WIDTH = 760

# nonebot2 command registration.
# Note: no to_me() rule — users invoke by typing ".help" directly. Works in
# both group and private message contexts; reply target follows the caller.
help_cmd = on_command("help", priority=10, block=True)


@help_cmd.handle()
async def _handle_help_cmd(
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
    await handle_help_request(
        bot=bot,
        user_id=event.user_id,
        is_group=is_group,
        group_id=group_id,
        raw_args=args.extract_plain_text().strip(),
        session_manager=get_session_manager(),
    )


async def handle_help_request(
    bot: Any,
    user_id: int,
    is_group: bool,
    group_id: int,
    raw_args: str,
    session_manager: SessionManager,
) -> None:
    """Core .help command logic — extracted for testability.

    Args:
        bot: nonebot Bot instance (or mock with call_api in tests).
        user_id: QQ number of the user who issued the command.
        is_group: Whether the command was issued in a group (vs private).
        group_id: Group ID if is_group, else 0 (ignored for private replies).
        raw_args: Raw argument string after ".help". Expected forms:
            empty / a command name (optionally with a leading ".") / an ``img``
            flag (optionally followed by a command name).
        session_manager: SessionManager for state machine lookup (only used
            in overview mode to determine current phase).
    """
    qq = user_id
    image_mode, arg = _parse_help_args(raw_args)

    if arg:
        # 单命令详情模式
        detail = COMMAND_DETAILS.get(arg)
        if detail is None:
            # 错误提示不渲染成图，保持纯文本
            text = f"未找到命令：.{arg}\n输入 .help 查看全部命令总览"
            await _reply(bot, is_group, group_id, qq, text)
            return
        if image_mode:
            await _reply_image(bot, is_group, group_id, qq, _build_detail_markdown(arg, detail))
            return
        await _reply(bot, is_group, group_id, qq, detail)
        return

    # 总览模式 — 读取当前会话状态（短暂持锁快照后即释放）
    async with session_manager.acquire(qq):
        session = session_manager.get_or_create(qq)
        state = session.state

    if image_mode:
        await _reply_image(bot, is_group, group_id, qq, _build_overview_markdown(state))
        return
    text = _build_overview(state)
    await _reply(bot, is_group, group_id, qq, text)


def _overview_sections(state: SessionState) -> tuple[list[str], list[str]]:
    """按会话阶段拆分类别为（当前可用类别, 其他类别）。

    同时供文本总览 ``_build_overview`` 与图片 Markdown 总览
    ``_build_overview_markdown`` 使用，保证两种输出数据一致。
    """
    priority_categories = _STATE_PRIORITY_CATEGORIES.get(state, [])
    other_categories = [c for c in HELP_OVERVIEW if c not in priority_categories]
    return priority_categories, other_categories


def _build_overview(state: SessionState) -> str:
    """按阶段分组 + 当前阶段置顶，构建总览文本。

    Args:
        state: 当前会话状态，决定哪些类别置顶。

    Returns:
        多行字符串：头部标注当前阶段；【当前可用】区块列出该阶段相关命令；
        【其他命令】区块列出其余命令；末尾附 .help <命令> 提示。
    """
    label = _STATE_LABEL.get(state, state.value)
    priority_categories, other_categories = _overview_sections(state)

    lines: list[str] = [
        f"当前阶段：{label}（{state.value}）",
        "命令总览：",
        "",
        "【当前可用】",
    ]
    for cat in priority_categories:
        lines.append(f"  {cat}:")
        for _name, usage, desc in HELP_OVERVIEW.get(cat, []):
            lines.append(f"    {usage}  —  {desc}")

    if other_categories:
        lines.append("")
        lines.append("【其他命令】")
        for cat in other_categories:
            lines.append(f"  {cat}:")
            for _name, usage, desc in HELP_OVERVIEW.get(cat, []):
                lines.append(f"    {usage}  —  {desc}")

    lines.append("")
    lines.append("提示：.help <命令> 查看单条命令详细用法（如 .help strike）")
    return "\n".join(lines)


def _build_overview_markdown(state: SessionState) -> str:
    """构建总览的 Markdown 文档（供图片模式渲染）。

    数据源与 ``_build_overview`` 完全一致（HELP_OVERVIEW / 阶段分类），仅换用
    Markdown 排版，供 render/markdown_image.py 渲染为图片。
    """
    label = _STATE_LABEL.get(state, state.value)
    priority_categories, other_categories = _overview_sections(state)

    lines: list[str] = [
        "# 黑暗森林 · 命令总览",
        "",
        f"当前阶段：**{label}**（`{state.value}`）",
        "",
        "## 当前可用",
    ]
    for cat in priority_categories:
        lines.append(f"### {cat}")
        for _name, usage, desc in HELP_OVERVIEW.get(cat, []):
            lines.append(f"- `{usage}` — {desc}")

    if other_categories:
        lines.append("")
        lines.append("## 其他命令")
        for cat in other_categories:
            lines.append(f"### {cat}")
            for _name, usage, desc in HELP_OVERVIEW.get(cat, []):
                lines.append(f"- `{usage}` — {desc}")

    lines.append("")
    lines.append("提示：`.help img <命令>` 查看单条命令详细用法图片（如 `.help img strike`）")
    return "\n".join(lines)


def _build_detail_markdown(command_name: str, detail: str) -> str:
    """把单命令详情文本转换为 Markdown 文档。

    首行用法 → ``### `用法` `` 小节标题；其余缩进行去缩进后作为段落。
    """
    text_lines = detail.split("\n")
    usage = text_lines[0].strip()
    body = [ln.strip() for ln in text_lines[1:] if ln.strip()]
    md: list[str] = [f"# {command_name}", "", f"`{usage}`"]
    if body:
        md.append("")
        md.extend(body)
    return "\n".join(md)


def _normalize_command_arg(raw_args: str) -> str:
    """规范化命令名参数：去除前导 "." 与首尾空白。

    兼容用户输入 ".help strike" 和 ".help .strike" 两种形式。
    """
    stripped = raw_args.strip()
    if stripped.startswith("."):
        stripped = stripped[1:]
    return stripped


def _parse_help_args(raw_args: str) -> tuple[bool, str]:
    """解析 .help 参数为 (图片模式, 命令名参数)。

    首个 token（不区分大小写）为 ``img`` 时进入图片模式，其余 token 重新拼接
    后作为命令名参数（兼容 ``.help img .strike``）。否则整个参数字符串作为
    命令名参数（维持既有文本模式）。
    """
    tokens = raw_args.strip().split()
    if tokens and tokens[0].lower() == _IMAGE_FLAG:
        return True, _normalize_command_arg(" ".join(tokens[1:]))
    return False, _normalize_command_arg(raw_args)


async def _reply(
    bot: Any,
    is_group: bool,
    group_id: int,
    user_id: int,
    message: str,
) -> None:
    """以纯文本回复（群聊或私聊）。"""
    await _send(bot, is_group, group_id, user_id, message)


async def _reply_image(
    bot: Any,
    is_group: bool,
    group_id: int,
    user_id: int,
    markdown_text: str,
) -> None:
    """将 Markdown 渲染为 PNG 图片并回复（群聊或私聊）。

    渲染或发送异常时降级为纯文本，确保信息不丢失；失败仅记日志不抛出。
    """
    try:
        png = render_markdown(
            markdown_text,
            width=_IMAGE_WIDTH,
            font_path=load_settings().render_font_path,
        )
        b64 = base64.b64encode(png).decode("ascii")
        message = Message([MessageSegment.image(f"base64://{b64}")])
        await _send(bot, is_group, group_id, user_id, message)
    except Exception:  # noqa: BLE001 — best-effort reply, fall back to text
        logger.warning(
            "Failed to render/send help image, falling back to text",
            is_group=is_group,
            user_id=user_id,
        )
        await _send(bot, is_group, group_id, user_id, markdown_text)


async def _send(
    bot: Any,
    is_group: bool,
    group_id: int,
    user_id: int,
    message: str | Message,
) -> None:
    """回复（群聊或私聊），失败仅记日志不抛出。

    Group 回复带 group_id；私聊仅带 user_id。
    """
    try:
        if is_group:
            await bot.call_api("send_group_msg", group_id=group_id, message=message)
        else:
            await bot.call_api("send_private_msg", user_id=user_id, message=message)
    except Exception:  # noqa: BLE001 - best-effort reply
        logger.warning("Failed to send reply", is_group=is_group, user_id=user_id)
