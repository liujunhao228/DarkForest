"""Tests for backend/game_action.py — send game:action + wait for game:error.

Covers:
- No game:error within timeout → returns None; ws.send called with correct
  envelope; total wait time bounded by timeout.
- game:error arrives immediately with valid payload → returns ActionError.
- game:error arrives with malformed payload (missing fields) → returns
  ActionError(code="UNKNOWN").
- Subscribe is cleaned up via unsub after error fires (handlers list empty).
"""

from __future__ import annotations

import asyncio
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

    async def fire_error(self, payload: dict[str, Any]) -> None:
        """Manually invoke all registered game:error handlers with payload."""
        for handler in self.handlers_for(ServerEvent.GAME_ERROR):
            await handler(payload)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_game_action_no_error_returns_none() -> None:
    """No game:error within timeout → returns None; ws.send called once."""
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
    assert payload == {"action": "playCard", "data": {"cardUid": "x"}}
    assert room_id == ""


@pytest.mark.asyncio
async def test_send_game_action_error_returns_action_error() -> None:
    """game:error with valid payload → returns ActionError with code/message."""
    ws = FakeWS()

    async def fire_after_send() -> None:
        # Give send_game_action a chance to subscribe + send before firing.
        await asyncio.sleep(0)
        await ws.fire_error({"code": "INVALID", "message": "能量不足"})

    fire_task = asyncio.create_task(fire_after_send())
    result = await send_game_action(
        ws,
        action="playCard",
        data={"cardUid": "x"},
        timeout=2.0,
    )
    await fire_task

    assert isinstance(result, ActionError)
    assert result.code == "INVALID"
    assert result.message == "能量不足"


@pytest.mark.asyncio
async def test_send_game_action_malformed_payload_returns_unknown() -> None:
    """game:error payload missing fields → returns ActionError(code="UNKNOWN")."""
    ws = FakeWS()

    async def fire_after_send() -> None:
        await asyncio.sleep(0)
        # Missing required fields "code" and "message" → ErrorResponse
        # validation raises → fallback ActionError(code="UNKNOWN").
        await ws.fire_error({"unexpected": "junk"})

    fire_task = asyncio.create_task(fire_after_send())
    result = await send_game_action(
        ws,
        action="playCard",
        data={"cardUid": "x"},
        timeout=2.0,
    )
    await fire_task

    assert isinstance(result, ActionError)
    assert result.code == "UNKNOWN"


@pytest.mark.asyncio
async def test_send_game_action_unsubscribes_after_error() -> None:
    """After error fires, the subscribe handler is removed (unsub called)."""
    ws = FakeWS()

    async def fire_after_send() -> None:
        await asyncio.sleep(0)
        await ws.fire_error({"code": "INVALID", "message": "能量不足"})

    fire_task = asyncio.create_task(fire_after_send())
    await send_game_action(
        ws,
        action="playCard",
        data={"cardUid": "x"},
        timeout=2.0,
    )
    await fire_task

    # After send_game_action returns, the game:error handler must have been
    # unsubscribed (no lingering handlers).
    assert ws.handlers_for(ServerEvent.GAME_ERROR) == []


@pytest.mark.asyncio
async def test_send_game_action_unsubscribes_on_timeout() -> None:
    """Even on timeout (no error), the handler is unsubscribed before return."""
    ws = FakeWS()
    result = await send_game_action(
        ws,
        action="playCard",
        data={"cardUid": "x"},
        timeout=0.05,
    )
    assert result is None
    assert ws.handlers_for(ServerEvent.GAME_ERROR) == []
