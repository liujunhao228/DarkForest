package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/persistence"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// parseReplayID 从用户输入解析回放 ID。
// 支持裸 UUID、/replay/{id} 路径、完整 URL。无法提取时返回空串。
func parseReplayID(input string) string {
	s := strings.TrimSpace(input)
	if s == "" {
		return ""
	}
	// 匹配 /replay/{id} 片段
	if idx := strings.Index(s, "/replay/"); idx >= 0 {
		rest := s[idx+len("/replay/"):]
		// 截断到第一个 / ? # 之前
		for _, c := range []string{"/", "?", "#"} {
			if i := strings.Index(rest, c); i >= 0 {
				rest = rest[:i]
			}
		}
		if rest != "" {
			return rest
		}
	}
	// 否则视为裸 UUID（非空且无空格/斜杠）
	if !strings.ContainsAny(s, " /") {
		return s
	}
	return ""
}

// buildReplayRow 将 gamesdk.Replay 转换为本地持久化的 ReplayRow。
func buildReplayRow(replay *gamesdk.Replay) persistence.ReplayRow {
	playerIDs, _ := json.Marshal(replay.PlayerIDs)
	playerNames, _ := json.Marshal(replay.PlayerNames)
	actionsJSON, _ := json.Marshal(replay.Actions)
	return persistence.ReplayRow{
		ID:          replay.ID,
		MatchID:     replay.MatchID,
		PlayerIDs:   string(playerIDs),
		PlayerNames: string(playerNames),
		ActionsJSON: string(actionsJSON),
		StatesJSON:  string(replay.States),
		Winner:      replay.Winner,
		TotalTurns:  replay.TotalTurns,
		CreatedAt:   replay.CreatedAt,
	}
}

// --- list_my_replays ---

type ListMyReplaysInput struct {
	Limit  int `json:"limit,omitempty" jsonschema:"每页数量(默认 20)"`
	Offset int `json:"offset,omitempty" jsonschema:"偏移量"`
}

type ListMyReplaysOutput struct {
	Replays []gamesdk.ReplayListItem `json:"replays"`
}

func handleListMyReplays(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, ListMyReplaysInput) (*mcp.CallToolResult, ListMyReplaysOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in ListMyReplaysInput) (*mcp.CallToolResult, ListMyReplaysOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, ListMyReplaysOutput{}, err
		}
		limit := in.Limit
		if limit <= 0 {
			limit = 20
		}
		replays, err := gs.HTTP.ListReplays(gs.Account.Token, limit, in.Offset)
		if err != nil {
			return nil, ListMyReplaysOutput{}, fmt.Errorf("拉取回放列表失败: %w", err)
		}
		return nil, ListMyReplaysOutput{Replays: replays}, nil
	}
}

// --- get_replay ---

type GetReplayInput struct {
	ID string `json:"id" jsonschema:"回放 ID"`
}

type GetReplayOutput struct {
	Replay *gamesdk.Replay `json:"replay"`
}

func handleGetReplay(mgr *session.Manager) func(context.Context, *mcp.CallToolRequest, GetReplayInput) (*mcp.CallToolResult, GetReplayOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in GetReplayInput) (*mcp.CallToolResult, GetReplayOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, GetReplayOutput{}, err
		}
		replay, err := gs.HTTP.GetReplay(gs.Account.Token, in.ID)
		if err != nil {
			return nil, GetReplayOutput{}, fmt.Errorf("拉取回放失败: %w", err)
		}
		return nil, GetReplayOutput{Replay: replay}, nil
	}
}

// --- fetch_and_save_replay ---

type FetchAndSaveReplayInput struct {
	MatchID string `json:"matchId" jsonschema:"对局 ID;留空则使用最近一场对局"`
}

type FetchAndSaveReplayOutput struct {
	Saved     bool   `json:"saved"`
	ReplayID  string `json:"replayId,omitempty"`
	MatchID   string `json:"matchId,omitempty"`
	Message   string `json:"message,omitempty"`
}

func handleFetchAndSaveReplay(mgr *session.Manager, db *persistence.DB) func(context.Context, *mcp.CallToolRequest, FetchAndSaveReplayInput) (*mcp.CallToolResult, FetchAndSaveReplayOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in FetchAndSaveReplayInput) (*mcp.CallToolResult, FetchAndSaveReplayOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, FetchAndSaveReplayOutput{}, err
		}
		matchID := in.MatchID
		if matchID == "" {
			matchID = gs.GetLastMatchID()
			if matchID == "" {
				return nil, FetchAndSaveReplayOutput{Message: "未指定 matchId 且无最近对局记录"}, nil
			}
		}
		replay, err := gs.HTTP.GetReplayByMatchID(gs.Account.Token, matchID)
		if err != nil {
			return nil, FetchAndSaveReplayOutput{}, fmt.Errorf("从游戏服务器拉取回放失败: %w", err)
		}
		row := buildReplayRow(replay)
		if err := db.Replay.SaveReplay(row); err != nil {
			return nil, FetchAndSaveReplayOutput{}, fmt.Errorf("保存回放到本地失败: %w", err)
		}
		return nil, FetchAndSaveReplayOutput{
			Saved:    true,
			ReplayID: replay.ID,
			MatchID:  replay.MatchID,
		}, nil
	}
}

// --- list_local_replays ---

type ListLocalReplaysInput struct {
	Limit  int `json:"limit,omitempty" jsonschema:"每页数量(默认 20)"`
	Offset int `json:"offset,omitempty" jsonschema:"偏移量"`
}

type ListLocalReplaysOutput struct {
	Replays []persistence.ReplayListItem `json:"replays"`
}

func handleListLocalReplays(db *persistence.DB) func(context.Context, *mcp.CallToolRequest, ListLocalReplaysInput) (*mcp.CallToolResult, ListLocalReplaysOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in ListLocalReplaysInput) (*mcp.CallToolResult, ListLocalReplaysOutput, error) {
		limit := in.Limit
		if limit <= 0 {
			limit = 20
		}
		replays, err := db.Replay.ListReplays(limit, in.Offset)
		if err != nil {
			return nil, ListLocalReplaysOutput{}, fmt.Errorf("查询本地回放失败: %w", err)
		}
		return nil, ListLocalReplaysOutput{Replays: replays}, nil
	}
}

// --- get_local_replay ---

type GetLocalReplayInput struct {
	ID string `json:"id" jsonschema:"本地回放 ID"`
}

type GetLocalReplayOutput struct {
	Found  bool            `json:"found"`
	Replay json.RawMessage `json:"replay,omitempty"`
}

func handleGetLocalReplay(db *persistence.DB) func(context.Context, *mcp.CallToolRequest, GetLocalReplayInput) (*mcp.CallToolResult, GetLocalReplayOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in GetLocalReplayInput) (*mcp.CallToolResult, GetLocalReplayOutput, error) {
		row, err := db.Replay.GetReplay(in.ID)
		if err != nil {
			return nil, GetLocalReplayOutput{}, fmt.Errorf("查询本地回放失败: %w", err)
		}
		if row == nil {
			return nil, GetLocalReplayOutput{Found: false}, nil
		}
		// 构建完整回放 JSON
		var playerIDs, playerNames []string
		_ = json.Unmarshal([]byte(row.PlayerIDs), &playerIDs)
		_ = json.Unmarshal([]byte(row.PlayerNames), &playerNames)
		var actions json.RawMessage
		if row.ActionsJSON != "" {
			actions = json.RawMessage(row.ActionsJSON)
		}
		var states json.RawMessage
		if row.StatesJSON != "" {
			states = json.RawMessage(row.StatesJSON)
		}
		result := map[string]any{
			"id":          row.ID,
			"matchId":     row.MatchID,
			"playerIds":   playerIDs,
			"playerNames": playerNames,
			"actions":     actions,
			"states":      states,
			"winner":      row.Winner,
			"totalTurns":  row.TotalTurns,
			"createdAt":   row.CreatedAt,
			"fetchedAt":   row.FetchedAt,
		}
		data, _ := json.Marshal(result)
		return nil, GetLocalReplayOutput{Found: true, Replay: data}, nil
	}
}

// --- fetch_shared_replay ---

type FetchSharedReplayInput struct {
	ReplayID string `json:"replayId" jsonschema:"分享回放 ID 或分享链接(支持裸 UUID、/replay/{id} 路径、完整 URL)"`
}

type FetchSharedReplayOutput struct {
	Saved       bool     `json:"saved"`
	ReplayID    string   `json:"replayId,omitempty"`
	MatchID     string   `json:"matchId,omitempty"`
	PlayerNames []string `json:"playerNames,omitempty"`
	TotalTurns  int      `json:"totalTurns,omitempty"`
	Winner      string   `json:"winner,omitempty"`
	Message     string   `json:"message,omitempty"`
}

func handleFetchSharedReplay(mgr *session.Manager, db *persistence.DB) func(context.Context, *mcp.CallToolRequest, FetchSharedReplayInput) (*mcp.CallToolResult, FetchSharedReplayOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in FetchSharedReplayInput) (*mcp.CallToolResult, FetchSharedReplayOutput, error) {
		gs, err := mustConnect(req, mgr)
		if err != nil {
			return nil, FetchSharedReplayOutput{}, err
		}
		replayID := parseReplayID(in.ReplayID)
		if replayID == "" {
			return nil, FetchSharedReplayOutput{}, fmt.Errorf("无法从输入解析回放 ID: %q", in.ReplayID)
		}
		replay, err := gs.HTTP.GetReplay(gs.Account.Token, replayID)
		if err != nil {
			return nil, FetchSharedReplayOutput{}, fmt.Errorf("从游戏服务器拉取分享回放失败: %w", err)
		}
		row := buildReplayRow(replay)
		if err := db.Replay.SaveReplay(row); err != nil {
			return nil, FetchSharedReplayOutput{}, fmt.Errorf("保存分享回放到本地失败: %w", err)
		}
		return nil, FetchSharedReplayOutput{
			Saved:       true,
			ReplayID:    replay.ID,
			MatchID:     replay.MatchID,
			PlayerNames: replay.PlayerNames,
			TotalTurns:  replay.TotalTurns,
			Winner:      replay.Winner,
		}, nil
	}
}

// --- get_replay_deltas ---

type GetReplayDeltasInput struct {
	ReplayID string `json:"replayId" jsonschema:"本地回放 ID"`
	FromTurn int    `json:"fromTurn,omitempty" jsonschema:"起始回合(默认 1)"`
	ToTurn   int    `json:"toTurn,omitempty" jsonschema:"结束回合(默认到最后一回合)"`
}

type GetReplayDeltasOutput struct {
	ReplayID   string      `json:"replayId"`
	TotalTurns int         `json:"totalTurns"`
	FromTurn   int         `json:"fromTurn"`
	ToTurn     int         `json:"toTurn"`
	Deltas     []TurnDelta `json:"deltas"`
}

func handleGetReplayDeltas(db *persistence.DB) func(context.Context, *mcp.CallToolRequest, GetReplayDeltasInput) (*mcp.CallToolResult, GetReplayDeltasOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in GetReplayDeltasInput) (*mcp.CallToolResult, GetReplayDeltasOutput, error) {
		row, err := db.Replay.GetReplay(in.ReplayID)
		if err != nil {
			return nil, GetReplayDeltasOutput{}, fmt.Errorf("查询本地回放失败: %w", err)
		}
		if row == nil {
			return nil, GetReplayDeltasOutput{}, fmt.Errorf("回放 %q 未在本地找到，请先调用 fetch_shared_replay 拉取", in.ReplayID)
		}
		fromTurn := in.FromTurn
		if fromTurn <= 0 {
			fromTurn = 1
		}
		toTurn := in.ToTurn
		if toTurn <= 0 {
			toTurn = row.TotalTurns
		}
		deltas, err := computeDeltas(row, fromTurn, toTurn)
		if err != nil {
			return nil, GetReplayDeltasOutput{}, err
		}
		return nil, GetReplayDeltasOutput{
			ReplayID:   row.ID,
			TotalTurns: row.TotalTurns,
			FromTurn:   fromTurn,
			ToTurn:     toTurn,
			Deltas:     deltas,
		}, nil
	}
}

// RegisterReplayTools 注册回放类工具。
func RegisterReplayTools(server *mcp.Server, mgr *session.Manager, db *persistence.DB) {
	mcp.AddTool(server,
		&mcp.Tool{Name: "list_my_replays", Description: "从游戏服务器拉取当前账户的回放列表(不含 states/actions 大字段)。"},
		handleListMyReplays(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name:         "get_replay",
			Description:  "从游戏服务器拉取完整回放(含 states 快照数组)。",
			OutputSchema: outputSchemaFor[GetReplayOutput](),
		},
		handleGetReplay(mgr),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "fetch_and_save_replay", Description: "从游戏服务器拉取指定 matchId 的回放并持久化到本地 SQLite。matchId 留空则使用最近一场对局。游戏结束后调用此工具保存回放。"},
		handleFetchAndSaveReplay(mgr, db),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "list_local_replays", Description: "列出本地已持久化的回放列表。"},
		handleListLocalReplays(db),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name:         "get_local_replay",
			Description:  "获取本地持久化的完整回放(含 states 快照数组)。",
			OutputSchema: outputSchemaFor[GetLocalReplayOutput](),
		},
		handleGetLocalReplay(db),
	)
	mcp.AddTool(server,
		&mcp.Tool{Name: "fetch_shared_replay", Description: "通过分享回放 ID 或分享链接(裸 UUID、/replay/{id}、完整 URL)从游戏服务器拉取任意回放并持久化到本地 SQLite。利用后端 UUID 即能力令牌策略，可拉取非本人参与的对局。"},
		handleFetchSharedReplay(mgr, db),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name:         "get_replay_deltas",
			Description:  "读取本地已持久化的回放，按回合输出 delta(该回合动作列表 + 回合结束状态相对上一回合结束的关键差异)，供逐回合分析。未命中时请先调用 fetch_shared_replay。",
			OutputSchema: outputSchemaFor[GetReplayDeltasOutput](),
		},
		handleGetReplayDeltas(db),
	)
}
