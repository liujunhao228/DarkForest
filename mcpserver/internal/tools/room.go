package tools

import (
	"context"
	"fmt"

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
}

// 确保引入 fmt(避免未使用导入,若后续移除 fmt 使用处则删此行)
var _ = fmt.Sprintf
