"""Tests for commands/playai.py — .playai / .cancelai AI 对手命令。

覆盖三条路径（monkeypatch 模块级 HTTP 封装函数，不依赖真实 Agent 管理器）：
1. spawn：参数解析（mode 默认 classic / 未知拒绝）、spawn 调用参数、
   群聊即时 ack、后台轮询 task 被调度、spawn 失败提示、重复请求拒绝。
2. 轮询：进入对局（currentMatchId 非空）、error/cancelled/terminated、
   404、超时、cancel 事件退出 —— 均走私聊回传（成功/失败私聊发起者）。
3. cancelai：取消（DELETE + 清理跟踪）、无活动提示、删除失败仍本地取消。

群聊触发 → ack/结果回群聊；私聊触发 → 只私聊。

注意：模块级 _ACTIVE 在用例间清理，避免泄漏。后台 task 用 async fake 替换，
测试内显式 await 以确定性驱动。
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

import darkforest_bot.commands.playai as playai_mod
from darkforest_bot.commands.playai import (
    AgentInfo,
    _PlayaiTracking,
    handle_cancelai_request,
    handle_playai_request,
)
from darkforest_bot.config import Settings

QQ = 12345
CHILD = "child-abc123"


def _settings(**overrides: Any) -> Settings:
    """构造隔离 bot/.env 的 Settings（测试不依赖本地 .env）。"""
    return Settings(_env_file=None, **overrides)


def _tracking(child_id: str = CHILD) -> _PlayaiTracking:
    return _PlayaiTracking(
        child_id=child_id,
        agent_name="ai_opponent_test",
        cancel_event=playai_mod.asyncio.Event(),
    )


def _private_messages(bot: AsyncMock) -> list[Any]:
    """返回全部 send_private_msg 调用的 message 参数。"""
    calls = [
        c for c in bot.call_api.call_args_list if c.args[0] == "send_private_msg"
    ]
    return [c.kwargs["message"] for c in calls]


def _group_messages(bot: AsyncMock) -> list[Any]:
    """返回全部 send_group_msg 调用的 message 参数。"""
    calls = [
        c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"
    ]
    return [c.kwargs["message"] for c in calls]


@pytest.fixture(autouse=True)
def _clear_active() -> None:
    """每个用例前后清理模块级 _ACTIVE，避免跨用例泄漏。"""
    playai_mod._ACTIVE.clear()
    yield
    playai_mod._ACTIVE.clear()


class TestPlayaiCommand:
    async def test_unknown_mode_rejected_without_spawn(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """未知 mode → 提示可用 mode，不调用 spawn。"""
        bot = AsyncMock()
        settings = _settings()
        called: list[tuple[str, str]] = []

        async def fake_spawn(
            s: Settings, agent_name: str, game_mode: str,
        ) -> str:
            called.append((agent_name, game_mode))
            return CHILD

        monkeypatch.setattr(playai_mod, "_http_spawn", fake_spawn)

        await handle_playai_request(
            bot=bot, user_id=QQ, raw_args="unknownmode", settings=settings,
        )

        assert called == []
        assert playai_mod._ACTIVE == {}
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "不支持的 mode" in msgs[0]
        assert "classic" in msgs[0]

    async def test_spawn_uses_random_agent_name_and_passed_mode(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """spawn 使用 random 名字（ai_opponent_ 前缀）；mode 透传。"""
        bot = AsyncMock()
        settings = _settings()
        called: list[tuple[str, str]] = []

        async def fake_spawn(
            s: Settings, agent_name: str, game_mode: str,
        ) -> str:
            called.append((agent_name, game_mode))
            return CHILD

        async def fake_poll(
            bot: Any, user_id: int, settings: Settings,
            is_group: bool, group_id: int, tracking: _PlayaiTracking,
        ) -> None:
            return None

        monkeypatch.setattr(playai_mod, "_http_spawn", fake_spawn)
        monkeypatch.setattr(playai_mod, "_poll_agent_loop", fake_poll)

        await handle_playai_request(
            bot=bot, user_id=QQ, raw_args="civilization_relics",
            settings=settings,
        )

        assert len(called) == 1
        assert called[0][0].startswith("ai_opponent_")
        assert called[0][1] == "civilization_relics"

    async def test_default_mode_is_classic(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """无参数 → mode 默认 classic。"""
        bot = AsyncMock()
        settings = _settings()
        called: list[tuple[str, str]] = []

        async def fake_spawn(
            s: Settings, agent_name: str, game_mode: str,
        ) -> str:
            called.append((agent_name, game_mode))
            return CHILD

        async def fake_poll(
            bot: Any, user_id: int, settings: Settings,
            is_group: bool, group_id: int, tracking: _PlayaiTracking,
        ) -> None:
            return None

        monkeypatch.setattr(playai_mod, "_http_spawn", fake_spawn)
        monkeypatch.setattr(playai_mod, "_poll_agent_loop", fake_poll)

        await handle_playai_request(
            bot=bot, user_id=QQ, raw_args="", settings=settings,
        )

        assert len(called) == 1
        assert called[0][0].startswith("ai_opponent_")
        assert called[0][1] == "classic"

    async def test_spawn_acks_group_and_schedules_poll(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """spawn 成功 → 群聊即时 ack + 注册跟踪 + 后台轮询 task 被调度。"""
        bot = AsyncMock()
        settings = _settings()
        group_id = 98765
        polled: list[str] = []

        async def fake_spawn(
            s: Settings, agent_name: str, game_mode: str,
        ) -> str:
            return CHILD

        async def fake_poll(
            bot: Any, user_id: int, settings: Settings,
            is_group: bool, group_id: int, tracking: _PlayaiTracking,
        ) -> None:
            polled.append(tracking.child_id)

        monkeypatch.setattr(playai_mod, "_http_spawn", fake_spawn)
        monkeypatch.setattr(playai_mod, "_poll_agent_loop", fake_poll)

        await handle_playai_request(
            bot=bot, user_id=QQ, raw_args="", settings=settings,
            is_group=True, group_id=group_id,
        )
        # 给后台 task 一个运行机会
        await playai_mod.asyncio.sleep(0)

        assert polled == [CHILD]
        assert _private_messages(bot) == []
        group_calls = [
            c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"
        ]
        assert len(group_calls) == 1
        assert "AI 对手已就绪，正在匹配中" in group_calls[0].kwargs["message"]
        assert group_calls[0].kwargs["group_id"] == group_id
        assert playai_mod._ACTIVE[QQ].child_id == CHILD

    async def test_spawn_failure_reports_without_tracking(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """spawn 抛异常 → 提示创建失败，不注册跟踪、不调度轮询。"""
        bot = AsyncMock()
        settings = _settings()

        async def fake_spawn(
            s: Settings, agent_name: str, game_mode: str,
        ) -> str:
            raise RuntimeError("连接失败")

        monkeypatch.setattr(playai_mod, "_http_spawn", fake_spawn)

        await handle_playai_request(
            bot=bot, user_id=QQ, raw_args="", settings=settings,
        )

        assert playai_mod._ACTIVE == {}
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "创建失败" in msgs[0]

    async def test_duplicate_request_rejected(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """已有进行中的对局 → 拒绝再次发起，不调 spawn。"""
        bot = AsyncMock()
        settings = _settings()
        called: list[str] = []

        async def fake_spawn(
            s: Settings, agent_name: str, game_mode: str,
        ) -> str:
            called.append(agent_name)
            return CHILD

        monkeypatch.setattr(playai_mod, "_http_spawn", fake_spawn)
        playai_mod._ACTIVE[QQ] = _tracking()

        await handle_playai_request(
            bot=bot, user_id=QQ, raw_args="classic", settings=settings,
        )

        assert called == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "已有进行中的 AI 对局" in msgs[0]

    async def test_private_trigger_stays_private(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """私聊触发 → 仅私聊（ack），不产生群消息。"""
        bot = AsyncMock()
        settings = _settings()

        async def fake_spawn(
            s: Settings, agent_name: str, game_mode: str,
        ) -> str:
            return CHILD

        async def fake_poll(
            bot: Any, user_id: int, settings: Settings,
            is_group: bool, group_id: int, tracking: _PlayaiTracking,
        ) -> None:
            return None

        monkeypatch.setattr(playai_mod, "_http_spawn", fake_spawn)
        monkeypatch.setattr(playai_mod, "_poll_agent_loop", fake_poll)

        await handle_playai_request(
            bot=bot, user_id=QQ, raw_args="", settings=settings,
        )

        assert _group_messages(bot) == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "等待" not in msgs[0]
        assert "AI 对手已就绪" in msgs[0]


class TestPollAgentLoop:
    async def test_poll_enters_game_sends_private_and_cleans(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """currentMatchId 非空 → 私聊「已进入对局」，清理 _ACTIVE。"""
        bot = AsyncMock()
        settings = _settings()
        tracking = _tracking()
        playai_mod._ACTIVE[QQ] = tracking

        async def fake_get(s: Settings, child_id: str) -> AgentInfo:
            return AgentInfo(
                child_id=child_id,
                agent_name="ai_opponent_test",
                status="running",
                start_time=0,
                current_match_id="match-1",
            )

        monkeypatch.setattr(playai_mod, "_http_get_agent", fake_get)

        await playai_mod._poll_agent_loop(
            bot, QQ, settings, False, 0, tracking,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "AI 对手已进入对局" in msgs[0]
        assert playai_mod._ACTIVE == {}

    async def test_poll_error_status_reports(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """status=error → 私聊状态异常。"""
        bot = AsyncMock()
        settings = _settings()
        tracking = _tracking()
        playai_mod._ACTIVE[QQ] = tracking

        async def fake_get(s: Settings, child_id: str) -> AgentInfo:
            return AgentInfo(
                child_id=child_id, agent_name="x", status="error",
                start_time=0, current_match_id=None,
            )

        monkeypatch.setattr(playai_mod, "_http_get_agent", fake_get)

        await playai_mod._poll_agent_loop(
            bot, QQ, settings, False, 0, tracking,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "状态异常" in msgs[0]
        assert "error" in msgs[0]
        assert playai_mod._ACTIVE == {}

    async def test_poll_terminated_reports(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """status=terminated（被回收）→ 提示未能进入对局。"""
        bot = AsyncMock()
        settings = _settings()
        tracking = _tracking()

        async def fake_get(s: Settings, child_id: str) -> AgentInfo:
            return AgentInfo(
                child_id=child_id, agent_name="x", status="terminated",
                start_time=0, current_match_id=None,
            )

        monkeypatch.setattr(playai_mod, "_http_get_agent", fake_get)

        await playai_mod._poll_agent_loop(
            bot, QQ, settings, False, 0, tracking,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "终止" in msgs[0] or "未能进入对局" in msgs[0]

    async def test_poll_missing_agent_reports(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """GET 返回 404（None）→ 提示已被移除。"""
        bot = AsyncMock()
        settings = _settings()
        tracking = _tracking()

        async def fake_get(s: Settings, child_id: str) -> AgentInfo | None:
            return None

        monkeypatch.setattr(playai_mod, "_http_get_agent", fake_get)

        await playai_mod._poll_agent_loop(
            bot, QQ, settings, False, 0, tracking,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "已被移除" in msgs[0]

    async def test_poll_timeout_reports(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """超时（agent_manager_timeout=0）→ 提示等待超时。"""
        bot = AsyncMock()
        settings = _settings(agent_manager_timeout=0.0)
        tracking = _tracking()

        async def fake_get(s: Settings, child_id: str) -> AgentInfo:
            return AgentInfo(
                child_id=child_id, agent_name="x", status="running",
                start_time=0, current_match_id=None,
            )

        monkeypatch.setattr(playai_mod, "_http_get_agent", fake_get)

        await playai_mod._poll_agent_loop(
            bot, QQ, settings, False, 0, tracking,
        )

        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "等待超时" in msgs[0]

    async def test_cancel_event_stops_loop_silently(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """cancel 事件已置位 → 轮询直接退出，不发消息，清理 _ACTIVE。"""
        bot = AsyncMock()
        settings = _settings()
        tracking = _tracking()
        tracking.cancel_event.set()
        playai_mod._ACTIVE[QQ] = tracking

        async def fake_get(s: Settings, child_id: str) -> AgentInfo:
            raise AssertionError("cancel 后不应再轮询")

        monkeypatch.setattr(playai_mod, "_http_get_agent", fake_get)

        await playai_mod._poll_agent_loop(
            bot, QQ, settings, False, 0, tracking,
        )

        assert _private_messages(bot) == []
        assert playai_mod._ACTIVE == {}


class TestCancelai:
    async def test_cancel_deletes_and_cleans(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """取消 → DELETE 管理器 + 心跳取消事件 + 清理跟踪 + 回「已取消」。"""
        bot = AsyncMock()
        settings = _settings()
        tracking = _tracking()
        playai_mod._ACTIVE[QQ] = tracking
        deleted: list[str] = []

        async def fake_delete(s: Settings, child_id: str) -> None:
            deleted.append(child_id)

        monkeypatch.setattr(playai_mod, "_http_delete_agent", fake_delete)

        await handle_cancelai_request(bot=bot, user_id=QQ, settings=settings)

        assert deleted == [CHILD]
        assert tracking.cancel_event.is_set()
        assert playai_mod._ACTIVE == {}
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "已取消" in msgs[0]

    async def test_cancel_without_active_prompts(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """无进行中对局 → 提示，不调 DELETE。"""
        bot = AsyncMock()
        settings = _settings()
        deleted: list[str] = []

        async def fake_delete(s: Settings, child_id: str) -> None:
            deleted.append(child_id)

        monkeypatch.setattr(playai_mod, "_http_delete_agent", fake_delete)

        await handle_cancelai_request(bot=bot, user_id=QQ, settings=settings)

        assert deleted == []
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "当前没有进行中的 AI 对局" in msgs[0]

    async def test_cancel_delete_failure_still_cancels_local(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """DELETE 失败 → 仍本地取消（best-effort）。"""
        bot = AsyncMock()
        settings = _settings()
        tracking = _tracking()
        playai_mod._ACTIVE[QQ] = tracking

        async def fake_delete(s: Settings, child_id: str) -> None:
            raise RuntimeError("连接失败")

        monkeypatch.setattr(playai_mod, "_http_delete_agent", fake_delete)

        await handle_cancelai_request(bot=bot, user_id=QQ, settings=settings)

        assert tracking.cancel_event.is_set()
        assert playai_mod._ACTIVE == {}
        msgs = _private_messages(bot)
        assert len(msgs) == 1
        assert "已取消" in msgs[0]

    async def test_cancel_in_group_replies_in_group(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """群聊触发 → 取消结果回群聊。"""
        bot = AsyncMock()
        settings = _settings()
        group_id = 98765
        playai_mod._ACTIVE[QQ] = _tracking()

        async def fake_delete(s: Settings, child_id: str) -> None:
            return None

        monkeypatch.setattr(playai_mod, "_http_delete_agent", fake_delete)

        await handle_cancelai_request(
            bot=bot, user_id=QQ, settings=settings,
            is_group=True, group_id=group_id,
        )

        assert _private_messages(bot) == []
        group_calls = [
            c for c in bot.call_api.call_args_list if c.args[0] == "send_group_msg"
        ]
        assert len(group_calls) == 1
        assert "已取消" in group_calls[0].kwargs["message"]
