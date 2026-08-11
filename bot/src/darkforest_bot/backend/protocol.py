"""Mirror of backend/internal/hub/protocol.go event constants and payload shapes.

This module is the single source of truth on the bot side for the WS protocol.
When backend protocol.go changes, update this file in lockstep.

Design note: payload fields use ``dict[str, Any] | None`` because the backend's
``json.RawMessage`` is by definition polymorphic JSON. We parse payload into
specific BaseModel types (e.g. MatchFoundPayload) at the call site via
``Model.model_validate(payload)``. ``Any`` here is the correct boundary type,
not a bypass of type safety in business logic.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

ProtocolVersion = "1.0.0"


class ClientEvent(StrEnum):
    """Events the bot sends to backend. Mirrors backend ClientEvent."""

    PLAYER_LOGIN = "player:login"
    PLAYER_LOGOUT = "player:logout"

    MATCH_JOIN_QUEUE = "match:joinQueue"
    MATCH_CANCEL_QUEUE = "match:cancelQueue"
    MATCH_GET_STATUS = "match:getStatus"
    MATCH_JOIN_SPECIFIC_QUEUE = "match:joinSpecificQueue"
    MATCH_CREATE_QUEUE = "match:createQueue"
    MATCH_LEAVE_SPECIFIC_QUEUE = "match:leaveSpecificQueue"
    MATCH_GET_QUEUE_INFO = "match:getQueueInfo"
    MATCH_GET_MY_QUEUES = "match:getMyQueues"

    ROOM_JOIN = "room:join"
    ROOM_LEAVE = "room:leave"
    ROOM_READY = "room:ready"
    ROOM_REJOIN = "room:rejoin"

    GAME_ACTION = "game:action"
    GAME_CANCEL_ACTION = "game:cancelAction"
    GAME_REQUEST_SYNC = "game:requestSync"
    GAME_ACK_STATE = "game:ackState"


class ServerEvent(StrEnum):
    """Events backend pushes to bot. Mirrors backend ServerEvent."""

    PLAYER_LOGIN_SUCCESS = "player:loginSuccess"
    PLAYER_LOGIN_ERROR = "player:loginError"

    MATCH_QUEUE_JOINED = "match:queueJoined"
    MATCH_QUEUE_CANCELLED = "match:queueCancelled"
    MATCH_QUEUE_STATUS = "match:queueStatus"
    MATCH_FOUND = "match:found"
    MATCH_QUEUE_CREATED = "match:queueCreated"
    MATCH_SPECIFIC_QUEUE_JOINED = "match:specificQueueJoined"
    MATCH_SPECIFIC_QUEUE_LEFT = "match:specificQueueLeft"
    MATCH_QUEUE_INFO_RESPONSE = "match:queueInfoResponse"
    MATCH_MY_QUEUES_RESPONSE = "match:myQueuesResponse"
    MATCH_QUEUE_UPDATE = "match:queueUpdate"
    MATCH_ERROR = "match:error"

    ROOM_JOINED = "room:joined"
    ROOM_PLAYER_JOINED = "room:playerJoined"
    ROOM_PLAYER_LEFT = "room:playerLeft"
    ROOM_PLAYER_DISCONNECTED = "room:playerDisconnected"
    ROOM_PLAYER_READY = "room:playerReady"
    ROOM_GAME_STARTING = "room:gameStarting"
    ROOM_GAME_STARTED = "room:gameStarted"
    ROOM_HOST_CHANGED = "room:hostChanged"
    ROOM_ACTIVE_ROOM_FOUND = "room:activeRoomFound"
    ROOM_PLAYER_RECONNECTED = "room:playerReconnected"

    GAME_FULL_SYNC = "game:fullSync"
    GAME_DELTA_SYNC = "game:deltaSync"
    GAME_ACTION_RESULT = "game:actionResult"
    GAME_ERROR = "game:error"


class _StrictModel(BaseModel):
    """Base for all protocol payload models: forbid extras, freeze instances."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class Message(_StrictModel):
    """Wire envelope. Mirrors backend hub.Message.

    Wire JSON: ``{"type": "...", "payload": {...}, "roomId": "..."}``
    """

    type: str
    payload: dict[str, Any] | None = None
    room_id: str | None = Field(default=None, alias="roomId")


class PlayerInfo(_StrictModel):
    """Player identity. Mirrors backend hub.PlayerInfo.

    Sent in ``player:loginSuccess`` payload.
    """

    id: str
    user_id: str = Field(alias="userId")
    display_name: str = Field(alias="displayName")
    role: str
    ready: bool = False
    connected: bool = False


class MatchmakingRequest(_StrictModel):
    """Outbound payload for ``match:joinQueue``.

    Wire JSON: ``{"preferredCount": 4, "gameMode": "classic"}``
    """

    preferred_count: int = Field(alias="preferredCount")
    game_mode: str = Field(default="classic", alias="gameMode")


class MatchPlayerInfo(_StrictModel):
    """One player entry inside MatchFoundPayload.players.

    Mirrors backend match.MatchPlayerInfo.
    """

    player_id: str = Field(alias="playerId")
    display_name: str = Field(alias="displayName")
    is_host: bool = Field(alias="isHost")
    player_number: int = Field(alias="playerNumber")
    position: int = Field(alias="position")


class MatchFoundPayload(_StrictModel):
    """Inbound payload for ``match:found``.

    Built by backend matchservice.notifyMatchFound. roomId and roomCode are
    both set to the same value (roomCode) for fast-match; for custom queue,
    roomId=queueId. Bot treats them as opaque identifiers.
    """

    room_id: str = Field(alias="roomId")
    room_code: str = Field(alias="roomCode")
    host_id: str = Field(alias="hostId")
    players: list[MatchPlayerInfo]
    is_host: bool = Field(alias="isHost")


class RoomPlayer(_StrictModel):
    """One player entry inside RoomJoinedPayload.players.

    Mirrors frontend RoomPlayer interface.
    """

    player_id: str = Field(alias="playerId")
    display_name: str = Field(alias="displayName")
    is_host: bool = Field(alias="isHost")
    player_number: int = Field(alias="playerNumber")
    position: int = Field(alias="position")
    ready: bool
    connected: bool


class RoomJoinedPayload(_StrictModel):
    """Inbound payload for ``room:joined``.

    Sent by backend after match:found triggers roomCreator callback.
    """

    room_id: str = Field(alias="roomId")
    room_code: str = Field(alias="roomCode")
    players: list[RoomPlayer]
    is_host: bool = Field(alias="isHost")


class ErrorResponse(_StrictModel):
    """Generic error payload. Mirrors backend hub.ErrorResponse."""

    code: str
    message: str


class ActionResultPayload(_StrictModel):
    """Inbound payload for ``game:actionResult``.

    Mirrors backend rooms/room.go ``sendActionResult``: dispatched after every
    game:action, broadcast to the whole room with no playerId. ``requestId``
    echoes the ``requestId`` the sender embedded in the action data (backend
    ``extractRequestID``), so a client can claim its own result precisely.

    Wire JSON::

        {"success": false, "action": "playCard", "requestId": "ab12...",
         "error": "能量不足（需要 2，拥有 1）", "errorCode": "ACTION_FAILED"}

    ``error``/``errorCode`` are omitted (null) on success.
    """

    success: bool
    action: str
    request_id: str | None = Field(default=None, alias="requestId")
    error: str | None = None
    error_code: str | None = Field(default=None, alias="errorCode")
