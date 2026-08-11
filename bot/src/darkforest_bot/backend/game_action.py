"""Send game:action and wait briefly for the matching game:actionResult reply.

P4 game action commands (.deploy/.strike/...) use this module to give
immediate feedback when the backend rejects an action (invalid card UID,
insufficient energy, out-of-turn, etc.).

Backend contract (rooms/room.go ``HandleGameAction``):

- Every game:action is answered with a ``game:actionResult`` broadcast to the
  whole room — there is **no** per-player addressing (no playerId in the
  payload). Success: ``{"success": true, "action": ...}``. Failure:
  ``{"success": false, "action": ..., "error": "<中文文案>",
  "errorCode": "NOT_YOUR_TURN" | ...}``.
- The ``requestId`` field of the result echoes the ``requestId`` the sender
  embedded in the action data (backend ``extractRequestID``).
- ``game:error`` is only used for login/match/room-level errors, never for
  game:action failures — the old "wait for game:error" approach therefore
  never fired and every rejected action silently timed out.

This module claims its own result by embedding a unique ``requestId`` in the
action data and matching the broadcast result on ``action`` + ``requestId``.
If no matching result arrives within ``timeout`` seconds, the action is
assumed to have succeeded (compatible with pre-strict-validation backends
that always replied success:true, and a safe fallback for lost messages).

The ``data`` parameter is typed ``dict[str, Any]`` because it is the JSON
boundary — backend accepts arbitrary action payloads (``cardUid``,
``targetSystem``, ``discardCards``, ...) per action type. ``Any`` here is the
correct boundary type, matching ``protocol.py`` and ``delta.py`` conventions.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from loguru import logger

from darkforest_bot.backend.protocol import (
    ActionResultPayload,
    ClientEvent,
    ServerEvent,
)

if TYPE_CHECKING:
    from darkforest_bot.backend.client import WSClient


@dataclass(frozen=True, slots=True)
class ActionError:
    """Backend-reported error for a game:action.

    Attributes:
        code: Backend error code (e.g. "ACTION_FAILED", "NOT_YOUR_TURN").
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
    """Send a ``game:action`` message and wait briefly for the matching result.

    Args:
        ws: The player's WSClient (must be connected).
        action: Backend action name, e.g. "playCard", "strike", "endTurn".
        data: Action-specific payload (e.g. ``{"cardUid": "..."}``). JSON
            boundary — ``Any`` values are intentional here. A unique
            ``requestId`` is injected into a copy before sending.
        timeout: Seconds to wait for a matching ``game:actionResult`` before
            assuming success. Defaults to 2.0s (matches
            ``Settings.action_error_timeout``).

    Returns:
        ``None`` on success (either a matching ``success:true`` result arrived
        or the wait timed out). Otherwise an ``ActionError`` carrying the
        backend's error code and Chinese message.
    """
    loop = asyncio.get_running_loop()
    future: asyncio.Future[ActionResultPayload] = loop.create_future()

    # 唯一 requestId：后端 extractRequestID 会原样回填到 actionResult。
    # actionResult 是房间广播（无 playerId），必须靠 action+requestId 双重
    # 匹配认领自己的结果，避免把其他玩家的失败误报给自己。
    request_id = uuid4().hex[:12]
    payload_data = dict(data)
    payload_data["requestId"] = request_id

    async def on_result(payload: dict[str, Any]) -> None:
        if future.done():
            return
        try:
            result = ActionResultPayload.model_validate(payload)
        except Exception:  # noqa: BLE001 - 协议漂移：不认领，等待超时兜底
            logger.warning(
                "game:actionResult payload parse failed (not claimed)",
                payload=payload,
            )
            return
        if result.action != action or result.request_id != request_id:
            # 其他玩家的动作结果 / 其他请求的结果：不认领。
            return
        future.set_result(result)

    unsub = ws.subscribe(ServerEvent.GAME_ACTION_RESULT, on_result)
    try:
        await ws.send(ClientEvent.GAME_ACTION, {"action": action, "data": payload_data})
        try:
            result = await asyncio.wait_for(future, timeout=timeout)
        except TimeoutError:
            # 超时未认领：按成功处理（兼容旧后端 / 消息丢失兜底）。
            return None
        if result.success:
            return None
        return ActionError(
            code=result.error_code or "ACTION_FAILED",
            message=result.error or "操作失败",
        )
    finally:
        unsub()
