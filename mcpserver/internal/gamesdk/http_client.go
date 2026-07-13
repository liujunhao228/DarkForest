package gamesdk

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"darkforest/mcpserver/internal/account"
)

// HTTPClient 封装到游戏后端的 HTTP API。
type HTTPClient struct {
	baseURL string
	http    *http.Client
}

// NewHTTPClient 创建 HTTP 客户端。
func NewHTTPClient(baseURL string) *HTTPClient {
	return &HTTPClient{
		baseURL: baseURL,
		http: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// AuthResponse 是登录/注册的响应。
type AuthResponse struct {
	Success bool     `json:"success"`
	Token   string   `json:"token"`
	Player  Player   `json:"player"`
	Error   string   `json:"error,omitempty"`
}

// Player 是游戏玩家。
type Player struct {
	ID          string `json:"id"`
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Avatar      int    `json:"avatar"`
	Wins        int    `json:"wins"`
	Losses      int    `json:"losses"`
	Draws       int    `json:"draws"`
	TotalMatches int   `json:"totalMatches"`
	CreatedAt   string `json:"createdAt"`
}

// Invitation 是邀请码。
type Invitation struct {
	ID        string `json:"id"`
	Code      string `json:"code"`
	CreatedBy string `json:"createdBy"`
	IsUsed    bool   `json:"isUsed"`
}

// CreateInviteResponse 是生成邀请码的响应。
type CreateInviteResponse struct {
	Success    bool       `json:"success"`
	Invitation Invitation `json:"invitation"`
	Error      string     `json:"error,omitempty"`
}

// ListInvitesResponse 是邀请码列表的响应。
type ListInvitesResponse struct {
	Success     bool         `json:"success"`
	Invitations []Invitation `json:"invitations"`
	Error       string       `json:"error,omitempty"`
}

// PlayerStats 是玩家战绩统计。
type PlayerStats struct {
	PlayerID     string `json:"playerId"`
	DisplayName  string `json:"displayName"`
	Wins         int    `json:"wins"`
	Losses       int    `json:"losses"`
	Draws        int    `json:"draws"`
	TotalMatches int    `json:"totalMatches"`
	WinRate      string `json:"winRate"`
	LossRate     string `json:"lossRate"`
	DrawRate     string `json:"drawRate"`
}

// StatsResponse 是战绩统计响应。
type StatsResponse struct {
	Success bool        `json:"success"`
	Stats   PlayerStats `json:"stats"`
	Error   string      `json:"error,omitempty"`
}

// LeaderboardEntry 是排行榜条目。
type LeaderboardEntry struct {
	Rank         int    `json:"rank"`
	ID           string `json:"id"`
	DisplayName  string `json:"displayName"`
	Wins         int    `json:"wins"`
	TotalMatches int    `json:"totalMatches"`
	WinRate      string `json:"winRate"`
}

// LeaderboardResponse 是排行榜响应。
type LeaderboardResponse struct {
	Success     bool               `json:"success"`
	Leaderboard []LeaderboardEntry `json:"leaderboard"`
	Error       string             `json:"error,omitempty"`
}

// PlayerResponse 是玩家信息响应。
type PlayerResponse struct {
	Success bool   `json:"success"`
	Player  Player `json:"player"`
	Error   string `json:"error,omitempty"`
}

// ReplayListItem 是回放列表项。
type ReplayListItem struct {
	ID          string   `json:"id"`
	MatchID     string   `json:"matchId"`
	PlayerIDs   []string `json:"playerIds"`
	PlayerNames []string `json:"playerNames"`
	ActionCount int      `json:"actionCount"`
	Winner      string   `json:"winner,omitempty"`
	TotalTurns  int      `json:"totalTurns"`
	CreatedAt   int64    `json:"createdAt"`
}

// ListReplaysResponse 是回放列表响应。
type ListReplaysResponse struct {
	Replays []ReplayListItem `json:"replays"`
}

// ActionRecord 是回放中的动作记录。
type ActionRecord struct {
	PlayerID  string                 `json:"playerId"`
	Action    string                 `json:"action"`
	Data      map[string]interface{} `json:"data"`
	Turn      int                    `json:"turn"`
	Timestamp int64                  `json:"timestamp"`
}

// Replay 是完整回放。
type Replay struct {
	ID          string          `json:"id"`
	MatchID     string          `json:"matchId"`
	PlayerIDs   []string        `json:"playerIds"`
	PlayerNames []string        `json:"playerNames"`
	Actions     []ActionRecord  `json:"actions"`
	States      json.RawMessage `json:"states"`
	Winner      string          `json:"winner,omitempty"`
	TotalTurns  int             `json:"totalTurns"`
	CreatedAt   int64           `json:"createdAt"`
}

// HealthResponse 是健康检查响应。
type HealthResponse struct {
	Status    string `json:"status"`
	Version   string `json:"version"`
	Timestamp string `json:"timestamp"`
	Uptime    int64  `json:"uptime"`
}

// --- 内部请求辅助 ---

func (c *HTTPClient) do(method, path string, token string, body any) ([]byte, int, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("序列化请求体: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, c.baseURL+path, bodyReader)
	if err != nil {
		return nil, 0, fmt.Errorf("构造请求: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("HTTP 请求失败: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("读取响应: %w", err)
	}
	return respBody, resp.StatusCode, nil
}

func (c *HTTPClient) doJSON(method, path string, token string, body any, out any) error {
	respBody, status, err := c.do(method, path, token, body)
	if err != nil {
		return err
	}
	if status >= 400 {
		return fmt.Errorf("HTTP %d: %s", status, string(respBody))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(respBody, out); err != nil {
		return fmt.Errorf("解析响应 JSON: %w (body: %s)", err, string(respBody))
	}
	return nil
}

// --- 认证 API ---

// Register 调用 POST /api/auth/register。
func (c *HTTPClient) Register(displayName, password, inviteCode string) (*account.AuthResult, error) {
	reqBody := map[string]string{
		"displayName": displayName,
		"password":    password,
		"inviteCode":  inviteCode,
	}
	var resp AuthResponse
	if err := c.doJSON("POST", "/api/auth/register", "", reqBody, &resp); err != nil {
		return nil, err
	}
	if !resp.Success {
		return nil, fmt.Errorf("注册失败: %s", resp.Error)
	}
	return &account.AuthResult{
		Token:       resp.Token,
		PlayerID:    resp.Player.ID,
		DisplayName: resp.Player.DisplayName,
		Role:        resp.Player.Role,
		ExpiresAt:   time.Now().Add(24 * time.Hour), // 后端 JWT 24h 有效期
	}, nil
}

// Login 调用 POST /api/auth/login。
func (c *HTTPClient) Login(displayName, password string) (*account.AuthResult, error) {
	reqBody := map[string]string{
		"displayName": displayName,
		"password":    password,
	}
	var resp AuthResponse
	if err := c.doJSON("POST", "/api/auth/login", "", reqBody, &resp); err != nil {
		return nil, err
	}
	if !resp.Success {
		return nil, fmt.Errorf("登录失败: %s", resp.Error)
	}
	return &account.AuthResult{
		Token:       resp.Token,
		PlayerID:    resp.Player.ID,
		DisplayName: resp.Player.DisplayName,
		Role:        resp.Player.Role,
		ExpiresAt:   time.Now().Add(24 * time.Hour),
	}, nil
}

// CreateInvite 调用 POST /api/auth/invite(需 admin token),返回邀请码。
func (c *HTTPClient) CreateInvite(adminToken string) (string, error) {
	var resp CreateInviteResponse
	if err := c.doJSON("POST", "/api/auth/invite", adminToken, struct{}{}, &resp); err != nil {
		return "", err
	}
	if !resp.Success {
		return "", fmt.Errorf("生成邀请码失败: %s", resp.Error)
	}
	return resp.Invitation.Code, nil
}

// --- 玩家 API ---

// GetMe 调用 GET /api/player/me。
func (c *HTTPClient) GetMe(token string) (*Player, error) {
	var resp PlayerResponse
	if err := c.doJSON("GET", "/api/player/me", token, nil, &resp); err != nil {
		return nil, err
	}
	if !resp.Success {
		return nil, fmt.Errorf("获取玩家信息失败: %s", resp.Error)
	}
	return &resp.Player, nil
}

// GetPlayerStats 调用 GET /api/player-stats/{id}。
func (c *HTTPClient) GetPlayerStats(token, playerID string) (*PlayerStats, error) {
	var resp StatsResponse
	if err := c.doJSON("GET", "/api/player-stats/"+url.PathEscape(playerID), token, nil, &resp); err != nil {
		return nil, err
	}
	if !resp.Success {
		return nil, fmt.Errorf("获取战绩失败: %s", resp.Error)
	}
	return &resp.Stats, nil
}

// GetLeaderboard 调用 GET /api/leaderboard。
func (c *HTTPClient) GetLeaderboard(token string) ([]LeaderboardEntry, error) {
	var resp LeaderboardResponse
	if err := c.doJSON("GET", "/api/leaderboard", token, nil, &resp); err != nil {
		return nil, err
	}
	if !resp.Success {
		return nil, fmt.Errorf("获取排行榜失败: %s", resp.Error)
	}
	return resp.Leaderboard, nil
}

// --- 回放 API ---

// ListReplays 调用 GET /api/replay/list。
func (c *HTTPClient) ListReplays(token string, limit, offset int) ([]ReplayListItem, error) {
	path := fmt.Sprintf("/api/replay/list?limit=%d&offset=%d", limit, offset)
	var resp ListReplaysResponse
	if err := c.doJSON("GET", path, token, nil, &resp); err != nil {
		return nil, err
	}
	return resp.Replays, nil
}

// GetReplay 调用 GET /api/replay/{id}。
func (c *HTTPClient) GetReplay(token, id string) (*Replay, error) {
	var resp Replay
	if err := c.doJSON("GET", "/api/replay/"+url.PathEscape(id), token, nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetReplayByMatchID 调用 GET /api/replay/match/{matchId}。
func (c *HTTPClient) GetReplayByMatchID(token, matchID string) (*Replay, error) {
	var resp Replay
	if err := c.doJSON("GET", "/api/replay/match/"+url.PathEscape(matchID), token, nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// --- 健康检查 ---

// Health 调用 GET /api/health。
func (c *HTTPClient) Health() (*HealthResponse, error) {
	var resp HealthResponse
	if err := c.doJSON("GET", "/api/health", "", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}
