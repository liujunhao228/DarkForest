"""Send game:action and wait briefly for a game:error reply.

P4 game action commands (.play/.deploy/.strike/...) use this module to give
immediate feedback when the backend rejects an action (invalid card UID,
insufficient energy, out-of-turn, etc.). If no ``game:error`` arrives within
``timeout`` seconds, the action is assumed to have succeeded.

The ``data`` parameter is typed ``dict[str, Any]`` because it is the JSON
boundary — backend accepts arbitrary action payloads (``cardUid``,
``targetSystem``, ``discardCards``, ...) per action type. ``Any`` here is the
correct boundary type, matching ``protocol.py`` and ``delta.py`` conventions.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from loguru import logger

from darkforest_bot.backend.protocol import (
    ClientEvent,
    ErrorResponse,
    ServerEvent,
)

if TYPE_CHECKING:
    from darkforest_bot.backend.client import WSClient


@dataclass(frozen=True, slots=True)
class ActionError:
    """Backend-reported error for a game:action.

    Attributes:
        code: Backend error code (e.g. "INVALID_ACTION", "NOT_YOUR_TURN").
        message: Human-readable error message (Chinese, suitable for direct
            private-message reply).
    """

    code: str
    message: str


async def send_game_action(
    ws: WSClient,
    action: str,
    data: dict[str, Any],
    *,
    timeout: float = 2.0,
) -> ActionError | None:
    """Send a ``game:action`` message and wait briefly for a ``game:error`` reply.

    Args:
        ws: The player's WSClient (must be connected).
        action: Backend action name, e.g. "playCard", "strike", "endTurn".
        data: Action-specific payload (e.g. ``{"cardUid": "..."}``). JSON
            boundary — ``Any`` values are intentional here.
        timeout: Seconds to wait for a ``game:error`` reply before assuming
            success. Defaults to 2.0s (matches ``Settings.action_error_timeout``).

    Returns:
        ``None`` if no ``game:error`` arrived within ``timeout`` (action is
        assumed to have succeeded). Otherwise an ``ActionError`` with the
        backend's error code and message.

    The function subscribes to ``game:error`` for the duration of the wait and
    always unsubscribes before returning. If the ``game:error`` payload cannot
    be parsed as an :class:`ErrorResponse`, an ``ActionError`` with
    ``code="UNKNOWN"`` is returned carrying the raw payload string.
    """
    loop = asyncio.get_running_loop()
    future: asyncio.Future[dict[str, Any]] = loop.create_future()

    async def on_error(payload: dict[str, Any]) -> None:
        if not future.done():
            future.set_result(payload)

    unsub = ws.subscribe(ServerEvent.GAME_ERROR, on_error)
    try:
        await ws.send(ClientEvent.GAME_ACTION, {"action": action, "data": data})
        try:
            payload = await asyncio.wait_for(future, timeout=timeout)
        except TimeoutError:
            return None
        try:
            err = ErrorResponse.model_validate(payload)
            return ActionError(code=err.code, message=err.message)
        except Exception:
            logger.warning(
                "game:error payload parse failed",
                payload=payload,
            )
            return ActionError(code="UNKNOWN", message=str(payload))
    finally:
        unsub()
