"""Tests for backend/protocol.py — verify mirror of backend hub/protocol.go."""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from darkforest_bot.backend.protocol import (
    ClientEvent,
    ErrorResponse,
    MatchFoundPayload,
    MatchmakingRequest,
    MatchPlayerInfo,
    Message,
    PlayerInfo,
    ProtocolVersion,
    RoomJoinedPayload,
    RoomPlayer,
    ServerEvent,
)


class TestClientEventConstants:
    """ClientEvent string values must match backend protocol.go exactly."""

    def test_player_events(self) -> None:
        assert ClientEvent.PLAYER_LOGIN == "player:login"
        assert ClientEvent.PLAYER_LOGOUT == "player:logout"

    def test_matchmaking_events(self) -> None:
        assert ClientEvent.MATCH_JOIN_QUEUE == "match:joinQueue"
        assert ClientEvent.MATCH_CANCEL_QUEUE == "match:cancelQueue"
        assert ClientEvent.MATCH_GET_STATUS == "match:getStatus"
        assert ClientEvent.MATCH_JOIN_SPECIFIC_QUEUE == "match:joinSpecificQueue"
        assert ClientEvent.MATCH_CREATE_QUEUE == "match:createQueue"
        assert ClientEvent.MATCH_LEAVE_SPECIFIC_QUEUE == "match:leaveSpecificQueue"
        assert ClientEvent.MATCH_GET_QUEUE_INFO == "match:getQueueInfo"
        assert ClientEvent.MATCH_GET_MY_QUEUES == "match:getMyQueues"

    def test_room_events(self) -> None:
        assert ClientEvent.ROOM_JOIN == "room:join"
        assert ClientEvent.ROOM_LEAVE == "room:leave"
        assert ClientEvent.ROOM_READY == "room:ready"
        assert ClientEvent.ROOM_REJOIN == "room:rejoin"

    def test_game_events(self) -> None:
        assert ClientEvent.GAME_ACTION == "game:action"
        assert ClientEvent.GAME_CANCEL_ACTION == "game:cancelAction"
        assert ClientEvent.GAME_REQUEST_SYNC == "game:requestSync"
        assert ClientEvent.GAME_ACK_STATE == "game:ackState"

    def test_total_count(self) -> None:
        # 2 player + 8 match + 4 room + 4 game = 18
        assert len(list(ClientEvent)) == 18


class TestServerEventConstants:
    """ServerEvent string values must match backend protocol.go exactly."""

    def test_player_server_events(self) -> None:
        assert ServerEvent.PLAYER_LOGIN_SUCCESS == "player:loginSuccess"
        assert ServerEvent.PLAYER_LOGIN_ERROR == "player:loginError"

    def test_match_server_events(self) -> None:
        assert ServerEvent.MATCH_QUEUE_JOINED == "match:queueJoined"
        assert ServerEvent.MATCH_QUEUE_CANCELLED == "match:queueCancelled"
        assert ServerEvent.MATCH_QUEUE_STATUS == "match:queueStatus"
        assert ServerEvent.MATCH_FOUND == "match:found"
        assert ServerEvent.MATCH_QUEUE_CREATED == "match:queueCreated"
        assert ServerEvent.MATCH_SPECIFIC_QUEUE_JOINED == "match:specificQueueJoined"
        assert ServerEvent.MATCH_SPECIFIC_QUEUE_LEFT == "match:specificQueueLeft"
        assert ServerEvent.MATCH_QUEUE_INFO_RESPONSE == "match:queueInfoResponse"
        assert ServerEvent.MATCH_MY_QUEUES_RESPONSE == "match:myQueuesResponse"
        assert ServerEvent.MATCH_QUEUE_UPDATE == "match:queueUpdate"
        assert ServerEvent.MATCH_ERROR == "match:error"

    def test_room_server_events(self) -> None:
        assert ServerEvent.ROOM_JOINED == "room:joined"
        assert ServerEvent.ROOM_PLAYER_JOINED == "room:playerJoined"
        assert ServerEvent.ROOM_PLAYER_LEFT == "room:playerLeft"
        assert ServerEvent.ROOM_PLAYER_DISCONNECTED == "room:playerDisconnected"
        assert ServerEvent.ROOM_PLAYER_READY == "room:playerReady"
        assert ServerEvent.ROOM_GAME_STARTING == "room:gameStarting"
        assert ServerEvent.ROOM_GAME_STARTED == "room:gameStarted"
        assert ServerEvent.ROOM_HOST_CHANGED == "room:hostChanged"
        assert ServerEvent.ROOM_ACTIVE_ROOM_FOUND == "room:activeRoomFound"
        assert ServerEvent.ROOM_PLAYER_RECONNECTED == "room:playerReconnected"

    def test_game_server_events(self) -> None:
        assert ServerEvent.GAME_FULL_SYNC == "game:fullSync"
        assert ServerEvent.GAME_DELTA_SYNC == "game:deltaSync"
        assert ServerEvent.GAME_ACTION_RESULT == "game:actionResult"
        assert ServerEvent.GAME_ERROR == "game:error"

    def test_total_count(self) -> None:
        # 2 player + 11 match + 10 room + 4 game = 27
        assert len(list(ServerEvent)) == 27


def test_protocol_version() -> None:
    assert ProtocolVersion == "1.0.0"


class TestMessageModel:
    def test_serialize_with_payload_and_room_id(self) -> None:
        m = Message(type="match:found", payload={"roomId": "X"}, room_id="X")
        # by_alias=True to produce camelCase wire JSON
        wire = json.loads(m.model_dump_json(by_alias=True))
        assert wire == {"type": "match:found", "payload": {"roomId": "X"}, "roomId": "X"}

    def test_serialize_payload_none(self) -> None:
        m = Message(type="player:login")
        wire = json.loads(m.model_dump_json(by_alias=True))
        # payload defaults to None, serialized as null
        assert wire["payload"] is None
        assert wire["roomId"] is None
        assert wire["type"] == "player:login"

    def test_deserialize_camel_case(self) -> None:
        wire = '{"type": "match:found", "payload": {"roomId": "X"}, "roomId": "X"}'
        m = Message.model_validate_json(wire)
        assert m.type == "match:found"
        assert m.payload == {"roomId": "X"}
        assert m.room_id == "X"

    def test_deserialize_payload_missing(self) -> None:
        wire = '{"type": "player:login"}'
        m = Message.model_validate_json(wire)
        assert m.payload is None
        assert m.room_id is None

    def test_deserialize_room_id_empty_string(self) -> None:
        # backend uses roomId:"" sometimes
        wire = '{"type": "match:joinQueue", "payload": {"preferredCount": 4}, "roomId": ""}'
        m = Message.model_validate_json(wire)
        assert m.room_id == ""

    def test_extra_forbidden(self) -> None:
        with pytest.raises(ValidationError):
            Message.model_validate({"type": "x", "unexpected": "field"})

    def test_frozen_rejects_assignment(self) -> None:
        m = Message(type="x")
        with pytest.raises(ValidationError):
            m.type = "y"  # type: ignore[misc]


class TestPlayerInfo:
    def test_full_payload(self) -> None:
        wire = {
            "id": "p1",
            "userId": "qq:12345",
            "displayName": "Tester",
            "role": "player",
            "ready": True,
            "connected": True,
        }
        p = PlayerInfo.model_validate(wire)
        assert p.id == "p1"
        assert p.user_id == "qq:12345"
        assert p.display_name == "Tester"
        assert p.role == "player"
        assert p.ready is True
        assert p.connected is True

    def test_defaults_ready_and_connected_false(self) -> None:
        wire = {"id": "p1", "userId": "qq:1", "displayName": "X", "role": "player"}
        p = PlayerInfo.model_validate(wire)
        assert p.ready is False
        assert p.connected is False

    def test_extra_forbidden(self) -> None:
        with pytest.raises(ValidationError):
            PlayerInfo.model_validate(
                {"id": "p", "userId": "u", "displayName": "X", "role": "r", "extra": 1}
            )


class TestMatchmakingRequest:
    def test_default_game_mode_classic(self) -> None:
        r = MatchmakingRequest.model_validate({"preferredCount": 4})
        assert r.preferred_count == 4
        assert r.game_mode == "classic"

    def test_explicit_game_mode(self) -> None:
        r = MatchmakingRequest.model_validate(
            {"preferredCount": 5, "gameMode": "civilization_relics"}
        )
        assert r.game_mode == "civilization_relics"

    def test_wire_serialization_uses_camel_case(self) -> None:
        r = MatchmakingRequest(preferred_count=4, game_mode="classic")
        wire = json.loads(r.model_dump_json(by_alias=True))
        assert wire == {"preferredCount": 4, "gameMode": "classic"}


class TestMatchFoundPayload:
    SAMPLE = {
        "roomId": "ROOM-XYZ",
        "roomCode": "ROOM-XYZ",
        "hostId": "player-uuid-1",
        "players": [
            {
                "playerId": "player-uuid-1",
                "displayName": "Alice",
                "isHost": True,
                "playerNumber": 1,
                "position": 0,
            },
            {
                "playerId": "player-uuid-2",
                "displayName": "Bob",
                "isHost": False,
                "playerNumber": 2,
                "position": 1,
            },
        ],
        "isHost": True,
    }

    def test_parse_sample(self) -> None:
        p = MatchFoundPayload.model_validate(self.SAMPLE)
        assert p.room_id == "ROOM-XYZ"
        assert p.room_code == "ROOM-XYZ"
        assert p.host_id == "player-uuid-1"
        assert p.is_host is True
        assert len(p.players) == 2
        assert p.players[0].player_id == "player-uuid-1"
        assert p.players[0].is_host is True
        assert p.players[1].display_name == "Bob"
        assert p.players[1].player_number == 2

    def test_players_required(self) -> None:
        bad = {"roomId": "X", "roomCode": "X", "hostId": "h", "isHost": True}
        with pytest.raises(ValidationError):
            MatchFoundPayload.model_validate(bad)

    def test_player_extra_forbidden(self) -> None:
        bad = {
            "playerId": "p",
            "displayName": "X",
            "isHost": False,
            "playerNumber": 1,
            "position": 0,
            "extra": "field",
        }
        with pytest.raises(ValidationError):
            MatchPlayerInfo.model_validate(bad)


class TestRoomJoinedPayload:
    SAMPLE = {
        "roomId": "ROOM-XYZ",
        "roomCode": "ROOM-XYZ",
        "players": [
            {
                "playerId": "p1",
                "displayName": "Alice",
                "isHost": True,
                "playerNumber": 1,
                "position": 0,
                "ready": False,
                "connected": True,
            }
        ],
        "isHost": True,
    }

    def test_parse_sample(self) -> None:
        p = RoomJoinedPayload.model_validate(self.SAMPLE)
        assert p.room_id == "ROOM-XYZ"
        assert p.is_host is True
        assert p.players[0].player_id == "p1"
        assert p.players[0].ready is False
        assert p.players[0].connected is True

    def test_room_player_requires_ready_and_connected(self) -> None:
        bad = {
            "playerId": "p",
            "displayName": "X",
            "isHost": False,
            "playerNumber": 1,
            "position": 0,
        }
        with pytest.raises(ValidationError):
            RoomPlayer.model_validate(bad)


class TestErrorResponse:
    def test_parse(self) -> None:
        e = ErrorResponse.model_validate(
            {"code": "INVALID_COUNT", "message": "玩家数量必须在 3-5 之间"}
        )
        assert e.code == "INVALID_COUNT"
        assert "3-5" in e.message

    def test_extra_forbidden(self) -> None:
        with pytest.raises(ValidationError):
            ErrorResponse.model_validate({"code": "X", "message": "Y", "extra": 1})
