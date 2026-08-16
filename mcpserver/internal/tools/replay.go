package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

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

// buildReplayRowFromParts 从分离的 actions 与首/终帧构建 ReplayRow（新记录只存两帧）。
// 两帧为 AnalysisFrame 轻量帧（KB 级），替代全量 states[]（MB 级）。
func buildReplayRowFromParts(
	id, matchID, winner string,
	playerIDs, playerNames []string,
	actions []gamesdk.ActionRecord,
	totalTurns int,
	createdAt int64,
	initialFrame, finalFrame json.RawMessage,
) persistence.ReplayRow {
	pIDs, _ := json.Marshal(playerIDs)
	pNames, _ := json.Marshal(playerNames)
	actionsJSON, _ := json.Marshal(actions)
	states := []json.RawMessage{initialFrame, finalFrame}
	statesJSON, _ := json.Marshal(states)
	return persistence.ReplayRow{
		ID:          id,
		MatchID:     matchID,
		PlayerIDs:   string(pIDs),
		PlayerNames: string(pNames),
		ActionsJSON: string(actionsJSON),
		StatesJSON:  string(statesJSON),
		Winner:      winner,
		TotalTurns:  totalTurns,
		CreatedAt:   createdAt,
	}
}

// replayFetchingLocks 对正在拉取的 replayId 做进程内互斥，避免多个 driver/Agent
// 同时拉取同一回放产生重复 HTTP 请求。map 存 replayId → 该回放的细粒度锁；
// 外层大锁保护 map 并发读写。
var replayFetchingLocks = struct {
	sync.Mutex
	locks map[string]*sync.Mutex
}{
	locks: make(map[string]*sync.Mutex),
}

// acquireReplayLock 获取指定 replayId 的锁：先外层锁拿/创建细粒度锁，再加细粒度锁。
// 返回解锁函数。锁不删除：map 增长到一定大小就稳定，删除会频繁 alloc 且无收益。
func acquireReplayLock(replayID string) func() {
	replayFetchingLocks.Lock()
	defer replayFetchingLocks.Unlock()
	lock, ok := replayFetchingLocks.locks[replayID]
	if !ok {
		lock = &sync.Mutex{}
		replayFetchingLocks.locks[replayID] = lock
	}
	lock.Lock()
	return func() {
		lock.Unlock()
	}
}

// sessionlessReplayClient 为 stateless 回放拉取获取 HTTP client 实例。
// 从 manager 获取进程级共享的全局 HTTP client，不依赖任何账号/GameSession。
func sessionlessReplayClient(mgr *session.Manager) *gamesdk.HTTPClient {
	return mgr.HTTP()
}

// replayTrustToken 为 stateless 回放访问推导 trust 身份 token（即 X-Trust-User 头值）。
//
// 后端 trust 鉴权要求 `agent:<sid>` / `qq:<id>` 格式，纯 replayId（UUID）不含冒号
// 无法通过校验；而 replay 的 {id}/{frames}/{actions} 端点以 UUID 为 capability token，
// 只需"任意已登录用户"身份即可访问，不校验参与者。
//
// 因此：优先复用当前会话登记的 X-Agent-Sid（真实 agent 身份，drivers 批量路径），
// 会话未登记（如 disconnect 后 LLM Agent 复盘）则回退到共享占位身份
// `agent:replay-reader`（仅一个占位用户，避免按回放创建垃圾用户）。
func replayTrustToken(req *mcp.CallToolRequest, mgr *session.Manager) string {
	if sid := req.GetSession().ID(); sid != "" {
		if preferred := mgr.PreferredAccount(sid); preferred != "" {
			return "agent:" + preferred
		}
	}
	return "agent:replay-reader"
}

// tryFetchLightweight 尝试轻量拉取：GET /actions + GET /frames?frame=0/final。
// 只存 actions + 首/终帧（KB 级）。新端点不可用（老后端）时返回错误，调用方回退全量路径。
// token 为 trust 身份（X-Trust-User 值），stateless 路径由 replayTrustToken 推导。
func tryFetchLightweight(httpc *gamesdk.HTTPClient, token string, replayID string) (persistence.ReplayRow, error) {
	meta, err := httpc.GetReplayActions(token, replayID)
	if err != nil {
		return persistence.ReplayRow{}, err
	}
	initialFrame, err := httpc.GetReplayFrame(token, replayID, "0", "light")
	if err != nil {
		return persistence.ReplayRow{}, err
	}
	finalFrame, err := httpc.GetReplayFrame(token, replayID, "final", "light")
	if err != nil {
		return persistence.ReplayRow{}, err
	}
	return buildReplayRowFromParts(
		replayID,
		meta.MatchID,
		meta.Winner,
		meta.PlayerIDs,
		meta.PlayerNames,
		meta.Actions,
		meta.TotalTurns,
		meta.CreatedAt,
		initialFrame,
		finalFrame,
	), nil
}

// fetchLightweightWithRetry 按 replayId 轻量拉取，吸收"回放异步写库"的短暂竞态（同 fetchReplayWithRetry）。
func fetchLightweightWithRetry(httpc *gamesdk.HTTPClient, token string, replayID string) (persistence.ReplayRow, error) {
	const attempts = 10
	var lastErr error
	for i := 0; i < attempts; i++ {
		row, err := tryFetchLightweight(httpc, token, replayID)
		if err == nil {
			return row, nil
		}
		lastErr = err
		time.Sleep(300 * time.Millisecond)
	}
	return persistence.ReplayRow{}, lastErr
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
		replays, err := gs.HTTP.ListReplays(gs.AuthValue(), limit, in.Offset)
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
		httpc := sessionlessReplayClient(mgr)
		token := replayTrustToken(req, mgr)
		replay, err := httpc.GetReplay(token, in.ID)
		if err != nil {
			return nil, GetReplayOutput{}, fmt.Errorf("拉取回放失败: %w", err)
		}
		return nil, GetReplayOutput{Replay: replay}, nil
	}
}

// --- fetch_and_save_replay ---

type FetchAndSaveReplayInput struct {
	MatchID  string `json:"matchId,omitempty" jsonschema:"对局 ID;留空则使用最近一场对局(LastMatchId)"`
	ReplayID string `json:"replayId,omitempty" jsonschema:"回放 ID;GameOver 权威视图直接提供，优先级高于 matchId"`
}

type FetchAndSaveReplayOutput struct {
	Saved    bool   `json:"saved"`
	ReplayID string `json:"replayId,omitempty"`
	MatchID  string `json:"matchId,omitempty"`
	Message  string `json:"message,omitempty"`
}

func handleFetchAndSaveReplay(mgr *session.Manager, db *persistence.DB) func(context.Context, *mcp.CallToolRequest, FetchAndSaveReplayInput) (*mcp.CallToolResult, FetchAndSaveReplayOutput, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, in FetchAndSaveReplayInput) (*mcp.CallToolResult, FetchAndSaveReplayOutput, error) {
		// 优先级：ReplayID（GameOver 权威视图，stateless 主路径）> MatchID（需 session 参与者校验）> last from session
		var replayID string
		if in.ReplayID != "" {
			replayID = in.ReplayID
		} else {
			// matchId / last-from-session 路径依赖 session 参与者校验兜底，保持原有必须连接逻辑
			gs, err := mustConnect(req, mgr)
			if err != nil {
				return nil, FetchAndSaveReplayOutput{}, err
			}
			switch {
			case in.MatchID != "":
				replay, err := gs.HTTP.GetReplayByMatchID(gs.AuthValue(), in.MatchID)
				if err != nil {
					return nil, FetchAndSaveReplayOutput{}, fmt.Errorf("从游戏服务器拉取回放失败: %w", err)
				}
				gs.SetLastMatchID(replay.MatchID)
				replayID = replay.ID
			case gs.GetLastReplayID() != "":
				replayID = gs.GetLastReplayID()
			case gs.GetLastMatchID() != "":
				replay, err := gs.HTTP.GetReplayByMatchID(gs.AuthValue(), gs.GetLastMatchID())
				if err != nil {
					return nil, FetchAndSaveReplayOutput{}, fmt.Errorf("从游戏服务器拉取回放失败: %w", err)
				}
				replayID = replay.ID
			default:
				return nil, FetchAndSaveReplayOutput{Message: "未指定 replayId/matchId 且无最近对局回放记录(需先完成一局对局)"}, nil
			}
		}

		// 检查本地是否已有：已存在直接返回（幂等，避免重复拉取）
		existing, err := db.Replay.GetReplay(replayID)
		if err == nil && existing != nil {
			return nil, FetchAndSaveReplayOutput{
				Saved:    true,
				ReplayID: replayID,
				MatchID:  existing.MatchID,
			}, nil
		}

		// per-replayId 细粒度互斥：多个 driver 同时拉取同一回放只产生一次有效 HTTP
		unlock := acquireReplayLock(replayID)
		defer unlock()

		// double-check：锁拿到后可能已被其他协程写入
		existing, err = db.Replay.GetReplay(replayID)
		if err == nil && existing != nil {
			return nil, FetchAndSaveReplayOutput{
				Saved:    true,
				ReplayID: replayID,
				MatchID:  existing.MatchID,
			}, nil
		}

		httpc := sessionlessReplayClient(mgr)
		token := replayTrustToken(req, mgr)
		// 优先轻量路径（actions + 首/终帧，KB 级）；轻量不可用回退全量路径
		var row persistence.ReplayRow
		lw, lwErr := fetchLightweightWithRetry(httpc, token, replayID)
		if lwErr == nil {
			row = lw
		} else {
			replay, err := fetchReplayWithRetry(httpc, token, replayID)
			if err != nil {
				return nil, FetchAndSaveReplayOutput{}, fmt.Errorf("从游戏服务器拉取回放失败: %w", err)
			}
			row = buildReplayRow(replay)
		}

		if err := db.Replay.SaveReplay(row); err != nil {
			return nil, FetchAndSaveReplayOutput{}, fmt.Errorf("保存回放到本地失败: %w", err)
		}
		return nil, FetchAndSaveReplayOutput{
			Saved:    true,
			ReplayID: row.ID,
			MatchID:  row.MatchID,
		}, nil
	}
}

// fetchReplayWithRetry 按 replayId 拉取回放,吸收"回放异步写库"的短暂竞态:
// 后端在终局同步生成 replayId 并注入 ViewState,但落库在独立 goroutine,
// 客户端拿到 replayId 立即拉取可能短暂 404。此处做有界重试(约 3s)。
// token 为 trust 身份（X-Trust-User 值），stateless 路径由 replayTrustToken 推导。
func fetchReplayWithRetry(httpc *gamesdk.HTTPClient, token string, replayID string) (*gamesdk.Replay, error) {
	const attempts = 10
	var lastErr error
	for i := 0; i < attempts; i++ {
		replay, err := httpc.GetReplay(token, replayID)
		if err == nil {
			return replay, nil
		}
		lastErr = err
		time.Sleep(300 * time.Millisecond)
	}
	return nil, lastErr
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
		replayID := parseReplayID(in.ReplayID)
		if replayID == "" {
			return nil, FetchSharedReplayOutput{}, fmt.Errorf("无法从输入解析回放 ID: %q", in.ReplayID)
		}

		// 本地已存在直接返回
		existing, err := db.Replay.GetReplay(replayID)
		if err == nil && existing != nil {
			return nil, FetchSharedReplayOutput{
				Saved:       true,
				ReplayID:    replayID,
				MatchID:     existing.MatchID,
				PlayerNames: mustParsePlayerNames(existing.PlayerNames),
				TotalTurns:  existing.TotalTurns,
				Winner:      existing.Winner,
			}, nil
		}

		// 细粒度互斥
		unlock := acquireReplayLock(replayID)
		defer unlock()

		// double-check
		existing, err = db.Replay.GetReplay(replayID)
		if err == nil && existing != nil {
			return nil, FetchSharedReplayOutput{
				Saved:       true,
				ReplayID:    replayID,
				MatchID:     existing.MatchID,
				PlayerNames: mustParsePlayerNames(existing.PlayerNames),
				TotalTurns:  existing.TotalTurns,
				Winner:      existing.Winner,
			}, nil
		}

		httpc := sessionlessReplayClient(mgr)
		token := replayTrustToken(req, mgr)
		// 优先轻量路径（actions + 首/终帧，KB 级）；新端点不可用则回退全量路径
		var row persistence.ReplayRow
		lw, lwErr := tryFetchLightweight(httpc, token, replayID)
		if lwErr != nil {
			replay, err := fetchReplayWithRetry(httpc, token, replayID)
			if err != nil {
				return nil, FetchSharedReplayOutput{}, fmt.Errorf("从游戏服务器拉取分享回放失败: %w", err)
			}
			row = buildReplayRow(replay)
		} else {
			row = lw
		}

		if err := db.Replay.SaveReplay(row); err != nil {
			return nil, FetchSharedReplayOutput{}, fmt.Errorf("保存分享回放到本地失败: %w", err)
		}
		return nil, FetchSharedReplayOutput{
			Saved:       true,
			ReplayID:    replayID,
			MatchID:     row.MatchID,
			PlayerNames: mustParsePlayerNames(row.PlayerNames),
			TotalTurns:  row.TotalTurns,
			Winner:      row.Winner,
		}, nil
	}
}

// mustParsePlayerNames 解析 ReplayRow.PlayerNames（JSON 数组字符串）；失败返回 nil。
func mustParsePlayerNames(raw string) []string {
	var names []string
	_ = json.Unmarshal([]byte(raw), &names)
	return names
}

// --- get_replay_deltas ---

type GetReplayDeltasInput struct {
	ReplayID string `json:"replayId" jsonschema:"本地回放 ID"`
	FromTurn int    `json:"fromTurn,omitempty" jsonschema:"起始回合(默认 1)"`
	ToTurn   int    `json:"toTurn,omitempty" jsonschema:"结束回合(默认到最后一回合)"`
	Verbose  bool   `json:"verbose,omitempty" jsonschema:"是否包含完整 action Data(默认 false，精简输出)"`
}

type GetReplayDeltasOutput struct {
	ReplayID   string      `json:"replayId"`
	TotalTurns int         `json:"totalTurns"`
	FromTurn   int         `json:"fromTurn"`
	ToTurn     int         `json:"toTurn"`
	Deltas     []TurnDelta `json:"deltas"`
}

func handleGetReplayDeltas(mgr *session.Manager, db *persistence.DB) func(context.Context, *mcp.CallToolRequest, GetReplayDeltasInput) (*mcp.CallToolResult, GetReplayDeltasOutput, error) {
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
		var deltas []TurnDelta
		if isLightweightRecord(row) {
			// 新记录（仅首/终帧）：需经后端帧端点逐回合拉取轻量帧再计算 delta。
			// stateless：用全局 HTTP client + 占位身份，不借对战账户（避免占用冲突）。
			httpc := sessionlessReplayClient(mgr)
			token := replayReaderToken()
			deltas, err = computeLightDeltas(httpc, token, row, fromTurn, toTurn)
			if err != nil {
				return nil, GetReplayDeltasOutput{}, err
			}
		} else {
			deltas, err = computeDeltas(row, fromTurn, toTurn, in.Verbose)
			if err != nil {
				return nil, GetReplayDeltasOutput{}, err
			}
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
		&mcp.Tool{Name: "fetch_and_save_replay", Description: "从游戏服务器拉取指定 replayId/matchId 的回放并持久化到本地 SQLite。replayId 留空则回退 matchId / 最近一场对局。游戏结束后调用此工具保存回放（stateless，不占用账号；本地已存在则幂等返回）。"},
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
		handleGetReplayDeltas(mgr, db),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name: "get_replay_semantic_view",
			Description: "读取本地回放的指定回合，输出全知视角 OmniscientView（所有玩家手牌/抽牌堆/弃牌堆/飞行打击ETA/逐目标威胁全可见）。" +
				"入参 turn 同 get_replay_deltas 的玩家回合数（0=初始，1..TotalTurns=对应回合结束帧）。" +
				"Map-Reduce 的子Agent 在消费 get_replay_deltas 后按需对关键回合下钻本工具。未命中时请先调用 fetch_shared_replay。",
			OutputSchema: outputSchemaFor[GetReplaySemanticViewOutput](),
		},
		handleGetReplaySemanticView(mgr, db),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name: "get_turn_analysis",
			Description: "读取本地回放指定回合，分析该回合每动作的因果解释（预期效果 vs 实际效果），" +
				"标注无效动作（no-op）及其原因。用于深入理解\"有动作无效果\"等异常现象。",
			OutputSchema: outputSchemaFor[GetTurnAnalysisOutput](),
		},
		handleGetTurnAnalysis(mgr, db),
	)
}
