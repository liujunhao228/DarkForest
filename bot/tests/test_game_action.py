"""Tests for backend/game_action.py — send game:action + claim game:actionResult.

Covers:
- No matching actionResult within timeout → returns None; ws.send called with
  correct envelope (including injected requestId); total wait bounded.
- Matching failure result → returns ActionError with code/message.
- Matching success result → returns None immediately (no timeout wait).
- Foreign results (different requestId / different action / malformed) are
  NOT claimed → falls back to timeout → None.
- Subscribe is cleaned up via unsub after result or timeout.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

import pytest

from darkforest_bot.backend.game_action import ActionError, send_game_action
from darkforest_bot.backend.protocol import ClientEvent, ServerEvent

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeWS:
    """Fake WSClient — records subscribe calls + send() invocations.

    Stores handlers per event so tests can manually invoke them with a
    payload dict (simulating an inbound message).
    """

    def __init__(self) -> None:
        self.connected: bool = True
        self.player_id: str | None = None
        self.send_calls: list[tuple[ClientEvent, dict[str, Any] | None, str]] = []
        self._handlers: dict[ServerEvent, list[Any]] = {}

    def subscribe(self, event: ServerEvent, handler: Any) -> Any:
        self._handlers.setdefault(event, []).append(handler)

        def unsubscribe() -> None:
            handlers = self._handlers.get(event)
            if handlers is None:
                return
            try:
                handlers.remove(handler)
            except ValueError:
                pass
            if not handlers:
                self._handlers.pop(event, None)

        return unsubscribe

    async def send(
        self,
        event: ClientEvent,
        payload: dict[str, Any] | None = None,
        room_id: str = "",
    ) -> None:
        if not self.connected:
            raise RuntimeError("FakeWS not connected")
        self.send_calls.append((event, payload, room_id))

    def handlers_for(self, event: ServerEvent) -> list[Any]:
        return list(self._handlers.get(event, []))

    def last_sent_action(self) -> tuple[str, str] | None:
        """Return (action, requestId) of the last game:action send, or None."""
        for event, payload, _room in reversed(self.send_calls):
            if event == ClientEvent.GAME_ACTION and payload is not None:
                data = payload.get("data") or {}
                return payload.get("action", ""), data.get("requestId", "")
        return None

    async def fire_action_result(self, payload: dict[str, Any]) -> None:
        """Manually invoke all registered game:actionResult handlers."""
        for handler in self.handlers_for(ServerEvent.GAME_ACTION_RESULT):
            await handler(payload)


async def fire_result_for_last_sent(
    ws: FakeWS,
    *,
    success: bool,
    error: str | None = None,
    error_code: str | None = None,
    action_override: str | None = None,
    request_id_override: str | None = None,
) -> None:
    """Fire a game:actionResult matching the requestId the sender injected.

    Must run after ``send_game_action`` has sent (callers ``await sleep(0)``
    first). Reads the sent action/requestId from the fake's send log.
    """
    sent = ws.last_sent_action()
    assert sent is not None, "no game:action send recorded"
    action, request_id = sent
    if action_override is not None:
        action = action_override
    if request_id_override is not None:
        request_id = request_id_override
    payload: dict[str, Any] = {
        "success": success,
        "action": action,
        "requestId": request_id,
    }
    if error is not None:
        payload["error"] = error
    if error_code is not None:
        payload["errorCode"] = error_code
    await ws.fire_action_result(payload)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_game_action_no_result_returns_none() -> None:
    """No matching actionResult within timeout → returns None; send once."""
    ws = FakeWS()

    result = await asyncio.wait_for(
        send_game_action(
            ws,
            action="playCard",
            data={"cardUid": "x"},
            timeout=0.1,  # short timeout so test runs fast
        ),
        timeout=2.0,
    )

    assert result is None
    assert len(ws.send_calls) == 1
    event, payload, room_id = ws.send_calls[0]
    assert event == ClientEvent.GAME_ACTION
    assert payload is not None
    assert payload["action"] == "playCard"
    assert payload["data"]["cardUid"] == "x"
    assert room_id == ""


@pytest.mark.asyncio
async def test_send_game_action_injects_request_id() -> None:
    """Envelope carries a unique 12-hex requestId alongside original fields."""
    ws = FakeWS()

    await send_game_action(
        ws,
        action="deployCard",
        data={"cardUid": "abc"},
        timeout=0.05,
    )

    sent = ws.last_sent_action()
    assert sent is not None
    _action, request_id = sent
    assert re.fullmatch(r"[0-9a-f]{12}", request_id), f"bad requestId: {request_id!r}"


@pytest.mark.asyncio
async def test_send_game_action_failure_returns_action_error() -> None:
    """Matching failure result → ActionError with code/message."""
    ws = FakeWS()

    async def fire_after_send() -> None:
        await asyncio.sleep(0)
        await fire_result_for_last_sent(
            ws,
            success=False,
            error="能量不足（需要 2，拥有 1）",
            error_code="ACTION_FAILED",
        )

    fire_task = asyncio.create_task(fire_after_send())
    result = await send_game_action(
        ws,
        action="playCard",
        data={"cardUid": "x"},
        timeout=5.0,
    )
    await fire_task

    assert isinstance(result, ActionError)
    assert result.code == "ACTION_FAILED"
    assert result.message == "能量不足（需要 2，拥有 1）"


@pytest.mark.asyncio
async def test_send_game_action_failure_code_roundtrips() -> None:
    """Strict-validation errorCode (e.g. NOT_YOUR_TURN) is preserved."""
    ws = FakeWS()

    async def fire_after_send() -> None:
        await asyncio.sleep(0)
        await fire_result_for_last_sent(
            ws,
            success=False,
            error="尚未轮到你行动",
            error_code="NOT_YOUR_TURN",
        )

    fire_task = asyncio.create_task(fire_after_send())
    result = await send_game_action(
        ws,
        action="endTurn",
        data={},
        timeout=5.0,
    )
    await fire_task

    assert isinstance(result, ActionError)
    assert result.code == "NOT_YOUR_TURN"
    assert result.message == "尚未轮到你行动"


@pytest.mark.asyncio
async def test_send_game_action_success_returns_none_immediately() -> None:
    """Matching success result → returns None without waiting for timeout."""
    ws = FakeWS()

    async def fire_after_send() -> None:
        await asyncio.sleep(0)
        await fire_result_for_last_sent(ws, success=True)

    fire_task = asyncio.create_task(fire_after_send())
    result = await send_game_action(
        ws,
        action="strike",
        data={"cardUid": "x", "targetSystem": 2},
        timeout=5.0,
    )
    await fire_task

    assert result is None


@pytest.mark.asyncio
async def test_send_game_action_ignores_foreign_request_id() -> None:
    """Another request's result (different requestId) must NOT be claimed."""
    ws = FakeWS()

    async def fire_after_send() -> None:
        await asyncio.sleep(0)
        await fire_result_for_last_sent(
            ws,
            success=False,
            error="别家玩家的失败",
            error_code="NOT_YOUR_TURN",
            request_id_override="other-request",
        )

    fire_task = asyncio.create_task(fire_after_send())
    result = await send_game_action(
        ws,
        action="playCard",
        data={"cardUid": "x"},
        timeout=0.1,  # foreign result must NOT satisfy; timeout → None
    )
    await fire_task

    assert result is None


@pytest.mark.asyncio
async def test_send_game_action_ignores_other_action() -> None:
    """Another action's result (different action) must NOT be claimed."""
    ws = FakeWS()

    async def fire_after_send() -> None:
        await asyncio.sleep(0)
        await fire_result_for_last_sent(
            ws,
            success=False,
            error="不匹配的动作",
            error_code="ACTION_FAILED",
            action_override="strike",
        )

    fire_task = asyncio.create_task(fire_after_send())
    result = await send_game_action(
        ws,
        action="playCard",
        data={"cardUid": "x"},
        timeout=0.1,
    )
    await fire_task

    assert result is None


@pytest.mark.asyncio
async def test_send_game_action_ignores_malformed_result() -> None:
    """Unparsable actionResult is not claimed; falls back to timeout → None."""
    ws = FakeWS()

    async def fire_after_send() -> None:
        await asyncio.sleep(0)
        await ws.fire_action_result({"unexpected": "junk"})

    fire_task = asyncio.create_task(fire_after_send())
    result = await send_game_action(
        ws,
        action="playCard",
        data={"cardUid": "x"},
        timeout=0.1,
    )
    await fire_task

    assert result is None


@pytest.mark.asyncio
async def test_send_game_action_unsubscribes_after_result() -> None:
    """After a claimed result, the handler is removed (unsub called)."""
    ws = FakeWS()

    async def fire_after_send() -> None:
        await asyncio.sleep(0)
        await fire_result_for_last_sent(
            ws,
            success=False,
            error="能量不足",
            error_code="ACTION_FAILED",
        )

    fire_task = asyncio.create_task(fire_after_send())
    await send_game_action(
        ws,
        action="playCard",
        data={"cardUid": "x"},
        timeout=5.0,
    )
    await fire_task

    assert ws.handlers_for(ServerEvent.GAME_ACTION_RESULT) == []


@pytest.mark.asyncio
async def test_send_game_action_unsubscribes_on_timeout() -> None:
    """Even on timeout (no result), the handler is unsubscribed before return."""
    ws = FakeWS()
    result = await send_game_action(
        ws,
        action="playCard",
        data={"cardUid": "x"},
        timeout=0.05,
    )
    assert result is None
    assert ws.handlers_for(ServerEvent.GAME_ACTION_RESULT) == []
