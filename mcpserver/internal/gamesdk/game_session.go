package gamesdk

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"darkforest/mcpserver/internal/account"
	"github.com/google/uuid"
)

// ActionTimeout 是 game:action 的等待超时,对齐前端策略(10s)。
const ActionTimeout = 10 * time.Second

// EventQueueSize 是事件队列缓冲容量。
const EventQueueSize = 256

// GameSession 绑定一个账户的完整游戏连接,管理房间/游戏状态与事件缓冲。
type GameSession struct {
	Account *account.Account
	HTTP    *HTTPClient

	mu        sync.RWMutex
	ws        *WSClient
	wsURL     string
	connected bool

	// 游戏状态缓冲
	roomID      string
	roomCode    string
	matchInfo   *MatchFoundResponse
	roomInfo    *RoomJoinedResponse
	gameState   *ViewState
	lastMatchID string // 最近一场对局的 matchId(用于拉取回放)

	// 事件队列
	eventQueue chan GameEvent

	// 动作结果等待器:requestId → chan
	actionMu       sync.Mutex
	actionWaiters  map[string]chan GameActionResult

	done chan struct{}
}

// NewGameSession 创建一个未连接的会话。
func NewGameSession(acc *account.Account, http *HTTPClient, wsURL string, maxReconnect int) *GameSession {
	return &GameSession{
		Account:       acc,
		HTTP:          http,
		wsURL:         wsURL,
		eventQueue:    make(chan GameEvent, EventQueueSize),
		actionWaiters: make(map[string]chan GameActionResult),
		done:          make(chan struct{}),
	}
}

// EnsureConnected 懒初始化:刷新 token(如需)+ WS 连接 + 注册事件监听。
func (s *GameSession) EnsureConnected() error {
	s.mu.Lock()
	if s.connected && s.ws != nil {
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()

	// 刷新 token(若过期)
	if s.HTTP != nil && s.Account != nil {
		if s.Account.TokenExpiry.IsZero() || time.Now().After(s.Account.TokenExpiry.Add(-time.Minute)) {
			result, err := s.HTTP.Login(s.Account.DisplayName, s.Account.Password)
			if err != nil {
				return fmt.Errorf("刷新 token 失败: %w", err)
			}
			s.Account.Token = result.Token
			s.Account.TokenExpiry = result.ExpiresAt
		}
	}

	ws := NewWSClient(s.wsURL, s.Account.Token, 5)
	s.registerHandlers(ws)

	if err := ws.Connect(); err != nil {
		return fmt.Errorf("WS 连接失败: %w", err)
	}

	s.mu.Lock()
	s.ws = ws
	s.connected = true
	s.mu.Unlock()
	return nil
}

// registerHandlers 注册所有服务端事件处理器。
func (s *GameSession) registerHandlers(ws *WSClient) {
	ws.On(EventGameFullSync, s.handleFullSync)
	ws.On(EventGameActionResult, s.handleActionResult)
	ws.On(EventGameGameOver, s.handleGameOver)
	ws.On(EventMatchFound, s.handleMatchFound)
	ws.On(EventRoomJoined, s.handleRoomJoined)
	ws.On(EventRoomGameStarted, s.handleRoomGameStarted)
	// 以下事件仅入队
	ws.On(EventGameTurnStart, func(p json.RawMessage) { s.enqueueEvent(EventGameTurnStart, p) })
	ws.On(EventGameTurnEnd, func(p json.RawMessage) { s.enqueueEvent(EventGameTurnEnd, p) })
	ws.On(EventGamePhaseChange, func(p json.RawMessage) { s.enqueueEvent(EventGamePhaseChange, p) })
	ws.On(EventGamePlayerAction, func(p json.RawMessage) { s.enqueueEvent(EventGamePlayerAction, p) })
	ws.On(EventGameBroadcastRequest, func(p json.RawMessage) { s.enqueueEvent(EventGameBroadcastRequest, p) })
	ws.On(EventGameStrikeMoveRequest, func(p json.RawMessage) { s.enqueueEvent(EventGameStrikeMoveRequest, p) })
	ws.On(EventGameError, func(p json.RawMessage) { s.enqueueEvent(EventGameError, p) })
	ws.On(EventMatchQueueJoined, func(p json.RawMessage) { s.enqueueEvent(EventMatchQueueJoined, p) })
	ws.On(EventMatchQueueCancelled, func(p json.RawMessage) { s.enqueueEvent(EventMatchQueueCancelled, p) })
	ws.On(EventMatchQueueError, func(p json.RawMessage) { s.enqueueEvent(EventMatchQueueError, p) })
	ws.On(EventMatchQueueStatus, func(p json.RawMessage) { s.enqueueEvent(EventMatchQueueStatus, p) })
	ws.On(EventMatchError, func(p json.RawMessage) { s.enqueueEvent(EventMatchError, p) })
	ws.On(EventRoomPlayerJoined, func(p json.RawMessage) { s.enqueueEvent(EventRoomPlayerJoined, p) })
	ws.On(EventRoomPlayerLeft, func(p json.RawMessage) { s.enqueueEvent(EventRoomPlayerLeft, p) })
	ws.On(EventRoomPlayerDisconnected, func(p json.RawMessage) { s.enqueueEvent(EventRoomPlayerDisconnected, p) })
	ws.On(EventRoomPlayerReconnected, func(p json.RawMessage) { s.enqueueEvent(EventRoomPlayerReconnected, p) })
	ws.On(EventRoomGameStarting, func(p json.RawMessage) { s.enqueueEvent(EventRoomGameStarting, p) })
	ws.On(EventMatchQueueInfoResp, func(p json.RawMessage) { s.enqueueEvent(EventMatchQueueInfoResp, p) })
	ws.On(EventMatchMyQueuesResp, func(p json.RawMessage) { s.enqueueEvent(EventMatchMyQueuesResp, p) })
	ws.On(EventMatchQueueCreated, func(p json.RawMessage) { s.enqueueEvent(EventMatchQueueCreated, p) })
	ws.On(EventMatchSpecificJoined, func(p json.RawMessage) { s.enqueueEvent(EventMatchSpecificJoined, p) })
	ws.On(EventMatchSpecificLeft, func(p json.RawMessage) { s.enqueueEvent(EventMatchSpecificLeft, p) })
	ws.On("connect", func(p json.RawMessage) {
		// 重连后请求状态同步
		if s.roomID != "" {
			_ = s.ws.SendEvent(EventGameRequestSync, nil, s.roomID)
		}
		s.enqueueEvent("reconnect", nil)
	})
}

func (s *GameSession) handleFullSync(payload json.RawMessage) {
	var fs FullSyncPayload
	if err := json.Unmarshal(payload, &fs); err != nil {
		log.Printf("解析 fullSync 失败: %v", err)
		return
	}
	var vs ViewState
	if err := json.Unmarshal(fs.State, &vs); err != nil {
		log.Printf("解析 ViewState 失败: %v", err)
		return
	}
	s.mu.Lock()
	s.gameState = &vs
	if vs.Winner != "" && s.lastMatchID == "" {
		// 游戏结束时尝试记录 matchId(roomID 即 matchId)
		if s.roomID != "" {
			s.lastMatchID = s.roomID
		}
	}
	s.mu.Unlock()
	s.enqueueEvent(EventGameFullSync, payload)
}

func (s *GameSession) handleActionResult(payload json.RawMessage) {
	var result GameActionResult
	if err := json.Unmarshal(payload, &result); err != nil {
		return
	}
	s.actionMu.Lock()
	ch, ok := s.actionWaiters[result.RequestID]
	if ok {
		delete(s.actionWaiters, result.RequestID)
	}
	s.actionMu.Unlock()
	if ok {
		select {
		case ch <- result:
		default:
		}
	}
	// 也入事件队列
	s.enqueueEvent(EventGameActionResult, payload)
}

func (s *GameSession) handleGameOver(payload json.RawMessage) {
	s.mu.Lock()
	if s.roomID != "" {
		s.lastMatchID = s.roomID
	}
	s.mu.Unlock()
	s.enqueueEvent(EventGameGameOver, payload)
}

func (s *GameSession) handleMatchFound(payload json.RawMessage) {
	var mf MatchFoundResponse
	if err := json.Unmarshal(payload, &mf); err == nil {
		s.mu.Lock()
		s.roomID = mf.RoomID
		s.roomCode = mf.RoomCode
		s.matchInfo = &mf
		s.mu.Unlock()
	}
	s.enqueueEvent(EventMatchFound, payload)
}

func (s *GameSession) handleRoomJoined(payload json.RawMessage) {
	var rj RoomJoinedResponse
	if err := json.Unmarshal(payload, &rj); err == nil {
		s.mu.Lock()
		s.roomID = rj.RoomID
		s.roomCode = rj.RoomCode
		s.roomInfo = &rj
		s.mu.Unlock()
	}
	s.enqueueEvent(EventRoomJoined, payload)
}

func (s *GameSession) handleRoomGameStarted(payload json.RawMessage) {
	s.enqueueEvent(EventRoomGameStarted, payload)
	// 游戏开始后请求全量同步
	s.mu.RLock()
	rid := s.roomID
	s.mu.RUnlock()
	if rid != "" {
		_ = s.ws.SendEvent(EventGameRequestSync, nil, rid)
	}
}

func (s *GameSession) enqueueEvent(eventType string, payload json.RawMessage) {
	evt := GameEvent{
		Type:      eventType,
		Timestamp: time.Now().UnixMilli(),
		Payload:   payload,
	}
	select {
	case s.eventQueue <- evt:
	default:
		// 队列满,丢弃最旧的事件
		select {
		case <-s.eventQueue:
		default:
		}
		s.eventQueue <- evt
	}
}

// --- 公开方法 ---

// SendAction 发送 game:action 并等待结果(10s 超时)。
func (s *GameSession) SendAction(action string, data map[string]any) (*GameActionResult, error) {
	if err := s.EnsureConnected(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	rid := s.roomID
	s.mu.RUnlock()
	if rid == "" {
		return nil, fmt.Errorf("当前不在任何房间中,无法执行游戏动作")
	}
	requestID := fmt.Sprintf("%d-%s", time.Now().UnixMilli(), uuid.NewString()[:8])
	if data == nil {
		data = make(map[string]any)
	}
	data["requestId"] = requestID

	ch := make(chan GameActionResult, 1)
	s.actionMu.Lock()
	s.actionWaiters[requestID] = ch
	s.actionMu.Unlock()

	defer func() {
		s.actionMu.Lock()
		delete(s.actionWaiters, requestID)
		s.actionMu.Unlock()
	}()

	if err := s.ws.SendEvent(EventGameAction, GameActionRequest{
		Action: action,
		Data:   data,
	}, rid); err != nil {
		return nil, fmt.Errorf("发送动作失败: %w", err)
	}

	select {
	case result := <-ch:
		return &result, nil
	case <-time.After(ActionTimeout):
		// 超时,发送取消
		_ = s.ws.SendEvent(EventGameCancelAction, map[string]any{
			"requestId": requestID,
			"action":    action,
		}, rid)
		return nil, fmt.Errorf("动作 %s 等待结果超时(%v)", action, ActionTimeout)
	case <-s.done:
		return nil, fmt.Errorf("会话已关闭")
	}
}

// SendRaw 发送任意 WS 事件(非 game:action),不等待结果。
func (s *GameSession) SendRaw(eventType string, payload any) error {
	if err := s.EnsureConnected(); err != nil {
		return err
	}
	s.mu.RLock()
	rid := s.roomID
	s.mu.RUnlock()
	return s.ws.SendEvent(eventType, payload, rid)
}

// GetState 返回缓冲的最新 ViewState。
func (s *GameSession) GetState() *ViewState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.gameState == nil {
		return nil
	}
	cp := *s.gameState
	return &cp
}

// GetRoomInfo 返回当前房间信息。
func (s *GameSession) GetRoomInfo() (roomID, roomCode string, room *RoomJoinedResponse) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.roomID, s.roomCode, s.roomInfo
}

// GetMatchInfo 返回匹配信息。
func (s *GameSession) GetMatchInfo() *MatchFoundResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.matchInfo == nil {
		return nil
	}
	cp := *s.matchInfo
	return &cp
}

// GetLastMatchID 返回最近一场对局的 matchId(用于拉取回放)。
func (s *GameSession) GetLastMatchID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastMatchID
}

// WaitForEvent 阻塞等待事件队列中的新事件,最多等待 timeout。
// 返回自上次调用以来的所有事件。timeout<=0 时非阻塞。
func (s *GameSession) WaitForEvent(timeout time.Duration) ([]GameEvent, error) {
	if timeout <= 0 {
		// 非阻塞:读取所有已有事件
		var events []GameEvent
		for {
			select {
			case evt := <-s.eventQueue:
				events = append(events, evt)
			default:
				return events, nil
			}
		}
	}
	// 阻塞等待第一个事件
	select {
	case evt := <-s.eventQueue:
		events := []GameEvent{evt}
		// 尽可能多读取已有事件
		for {
			select {
			case e := <-s.eventQueue:
				events = append(events, e)
			default:
				return events, nil
			}
		}
	case <-time.After(timeout):
		return nil, nil
	case <-s.done:
		return nil, fmt.Errorf("会话已关闭")
	}
}

// RequestSync 主动请求全量状态同步。
func (s *GameSession) RequestSync() error {
	s.mu.RLock()
	rid := s.roomID
	s.mu.RUnlock()
	if rid == "" {
		return fmt.Errorf("当前不在任何房间中")
	}
	return s.SendRaw(EventGameRequestSync, nil)
}

// Close 优雅关闭会话。
func (s *GameSession) Close() {
	s.mu.Lock()
	select {
	case <-s.done:
		s.mu.Unlock()
		return
	default:
		close(s.done)
	}
	ws := s.ws
	s.ws = nil
	s.connected = false
	s.mu.Unlock()
	if ws != nil {
		ws.Close()
	}
}

// IsConnected 返回 WS 连接状态。
func (s *GameSession) IsConnected() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.connected
}

// DrainEvents 清空事件队列。
func (s *GameSession) DrainEvents() {
	for {
		select {
		case <-s.eventQueue:
		default:
			return
		}
	}
}
