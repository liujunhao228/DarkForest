package gamesdk

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"

	"darkforest/mcpserver/internal/account"
)

// 默认 HTTP 重试退避序列(固定,避免抖动放大)。
var defaultRetryBackoffs = []time.Duration{
	200 * time.Millisecond,
	500 * time.Millisecond,
	1 * time.Second,
}

// HTTPClient 封装到游戏后端的 HTTP API。
type HTTPClient struct {
	baseURL  string
	http     *http.Client
	retryMax int             // HTTP 请求最大重试次数(网络错误与 5xx)
	circuit  *CircuitBreaker // 熔断器(可空)
}

// NewHTTPClient 创建 HTTP 客户端。
func NewHTTPClient(baseURL string) *HTTPClient {
	return &HTTPClient{
		baseURL:  baseURL,
		http:     &http.Client{Timeout: 15 * time.Second},
		retryMax: 3,
	}
}

// SetRetryMax 设置 HTTP 请求最大重试次数。
func (c *HTTPClient) SetRetryMax(n int) {
	if n >= 0 {
		c.retryMax = n
	}
}

// BaseURL 返回当前 HTTP 基址(构造后不可变,无需锁)。
func (c *HTTPClient) BaseURL() string {
	return c.baseURL
}

// SetCircuitBreaker 注入熔断器。
func (c *HTTPClient) SetCircuitBreaker(cb *CircuitBreaker) {
	c.circuit = cb
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

// do 执行 HTTP 请求,带重试(网络错误与 5xx)和熔断。
// 认证接口(Login/Register)因 token="" 不走熔断,避免登录失败连锁。
// 401 不在此处自动刷新(因 HTTPClient 共享,无法识别账户);由上层
// GameSession.EnsureConnected 在使用前预检查 token 过期时间刷新。
func (c *HTTPClient) do(method, path string, token string, body any) ([]byte, int, error) {
	// 熔断检查(仅对需要 token 的请求,即非认证接口)
	needCircuit := token != "" && c.circuit != nil
	if needCircuit {
		if !c.circuit.Allow() {
			return nil, http.StatusServiceUnavailable, fmt.Errorf("熔断器开启,请求被拒绝")
		}
	}

	var bodyBytes []byte
	if body != nil {
		var err error
		bodyBytes, err = json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("序列化请求体: %w", err)
		}
	}

	respBody, status, err := c.doOnce(method, path, token, bodyBytes)
	// 网络错误或 5xx:重试
	if err != nil || status >= 500 {
		retryMax := c.retryMax
		if retryMax > len(defaultRetryBackoffs) {
			retryMax = len(defaultRetryBackoffs)
		}
		for i := 0; i < retryMax; i++ {
			time.Sleep(defaultRetryBackoffs[i])
			respBody, status, err = c.doOnce(method, path, token, bodyBytes)
			if err == nil && status < 500 {
				break
			}
		}
	}
	// 记录熔断结果
	if needCircuit {
		if err != nil || status >= 500 {
			c.circuit.RecordFailure()
		} else {
			c.circuit.RecordSuccess()
		}
	}
	return respBody, status, err
}

// doOnce 执行单次 HTTP 请求,无重试。
func (c *HTTPClient) doOnce(method, path, token string, bodyBytes []byte) ([]byte, int, error) {
	var bodyReader io.Reader
	if bodyBytes != nil {
		bodyReader = bytes.NewReader(bodyBytes)
	}
	req, err := http.NewRequest(method, c.baseURL+path, bodyReader)
	if err != nil {
		return nil, 0, fmt.Errorf("构造请求: %w", err)
	}
	if bodyBytes != nil {
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

// parseJWTExpiry 解析 JWT token 的 exp 字段。
// JWT 格式: header.payload.signature,payload 是 base64url 编码的 JSON。
// 失败时返回错误,调用方应回退到保守的 24h。
func parseJWTExpiry(token string) (time.Time, error) {
	parts := bytes.SplitN([]byte(token), []byte("."), 3)
	if len(parts) != 3 {
		return time.Time{}, fmt.Errorf("invalid JWT format")
	}
	// base64url 解码 payload
	payload, err := base64.RawURLEncoding.DecodeString(string(parts[1]))
	if err != nil {
		// 尝试标准 base64
		payload, err = base64.StdEncoding.DecodeString(string(parts[1]))
		if err != nil {
			return time.Time{}, fmt.Errorf("decode payload: %w", err)
		}
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return time.Time{}, fmt.Errorf("parse claims: %w", err)
	}
	if claims.Exp == 0 {
		return time.Time{}, fmt.Errorf("no exp claim")
	}
	return time.Unix(claims.Exp, 0), nil
}

// expiryFromToken 优先用 JWT exp,失败回退到 24h。
func expiryFromToken(token string) time.Time {
	if exp, err := parseJWTExpiry(token); err == nil && exp.After(time.Now()) {
		return exp
	} else if err != nil {
		log.Printf("解析 JWT exp 失败,回退到 24h: %v", err)
	}
	return time.Now().Add(24 * time.Hour)
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
		ExpiresAt:   expiryFromToken(resp.Token), // 优先解析 JWT exp,失败回退 24h
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
		ExpiresAt:   expiryFromToken(resp.Token),
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
