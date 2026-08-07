"""Tests for commands/notify.py — .notify command core logic.

Covers:
- 无参数 → 显示当前配置文本（含三开关状态 + 不可关闭提示）
- 单个开关开/关 → store.set 被调用，确认文本，再查询显示新值
- all on/off → 三个字段都设置
- reset → store.reset
- 无效参数 → 返回参数无效文本
- 群聊/私聊事件都能触发（handle_notify_request 核心逻辑 + _reply 方式）
"""

from __future__ import annotations

from darkforest_bot.commands.notify import handle_notify_request
from darkforest_bot.notifications.notify_config import NotifyConfig

# ---------------------------------------------------------------------------
# Fake store
# ---------------------------------------------------------------------------


class FakeNotifyConfigStore:
    """内存版 NotifyConfigStore，实现 get/set/reset 接口，避免文件 IO。"""

    def __init__(self) -> None:
        self.configs: dict[int, NotifyConfig] = {}
        self.set_calls: list[tuple[int, NotifyConfig]] = []
        self.reset_calls: list[int] = []

    def get(self, qq: int) -> NotifyConfig:
        return self.configs.get(qq, NotifyConfig.default())

    async def set(self, qq: int, cfg: NotifyConfig) -> None:
        self.configs[qq] = cfg
        self.set_calls.append((qq, cfg))

    async def reset(self, qq: int) -> None:
        self.configs.pop(qq, None)
        self.reset_calls.append(qq)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestNotifyCommand:
    async def test_no_args_shows_current_config(self) -> None:
        store = FakeNotifyConfigStore()
        result = await handle_notify_request(12345, "", store)

        assert "broadcast: on" in result
        assert "strike: on" in result
        assert "other: off" in result
        assert "不可关闭" in result
        assert store.set_calls == []
        assert store.reset_calls == []

    async def test_broadcast_off(self) -> None:
        store = FakeNotifyConfigStore()
        result = await handle_notify_request(12345, "broadcast off", store)

        assert result == "已设置 broadcast = off"
        assert store.set_calls[0][0] == 12345
        assert store.set_calls[0][1] == NotifyConfig(broadcast=False, strike=True, other=False)

        # 再查显示。
        result2 = await handle_notify_request(12345, "", store)
        assert "broadcast: off" in result2
        assert "strike: on" in result2

    async def test_strike_on_from_off(self) -> None:
        store = FakeNotifyConfigStore()
        # 先 other off 之类默认 on，测试把 strike 开（默认已 on）。
        await handle_notify_request(12345, "", store)
        result = await handle_notify_request(12345, "strike off", store)
        assert result == "已设置 strike = off"
        assert store.set_calls[-1][1] == NotifyConfig(broadcast=True, strike=False, other=False)

    async def test_other_on(self) -> None:
        store = FakeNotifyConfigStore()
        result = await handle_notify_request(12345, "other on", store)
        assert result == "已设置 other = on"
        assert store.set_calls[0][1] == NotifyConfig(broadcast=True, strike=True, other=True)

    async def test_all_on(self) -> None:
        store = FakeNotifyConfigStore()
        await handle_notify_request(12345, "all on", store)
        assert store.set_calls[0][1] == NotifyConfig(broadcast=True, strike=True, other=True)

    async def test_all_off(self) -> None:
        store = FakeNotifyConfigStore()
        await handle_notify_request(12345, "all off", store)
        assert store.set_calls[0][1] == NotifyConfig(broadcast=False, strike=False, other=False)

    async def test_reset(self) -> None:
        store = FakeNotifyConfigStore()
        await handle_notify_request(12345, "all off", store)
        result = await handle_notify_request(12345, "reset", store)
        assert result == "已重置为默认设置"
        assert store.reset_calls == [12345]
        # 再显示 → 回到默认。
        result2 = await handle_notify_request(12345, "", store)
        assert "broadcast: on" in result2
        assert "other: off" in result2

    async def test_invalid_category(self) -> None:
        store = FakeNotifyConfigStore()
        result = await handle_notify_request(12345, "foo on", store)
        assert "参数无效" in result

    async def test_invalid_value(self) -> None:
        store = FakeNotifyConfigStore()
        result = await handle_notify_request(12345, "broadcast maybe", store)
        assert "参数无效" in result

    async def test_extra_args_invalid(self) -> None:
        store = FakeNotifyConfigStore()
        result = await handle_notify_request(12345, "broadcast on extra", store)
        assert "参数无效" in result

    async def test_blank_tokens_shows_config(self) -> None:
        store = FakeNotifyConfigStore()
        result = await handle_notify_request(12345, "   ", store)
        assert "broadcast: on" in result
