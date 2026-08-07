"""Tests for commands/help.py.

Tests cover:
- 无参数返回总览（含基础命令文本，如 .match / .cancel / .state / .log）
- 子命令返回该命令详细用法（如 .help strike 含"发起打击"）
- 未知子命令返回"未找到命令"
- 群聊目标 → send_group_msg；私聊 → send_private_msg
- 上下文高亮：IN_GAME 状态下对局内命令置顶（出现在"基础/匹配"之前）
- _normalize_command_arg 兼容带前导 "." 的输入（".strike" → "strike"）
- .help help 返回 .help 自身的详情
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

from darkforest_bot.commands.help import (
    COMMAND_DETAILS,
    HELP_OVERVIEW,
    _build_detail_markdown,
    _build_overview,
    _build_overview_markdown,
    _normalize_command_arg,
    _parse_help_args,
    handle_help_request,
)
from darkforest_bot.session.manager import SessionManager
from darkforest_bot.session.states import SessionState

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _set_state(mgr: SessionManager, qq: int, state: SessionState) -> None:
    """Helper: set session state directly for test setup.

    Bypasses the lock and transition validation — safe in single-threaded
    test setup where we need to force a specific starting state.
    """
    session = mgr.get_or_create(qq)
    session.state = state


def _group_calls(bot: AsyncMock) -> list[Any]:
    """Return all send_group_msg call_api invocations on the mock bot."""
    return [c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"]


def _private_calls(bot: AsyncMock) -> list[Any]:
    """Return all send_private_msg call_api invocations on the mock bot."""
    return [c for c in bot.call_api.call_args_list if c.args[0] == "send_private_msg"]


# ---------------------------------------------------------------------------
# Tests: overview (no args)
# ---------------------------------------------------------------------------


class TestOverview:
    async def test_overview_contains_basic_commands(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()
        # Session is IDLE by default — 基础/匹配 should be in priority block.

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="",
            session_manager=mgr,
        )

        calls = _private_calls(bot)
        assert len(calls) == 1
        msg = calls[0].kwargs["message"]
        # Header mentions current phase.
        assert "当前阶段" in msg
        # All four basic commands appear in the overview.
        assert ".match" in msg
        assert ".cancel" in msg
        assert ".state" in msg
        assert ".log" in msg
        # Footer hint for .help <命令>.
        assert ".help <命令>" in msg

    async def test_overview_state_label_idle(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()
        # Default IDLE.

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="",
            session_manager=mgr,
        )

        msg = _private_calls(bot)[0].kwargs["message"]
        assert "空闲" in msg
        assert "idle" in msg

    async def test_overview_all_commands_listed(self) -> None:
        """Every command in HELP_OVERVIEW appears in the rendered output."""
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="",
            session_manager=mgr,
        )

        msg = _private_calls(bot)[0].kwargs["message"]
        for _name, usage, _desc in (
            cmd for cat in HELP_OVERVIEW.values() for cmd in cat
        ):
            assert usage in msg, f"Missing usage in overview: {usage}"


# ---------------------------------------------------------------------------
# Tests: single-command detail
# ---------------------------------------------------------------------------


class TestCommandDetail:
    async def test_known_command_returns_detail(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="strike",
            session_manager=mgr,
        )

        calls = _private_calls(bot)
        assert len(calls) == 1
        msg = calls[0].kwargs["message"]
        # Strike detail string contains the docstring phrase.
        assert "发起打击" in msg
        # Should match COMMAND_DETAILS["strike"] verbatim.
        assert msg == COMMAND_DETAILS["strike"]

    async def test_known_command_with_leading_dot(self) -> None:
        """.help .strike normalizes to "strike" and returns detail."""
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args=".strike",
            session_manager=mgr,
        )

        msg = _private_calls(bot)[0].kwargs["message"]
        assert msg == COMMAND_DETAILS["strike"]

    async def test_help_self_returns_own_detail(self) -> None:
        """.help help returns .help's own detail string."""
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="help",
            session_manager=mgr,
        )

        msg = _private_calls(bot)[0].kwargs["message"]
        assert msg == COMMAND_DETAILS["help"]
        assert ".help [命令名]" in msg

    async def test_unknown_command_returns_not_found(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="nosuchcmd",
            session_manager=mgr,
        )

        calls = _private_calls(bot)
        assert len(calls) == 1
        msg = calls[0].kwargs["message"]
        assert "未找到命令" in msg
        assert ".nosuchcmd" in msg
        # Should also point user back to the overview.
        assert ".help" in msg

    async def test_detail_does_not_read_session_state(self) -> None:
        """Detail mode must not depend on session state — it works even when
        no session exists for the qq."""
        bot = AsyncMock()
        mgr = SessionManager()
        # Do NOT pre-create a session for this qq.

        await handle_help_request(
            bot=bot,
            user_id=99999,
            is_group=False,
            group_id=0,
            raw_args="jump",
            session_manager=mgr,
        )

        msg = _private_calls(bot)[0].kwargs["message"]
        assert msg == COMMAND_DETAILS["jump"]


# ---------------------------------------------------------------------------
# Tests: reply context (group vs private)
# ---------------------------------------------------------------------------


class TestReplyContext:
    async def test_group_context_uses_send_group_msg(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=True,
            group_id=10001,
            raw_args="",
            session_manager=mgr,
        )

        group_calls = _group_calls(bot)
        private_calls = _private_calls(bot)
        assert len(group_calls) == 1
        assert len(private_calls) == 0
        assert group_calls[0].kwargs["group_id"] == 10001
        assert ".match" in group_calls[0].kwargs["message"]

    async def test_private_context_uses_send_private_msg(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="",
            session_manager=mgr,
        )

        group_calls = _group_calls(bot)
        private_calls = _private_calls(bot)
        assert len(group_calls) == 0
        assert len(private_calls) == 1
        assert private_calls[0].kwargs["user_id"] == 12345

    async def test_group_context_with_detail(self) -> None:
        """Detail mode also respects group context."""
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=True,
            group_id=10001,
            raw_args="end",
            session_manager=mgr,
        )

        group_calls = _group_calls(bot)
        private_calls = _private_calls(bot)
        assert len(group_calls) == 1
        assert len(private_calls) == 0
        assert group_calls[0].kwargs["message"] == COMMAND_DETAILS["end"]


# ---------------------------------------------------------------------------
# Tests: context-aware highlighting (state → category ordering)
# ---------------------------------------------------------------------------


class TestContextHighlight:
    def test_idle_overview_places_basic_first(self) -> None:
        text = _build_overview(SessionState.IDLE)
        basic_idx = text.index("基础/匹配")
        in_game_idx = text.index("对局内指令")
        # 基础/匹配 should appear before 对局内指令 in IDLE.
        assert basic_idx < in_game_idx
        # Header label.
        assert "空闲" in text

    def test_matchmaking_overview_places_basic_first(self) -> None:
        text = _build_overview(SessionState.MATCHMAKING)
        basic_idx = text.index("基础/匹配")
        in_game_idx = text.index("对局内指令")
        assert basic_idx < in_game_idx
        assert "匹配中" in text

    def test_in_room_overview_places_basic_first(self) -> None:
        text = _build_overview(SessionState.IN_ROOM)
        basic_idx = text.index("基础/匹配")
        in_game_idx = text.index("对局内指令")
        assert basic_idx < in_game_idx
        assert "房间内" in text

    def test_in_game_overview_places_game_commands_first(self) -> None:
        """IN_GAME state flips the order: 对局内指令 before 基础/匹配."""
        text = _build_overview(SessionState.IN_GAME)
        in_game_idx = text.index("对局内指令")
        basic_idx = text.index("基础/匹配")
        assert in_game_idx < basic_idx
        assert "对局中" in text

    def test_in_game_overview_has_priority_and_other_sections(self) -> None:
        text = _build_overview(SessionState.IN_GAME)
        # Priority section header comes before the other section.
        priority_idx = text.index("【当前可用】")
        other_idx = text.index("【其他命令】")
        assert priority_idx < other_idx
        # 对局内指令 / 广播响应 / 打击生命周期 are all in priority.
        assert "对局内指令" in text[priority_idx:other_idx]
        assert "广播响应" in text[priority_idx:other_idx]
        assert "打击生命周期" in text[priority_idx:other_idx]
        # 基础/匹配 is in the other section.
        assert "基础/匹配" in text[other_idx:]

    async def test_in_game_handler_highlights_game_commands(self) -> None:
        """End-to-end: handler reads IN_GAME state and produces the
        highlighted overview with 对局内指令 before 基础/匹配."""
        bot = AsyncMock()
        mgr = SessionManager()
        _set_state(mgr, 12345, SessionState.IN_GAME)

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="",
            session_manager=mgr,
        )

        msg = _private_calls(bot)[0].kwargs["message"]
        assert msg.index("对局内指令") < msg.index("基础/匹配")
        assert "对局中" in msg
        assert "in-game" in msg

    async def test_idle_handler_highlights_basic_commands(self) -> None:
        """End-to-end: IDLE state keeps 基础/匹配 first."""
        bot = AsyncMock()
        mgr = SessionManager()
        # IDLE by default.

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="",
            session_manager=mgr,
        )

        msg = _private_calls(bot)[0].kwargs["message"]
        assert msg.index("基础/匹配") < msg.index("对局内指令")
        assert "空闲" in msg


# ---------------------------------------------------------------------------
# Tests: _normalize_command_arg helper
# ---------------------------------------------------------------------------


class TestNormalizeCommandArg:
    def test_empty_returns_empty(self) -> None:
        assert _normalize_command_arg("") == ""

    def test_whitespace_only_returns_empty(self) -> None:
        assert _normalize_command_arg("   ") == ""

    def test_bare_name(self) -> None:
        assert _normalize_command_arg("strike") == "strike"

    def test_leading_dot_stripped(self) -> None:
        assert _normalize_command_arg(".strike") == "strike"

    def test_leading_dot_with_whitespace(self) -> None:
        assert _normalize_command_arg("  .strike  ") == "strike"

    def test_only_dot_returns_empty(self) -> None:
        # "." -> "" after stripping the leading dot.
        assert _normalize_command_arg(".") == ""


# ---------------------------------------------------------------------------
# Tests: _parse_help_args (image-mode flag parsing)
# ---------------------------------------------------------------------------


class TestParseHelpArgs:
    def test_empty(self) -> None:
        assert _parse_help_args("") == (False, "")

    def test_whitespace_only(self) -> None:
        assert _parse_help_args("   ") == (False, "")

    def test_bare_command(self) -> None:
        assert _parse_help_args("strike") == (False, "strike")

    def test_img_alone(self) -> None:
        assert _parse_help_args("img") == (True, "")

    def test_img_uppercase(self) -> None:
        assert _parse_help_args("IMG") == (True, "")

    def test_img_with_command(self) -> None:
        assert _parse_help_args("img strike") == (True, "strike")

    def test_img_with_dotted_command(self) -> None:
        assert _parse_help_args("img .strike") == (True, "strike")

    def test_command_contains_img_word_is_not_flag(self) -> None:
        assert _parse_help_args("imgimg") == (False, "imgimg")

    def test_img_after_command_is_not_flag(self) -> None:
        # 只有首个 token 为 img 才触发图片模式。
        assert _parse_help_args("strike img") == (False, "strike img")


# ---------------------------------------------------------------------------
# Tests: image mode (img) end-to-end
# ---------------------------------------------------------------------------


class TestImageMode:
    async def test_image_overview_sends_image(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="img",
            session_manager=mgr,
        )

        calls = _private_calls(bot)
        assert len(calls) == 1
        assert "base64://" in str(calls[0].kwargs["message"])

    async def test_image_uses_group_context(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=True,
            group_id=10001,
            raw_args="img",
            session_manager=mgr,
        )

        group_calls = _group_calls(bot)
        assert len(group_calls) == 1
        assert "base64://" in str(group_calls[0].kwargs["message"])

    async def test_image_detail_sends_image(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="img strike",
            session_manager=mgr,
        )

        msg = _private_calls(bot)[0].kwargs["message"]
        assert "base64://" in str(msg)

    async def test_image_detail_with_dotted_command(self) -> None:
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="img .jump",
            session_manager=mgr,
        )

        msg = _private_calls(bot)[0].kwargs["message"]
        assert "base64://" in str(msg)

    async def test_image_unknown_command_stays_text(self) -> None:
        """错误提示不渲染成图，仍返回纯文本。"""
        bot = AsyncMock()
        mgr = SessionManager()

        await handle_help_request(
            bot=bot,
            user_id=12345,
            is_group=False,
            group_id=0,
            raw_args="img nosuchcmd",
            session_manager=mgr,
        )

        msg = _private_calls(bot)[0].kwargs["message"]
        assert isinstance(msg, str)
        assert "未找到命令" in msg


# ---------------------------------------------------------------------------
# Tests: Markdown builders
# ---------------------------------------------------------------------------


class TestMarkdownBuilders:
    def test_overview_markdown_starts_with_title(self) -> None:
        md = _build_overview_markdown(SessionState.IDLE)
        assert md.startswith("# ")
        assert "## 当前可用" in md

    def test_overview_markdown_lists_all_usages(self) -> None:
        md = _build_overview_markdown(SessionState.IDLE)
        for _name, usage, _desc in (
            cmd for cat in HELP_OVERVIEW.values() for cmd in cat
        ):
            assert f"`{usage}`" in md, f"Missing usage in markdown: {usage}"

    def test_overview_markdown_contains_other_section(self) -> None:
        md = _build_overview_markdown(SessionState.IDLE)
        assert "## 其他命令" in md
        assert "基础/匹配" in md

    def test_detail_markdown_uses_usage_as_heading(self) -> None:
        md = _build_detail_markdown("strike", COMMAND_DETAILS["strike"])
        assert md.startswith("# strike")
        assert "`.strike" in md
        assert "发起打击" in md
