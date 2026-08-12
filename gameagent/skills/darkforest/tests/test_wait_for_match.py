"""wait_for_match 单测：脚本式 FakeTransport 注入，无需真实网络。

覆盖 keep-alive 语义：
- match:found 到达即返回；
- wait_for_event 超时 / match:error TIMEOUT（被后端 30s 队列超时踢队）后自动
  重新 join_match_queue（后端 ON CONFLICT 重置 joined_at，永不被踢）；
- 其他排队期事件（match:queueJoined）忽略继续等待；
- join 参数正确透传 preferredCount / gameMode。
"""

from __future__ import annotations

from typing import Any

import pytest

import darkforest
from darkforest.mcp_client import DarkForestMCPClient


class ScriptedTransport:
    """按调用序号返回 wait_for_event 结果的 Fake Transport。

    非 wait_for_event 调用（join_match_queue）一律返回已入队。
    """

    def __init__(self, wait_results: list[dict[str, Any]]) -> None:
        self.wait_results = wait_results
        self.calls: list[tuple[str, dict[str, Any] | None]] = []
        self.wait_index = 0

    async def connect(self) -> None:
        pass

    async def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        self.calls.append((name, arguments))
        if name == "wait_for_event":
            idx = self.wait_index
            self.wait_index += 1
            if idx < len(self.wait_results):
                return self.wait_results[idx]
            return {"hasEvent": False, "events": []}
        if name == "join_match_queue":
            return {"joined": True, "message": "已加入快速匹配队列"}
        return {}

    async def list_tools(self) -> list[str]:
        return []

    async def close(self) -> None:
        pass


def make_client(fake: ScriptedTransport) -> DarkForestMCPClient:
    client = DarkForestMCPClient("http://localhost:9090/mcp", "ai1")
    client._transport = fake  # noqa: SLF001  注入 Fake 以替代 HTTPTransport
    return client


def join_count(fake: ScriptedTransport) -> int:
    return sum(1 for name, _ in fake.calls if name == "join_match_queue")


def wait_for_event_calls(fake: ScriptedTransport) -> list[dict[str, Any] | None]:
    return [args for name, args in fake.calls if name == "wait_for_event"]


@pytest.fixture(autouse=True)
def _reset_client() -> None:
    yield
    darkforest._client = None  # noqa: SLF001  清理模块级全局，避免污染其他用例


@pytest.mark.asyncio
async def test_wait_for_match_returns_on_match_found() -> None:
    fake = ScriptedTransport(
        [
            {"hasEvent": False, "events": []},
            {
                "hasEvent": True,
                "events": [
                    {
                        "type": "match:found",
                        "timestamp": 1,
                        "payload": {"roomId": "r1", "roomCode": "A1B2"},
                    }
                ],
            },
        ]
    )
    darkforest._client = make_client(fake)  # noqa: SLF001

    out = await darkforest.wait_for_match()

    assert out["hasEvent"] is True
    assert any(e["type"] == "match:found" for e in out["events"])
    # 首次入队 + 超时后重入队 = 2 次 join
    assert join_count(fake) == 2
    # wait_for_event 每次带 20s 超时（< 后端 30s 队列超时）
    assert wait_for_event_calls(fake) == [
        {"timeoutSeconds": 20},
        {"timeoutSeconds": 20},
    ]


@pytest.mark.asyncio
async def test_wait_for_match_rejoins_on_error_timeout() -> None:
    fake = ScriptedTransport(
        [
            {
                "hasEvent": True,
                "events": [{"type": "match:error", "timestamp": 1, "payload": {"code": "TIMEOUT"}}],
            },
            {
                "hasEvent": True,
                "events": [{"type": "match:found", "timestamp": 2, "payload": {"roomId": "r2"}}],
            },
        ]
    )
    darkforest._client = make_client(fake)  # noqa: SLF001

    out = await darkforest.wait_for_match()

    assert any(e["type"] == "match:found" for e in out["events"])
    # match:error TIMEOUT 同样触发重入队
    assert join_count(fake) == 2


@pytest.mark.asyncio
async def test_wait_for_match_ignores_nonmatch_events() -> None:
    fake = ScriptedTransport(
        [
            {
                "hasEvent": True,
                "events": [{"type": "match:queueJoined", "timestamp": 1, "payload": {}}],
            },
            {
                "hasEvent": True,
                "events": [{"type": "match:found", "timestamp": 2, "payload": {"roomId": "r3"}}],
            },
        ]
    )
    darkforest._client = make_client(fake)  # noqa: SLF001

    out = await darkforest.wait_for_match()

    assert any(e["type"] == "match:found" for e in out["events"])
    # 排队期普通事件不触发重入队，仅首次 join
    assert join_count(fake) == 1


@pytest.mark.asyncio
async def test_wait_for_match_passes_preferred_count_and_game_mode() -> None:
    fake = ScriptedTransport([{"hasEvent": True, "events": [{"type": "match:found"}]}])
    darkforest._client = make_client(fake)  # noqa: SLF001

    await darkforest.wait_for_match(preferred_count=4, game_mode="civilization_relics")

    join_args = [args for name, args in fake.calls if name == "join_match_queue"]
    assert join_args == [
        {"preferredCount": 4, "gameMode": "civilization_relics"}
    ]
