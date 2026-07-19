package hub

import (
	"encoding/json"
)

const ProtocolVersion = "1.0.0"

type ClientEvent string
type ServerEvent string

const (
	// Player events
	EvtPlayerLogin  ClientEvent = "player:login"
	EvtPlayerLogout ClientEvent = "player:logout"

	// Matchmaking events
	EvtMatchJoinQueue          ClientEvent = "match:joinQueue"
	EvtMatchCancelQueue        ClientEvent = "match:cancelQueue"
	EvtMatchGetStatus          ClientEvent = "match:getStatus"
	EvtMatchJoinSpecificQueue  ClientEvent = "match:joinSpecificQueue"
	EvtMatchCreateQueue        ClientEvent = "match:createQueue"
	EvtMatchLeaveSpecificQueue ClientEvent = "match:leaveSpecificQueue"
	EvtMatchGetQueueInfo       ClientEvent = "match:getQueueInfo"
	EvtMatchGetMyQueues        ClientEvent = "match:getMyQueues"

	// Room events
	EvtRoomJoin  ClientEvent = "room:join"
	EvtRoomLeave ClientEvent = "room:leave"
	EvtRoomReady ClientEvent = "room:ready"

	// Game events
	EvtGameAction       ClientEvent = "game:action"
	EvtGameCancelAction ClientEvent = "game:cancelAction"
	EvtGameRequestSync  ClientEvent = "game:requestSync"
	EvtGameAckState     ClientEvent = "game:ackState"
)

const (
	// Player server events
	EvtSrvPlayerLoginSuccess ServerEvent = "player:loginSuccess"
	EvtSrvPlayerLoginError   ServerEvent = "player:loginError"

	// Matchmaking server events
	EvtSrvMatchQueueJoined       ServerEvent = "match:queueJoined"
	EvtSrvMatchQueueCancelled    ServerEvent = "match:queueCancelled"
	EvtSrvMatchQueueStatus       ServerEvent = "match:queueStatus"
	EvtSrvMatchFound             ServerEvent = "match:found"
	EvtSrvMatchQueueCreated      ServerEvent = "match:queueCreated"
	EvtSrvMatchSpecificQueueJoin ServerEvent = "match:specificQueueJoined"
	EvtSrvMatchSpecificQueueLeft ServerEvent = "match:specificQueueLeft"
	EvtSrvMatchQueueInfoResp     ServerEvent = "match:queueInfoResponse"
	EvtSrvMatchMyQueuesResp      ServerEvent = "match:myQueuesResponse"
	EvtSrvMatchQueueUpdate       ServerEvent = "match:queueUpdate"
	EvtSrvMatchError             ServerEvent = "match:error"

	// Room server events
	EvtSrvRoomJoined             ServerEvent = "room:joined"
	EvtSrvRoomPlayerJoined       ServerEvent = "room:playerJoined"
	EvtSrvRoomPlayerLeft         ServerEvent = "room:playerLeft"
	EvtSrvRoomPlayerDisconnected ServerEvent = "room:playerDisconnected"
	EvtSrvRoomPlayerReady        ServerEvent = "room:playerReady"
	EvtSrvRoomGameStarting       ServerEvent = "room:gameStarting"
	EvtSrvRoomGameStarted        ServerEvent = "room:gameStarted"
	EvtSrvRoomHostChanged        ServerEvent = "room:hostChanged"

	// Game server events
	EvtSrvGameFullSync      ServerEvent = "game:fullSync"
	EvtSrvGameActionResult  ServerEvent = "game:actionResult"
	EvtSrvGameError         ServerEvent = "game:error"
)

// Message is the base structure for all websocket messages
type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
	RoomID  string          `json:"roomId,omitempty"`
}

// PlayerInfo contains player identity info
type PlayerInfo struct {
	ID          string `json:"id"`
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Ready       bool   `json:"ready"`
	Connected   bool   `json:"connected"`
}

// LoginRequest is the client login message
type LoginRequest struct {
	Token string `json:"token"`
}

// MatchmakingRequest is for joinQueue/cancelQueue
type MatchmakingRequest struct {
	PreferredCount int    `json:"preferredCount"`
	GameMode       string `json:"gameMode,omitempty"`
}

// RoomJoinRequest is for joining a specific room
type RoomJoinRequest struct {
	RoomID string `json:"roomId"`
}

// GameActionRequest wraps a generic game action
type GameActionRequest struct {
	Action string          `json:"action"`
	Data   json.RawMessage `json:"data"`
}

// UnmarshalJSON supports both legacy "data" and frontend "payload" keys.
func (r *GameActionRequest) UnmarshalJSON(b []byte) error {
	type alias GameActionRequest
	var raw struct {
		*alias
		Payload json.RawMessage `json:"payload"`
	}
	raw.alias = (*alias)(r)
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	if r.Data == nil && raw.Payload != nil {
		r.Data = raw.Payload
	}
	return nil
}

// ErrorResponse is a generic error message
type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
