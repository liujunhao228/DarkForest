package tools

import (
	"context"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// --- get_room_info ---

type GetRoomInfoInput struct{}

type GetRoomInfoOutput struct {
	InRoom    bool                        `json:"inRoom"`
	RoomID    string                      `json:"roomId,omitempty"`
	RoomCode  string                      `json:"roomCode,omitempty"`
	RoomInfo  *gamesdk.RoomJoinedResponse `json:"roomInfo,omitempty"`
	MatchInfo *gamesdk.MatchFoundResponse `json:"matchInfo,omitempty"`
}

func handleGetRoomInfo(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetRoomInfoInput) (*mcp.CallToolResult, GetRoomInfoOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ GetRoomInfoInput) (*mcp.CallToolResult, GetRoomInfoOutput, error) {
		gs, err := sessionFromReq(req, mgr)
		if err != nil {
			return nil, GetRoomInfoOutput{}, err
		}
		rid, rcode, rinfo := gs.GetRoomInfo()
		if rid == "" {
			return nil, GetRoomInfoOutput{InRoom: false}, nil
		}
		return nil, GetRoomInfoOutput{
			InRoom:    true,
			RoomID:    rid,
			RoomCode:  rcode,
			RoomInfo:  rinfo,
			MatchInfo: gs.GetMatchInfo(),
		}, nil
	}
}

// --- leave_room ---

type LeaveRoomInput struct{}

type LeaveRoomOutput struct {
	Left bool `json:"left"`
}

func handleLeaveRoom(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, LeaveRoomInput) (*mcp.CallToolResult, LeaveRoomOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, _ LeaveRoomInput) (*mcp.CallToolResult, LeaveRoomOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, LeaveRoomOutput{}, err
		}
		if err := gs.SendRaw(gamesdk.EventRoomLeave, nil); err != nil {
			return nil, LeaveRoomOutput{}, err
		}
		return nil, LeaveRoomOutput{Left: true}, nil
	}
}

// --- rejoin_room ---

type RejoinRoomInput struct {
	RoomID string `json:"roomId,omitempty" jsonschema:"目标房间 ID。留空则使用会话记录的最近房间(需已收到 room:activeRoomFound)"`
}

type RejoinRoomOutput struct {
	Rejoined bool   `json:"rejoined"`
	RoomID   string `json:"roomId,omitempty"`
}

func handleRejoinRoom(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, RejoinRoomInput) (*mcp.CallToolResult, RejoinRoomOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in RejoinRoomInput) (*mcp.CallToolResult, RejoinRoomOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, RejoinRoomOutput{}, err
		}
		if err := gs.RejoinRoom(in.RoomID); err != nil {
			return nil, RejoinRoomOutput{}, err
		}
		rid, _, _ := gs.GetRoomInfo()
		return nil, RejoinRoomOutput{Rejoined: true, RoomID: rid}, nil
	}
}

// RegisterRoomTools 注册房间类工具。
func RegisterRoomTools(server *mcp.Server, mgr *session.Manager) {
	mcp.AddTool(server,
		&mcp.Tool{Name: "get_room_info", Description: "查询当前房间状态(玩家列表、房主、倒计时等)。"},
		handleGetRoomInfo(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "leave_room", Description: "离开当前房间。"},
		handleLeaveRoom(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name:         "rejoin_room",
			Description:  "重连到进行中的对局(断线重连场景)。需先收到 room:activeRoomFound 事件(会话已记录最近房间)或显式传入 roomId。重连后自动请求全量状态同步,可随后调用 get_agent_view 复核最新状态。",
			OutputSchema: outputSchemaFor[RejoinRoomOutput](),
		},
		handleRejoinRoom(mgr),
	)
}
