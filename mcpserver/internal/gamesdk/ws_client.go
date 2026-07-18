package gamesdk

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// EventHandler 是服务端事件的处理函数。
type EventHandler func(payload json.RawMessage)

// ConnState 表示 WebSocket 连接状态。
type ConnState int

const (
	// StateDisconnected 未连接(初始/已关闭)。
	StateDisconnected ConnState = iota
	// StateConnected 已连接。
	StateConnected
	// StateReconnecting 重连中。
	StateReconnecting
)

// String 返回状态的字符串表示。
func (s ConnState) String() string {
	switch s {
	case StateConnected:
		return "connected"
	case StateReconnecting:
		return "reconnecting"
	default:
		return "disconnected"
	}
}

// StateChangeHandler 在连接状态变化时被回调。
type StateChangeHandler func(state ConnState)

// 默认参数(可被构造函数覆盖)。
const (
	defaultHeartbeatInterval = 54 * time.Second
	defaultHeartbeatTimeout  = 10 * time.Second
	defaultMaxReconnect      = 5
	defaultMaxBackoff        = 5 * time.Minute
	defaultOfflineQueueMax   = 1000
)

// WSClient 是到游戏后端的 WebSocket 客户端,支持无限重连、心跳 pong 检测、离线队列上限。
type WSClient struct {
	wsURL            string
	token            string
	maxReconnect     int           // 快速阶段次数;超过后进入慢速无限重试
	maxBackoff       time.Duration // 慢速阶段退避上限
	heartbeatTimeout time.Duration // pong 等待超时
	offlineQueueMax  int           // 离线队列上限

	mu        sync.Mutex
	conn      *websocket.Conn
	connected bool
	closed    bool
	state     ConnState

	handlers    map[string][]EventHandler
	allHandlers []EventHandler // 接收所有事件
	stateCBs    []StateChangeHandler

	sendQueue []Message // 离线发送队列(有上限)

	// 心跳状态
	lastPongAt     time.Time
	reconnectCount int

	done chan struct{}
	wg   sync.WaitGroup
}

// NewWSClient 创建 WebSocket 客户端。
// maxReconnect 控制快速重连阶段次数;超过后进入慢速无限重试。
func NewWSClient(wsURL, token string, maxReconnect int) *WSClient {
	if maxReconnect <= 0 {
		maxReconnect = defaultMaxReconnect
	}
	return &WSClient{
		wsURL:            wsURL,
		token:            token,
		maxReconnect:     maxReconnect,
		maxBackoff:       defaultMaxBackoff,
		heartbeatTimeout: defaultHeartbeatTimeout,
		offlineQueueMax:  defaultOfflineQueueMax,
		handlers:         make(map[string][]EventHandler),
		state:            StateDisconnected,
		done:             make(chan struct{}),
	}
}

// SetMaxBackoff 设置慢速阶段退避上限。
func (c *WSClient) SetMaxBackoff(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if d > 0 {
		c.maxBackoff = d
	}
}

// SetHeartbeatTimeout 设置 pong 等待超时。
func (c *WSClient) SetHeartbeatTimeout(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if d > 0 {
		c.heartbeatTimeout = d
	}
}

// SetOfflineQueueMax 设置离线发送队列上限。
func (c *WSClient) SetOfflineQueueMax(n int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if n > 0 {
		c.offlineQueueMax = n
		// 若当前队列超限,截断
		if len(c.sendQueue) > n {
			c.sendQueue = c.sendQueue[len(c.sendQueue)-n:]
		}
	}
}

// On 注册事件处理器。可在 Connect 前调用。
func (c *WSClient) On(event string, handler EventHandler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.handlers[event] = append(c.handlers[event], handler)
}

// OnAll 注册一个接收所有事件的处理函数。
func (c *WSClient) OnAll(handler EventHandler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.allHandlers = append(c.allHandlers, handler)
}

// OnStateChange 注册连接状态变化回调。
func (c *WSClient) OnStateChange(cb StateChangeHandler) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.stateCBs = append(c.stateCBs, cb)
}

// Connect 建立连接并启动读循环和心跳。阻塞直到首次连接成功或重试耗尽。
func (c *WSClient) Connect() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return fmt.Errorf("客户端已关闭")
	}
	c.mu.Unlock()
	if err := c.dial(); err != nil {
		return err
	}
	c.wg.Add(2)
	go c.readLoop()
	go c.heartbeatLoop()
	return nil
}

// dial 建立单次连接。成功时设置 conn 和 connected=true。
func (c *WSClient) dial() error {
	url := c.wsURL
	if c.token != "" {
		sep := "?"
		// 兼容 wsURL 已有 query 的情况
		for i := 0; i < len(url); i++ {
			if url[i] == '?' {
				sep = "&"
				break
			}
		}
		url = fmt.Sprintf("%s%stoken=%s", url, sep, c.token)
	}
	dialer := websocket.DefaultDialer
	dialer.HandshakeTimeout = 15 * time.Second
	conn, _, err := dialer.Dial(url, nil)
	if err != nil {
		return fmt.Errorf("WS 连接失败: %w", err)
	}
	c.mu.Lock()
	c.conn = conn
	c.connected = true
	c.lastPongAt = time.Now()
	prevState := c.state
	c.state = StateConnected
	c.mu.Unlock()
	// flush 离线队列
	c.flushQueue()
	// 状态变化通知(首次连接/重连成功)
	if prevState != StateConnected {
		c.notifyStateChange(StateConnected)
		// 重连成功派发合成事件
		if prevState == StateReconnecting {
			c.dispatch(Message{Type: "connect"})
		}
	}
	return nil
}

// IsConnected 返回连接状态。
func (c *WSClient) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

// State 返回当前连接状态(线程安全)。
func (c *WSClient) State() ConnState {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state
}

// LastPongAt 返回上次收到 pong 的时间。
func (c *WSClient) LastPongAt() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastPongAt
}

// ReconnectCount 返回累计重连次数。
func (c *WSClient) ReconnectCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.reconnectCount
}

// Send 发送消息。若未连接则入离线队列。
func (c *WSClient) Send(msg Message) error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return fmt.Errorf("客户端已关闭")
	}
	if !c.connected || c.conn == nil {
		c.enqueueLocked(msg)
		c.mu.Unlock()
		return nil
	}
	conn := c.conn
	c.mu.Unlock()
	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("序列化消息: %w", err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		c.mu.Lock()
		c.connected = false
		c.enqueueLocked(msg)
		c.mu.Unlock()
		return fmt.Errorf("发送失败: %w", err)
	}
	return nil
}

// SendEvent 是 Send 的便捷封装,构造 Message 后发送。
func (c *WSClient) SendEvent(eventType string, payload any, roomID string) error {
	var payloadRaw json.RawMessage
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		payloadRaw = data
	}
	return c.Send(Message{Type: eventType, Payload: payloadRaw, RoomID: roomID})
}

// Close 优雅关闭,停止所有 goroutine。
func (c *WSClient) Close() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	c.state = StateDisconnected
	close(c.done)
	conn := c.conn
	c.connected = false
	c.conn = nil
	c.mu.Unlock()
	if conn != nil {
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		_ = conn.Close()
	}
	c.wg.Wait()
	c.notifyStateChange(StateDisconnected)
}

// readLoop 持续读取消息并分发。
func (c *WSClient) readLoop() {
	defer c.wg.Done()
	for {
		select {
		case <-c.done:
			return
		default:
		}
		c.mu.Lock()
		conn := c.conn
		c.mu.Unlock()
		if conn == nil {
			time.Sleep(500 * time.Millisecond)
			continue
		}
		_, data, err := conn.ReadMessage()
		if err != nil {
			c.mu.Lock()
			c.connected = false
			c.conn = nil
			prevState := c.state
			if prevState == StateConnected {
				c.state = StateReconnecting
			}
			c.mu.Unlock()
			if prevState == StateConnected {
				c.notifyStateChange(StateReconnecting)
			}
			if c.isClosed() {
				return
			}
			// 无限重连:永不放弃
			c.reconnect()
			continue
		}
		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			continue // 忽略无法解析的消息
		}
		// 内置 pong 处理:刷新 lastPongAt
		if msg.Type == EventPong {
			c.mu.Lock()
			c.lastPongAt = time.Now()
			c.mu.Unlock()
		}
		c.dispatch(msg)
	}
}

// dispatch 将消息分发给注册的 handler。
func (c *WSClient) dispatch(msg Message) {
	c.mu.Lock()
	handlers := make([]EventHandler, 0, len(c.allHandlers))
	handlers = append(handlers, c.allHandlers...)
	if hs, ok := c.handlers[msg.Type]; ok {
		handlers = append(handlers, hs...)
	}
	c.mu.Unlock()
	for _, h := range handlers {
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("WS handler panic (event=%s): %v", msg.Type, r)
				}
			}()
			h(msg.Payload)
		}()
	}
}

// notifyStateChange 通知所有状态回调。
func (c *WSClient) notifyStateChange(state ConnState) {
	c.mu.Lock()
	cbs := make([]StateChangeHandler, len(c.stateCBs))
	copy(cbs, c.stateCBs)
	c.mu.Unlock()
	for _, cb := range cbs {
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("WS state change callback panic: %v", r)
				}
			}()
			cb(state)
		}()
	}
}

// heartbeatLoop 每 54s 发送 ping,并检测 pong 是否在超时内返回。
// 若 pong 超时未到,主动关闭连接触发重连。
func (c *WSClient) heartbeatLoop() {
	defer c.wg.Done()
	ticker := time.NewTicker(defaultHeartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			// 记录 ping 发送时间,用于判断 pong 是否是对本次 ping 的响应
			pingSentAt := time.Now()
			// 发送 ping
			if err := c.Send(Message{Type: EventPing}); err != nil {
				continue
			}
			// 启动 pong 超时检测 goroutine
			go c.checkPongTimeout(pingSentAt)
		}
	}
}

// checkPongTimeout 在发送 ping 后等待 heartbeatTimeout,
// 然后检查 lastPongAt 是否晚于 pingSentAt。
// 若不是,说明 pong 未在超时内返回,主动关闭连接以触发重连。
func (c *WSClient) checkPongTimeout(pingSentAt time.Time) {
	c.mu.Lock()
	timeout := c.heartbeatTimeout
	c.mu.Unlock()

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-c.done:
		return
	case <-timer.C:
		c.mu.Lock()
		lastPong := c.lastPongAt
		conn := c.conn
		c.mu.Unlock()
		// 如果 pong 在 ping 之后到达,lastPongAt 应晚于 pingSentAt
		if !lastPong.After(pingSentAt) {
			log.Printf("WS 心跳 pong 超时(%.1fs),主动断开触发重连",
				time.Since(pingSentAt).Seconds())
			if conn != nil {
				_ = conn.Close()
			}
		}
	}
}

// reconnect 执行无限指数退避重连。
// 快速阶段:前 maxReconnect 次,间隔 attempt² 秒(1,4,9,16,25s)。
// 慢速阶段:此后无限重试,间隔封顶 maxBackoff(默认 5min)。
// 永不返回 false,除非客户端已关闭。
func (c *WSClient) reconnect() {
	for attempt := 1; ; attempt++ {
		// 计算退避时间
		var backoff time.Duration
		if attempt <= c.maxReconnect {
			// 快速阶段:attempt² 秒
			backoff = time.Duration(attempt*attempt) * time.Second
		} else {
			// 慢速阶段:封顶 maxBackoff
			backoff = c.maxBackoff
			// 记录慢速阶段重试日志(降低频率,每 10 次记一次)
			if (attempt-c.maxReconnect)%10 == 1 {
				log.Printf("WS 慢速重连阶段:第 %d 次尝试(退避 %v)", attempt-c.maxReconnect, backoff)
			}
		}
		select {
		case <-c.done:
			return
		case <-time.After(backoff):
		}
		if c.isClosed() {
			return
		}
		c.mu.Lock()
		c.reconnectCount++
		c.mu.Unlock()
		if err := c.dial(); err == nil {
			// 重连成功,dispatch 已在 dial 内完成
			return
		} else if attempt <= c.maxReconnect || (attempt-c.maxReconnect)%10 == 0 {
			log.Printf("WS 重连失败(第 %d 次): %v", attempt, err)
		}
	}
}

// enqueueLocked 将消息加入离线队列(调用者需持锁)。满时丢弃最旧并记录日志。
func (c *WSClient) enqueueLocked(msg Message) {
	if c.offlineQueueMax <= 0 {
		c.offlineQueueMax = defaultOfflineQueueMax
	}
	if len(c.sendQueue) >= c.offlineQueueMax {
		// 丢弃最旧
		dropped := c.sendQueue[0]
		c.sendQueue = c.sendQueue[1:]
		log.Printf("WS 离线队列已满(%d),丢弃最旧消息(type=%s)", c.offlineQueueMax, dropped.Type)
	}
	c.sendQueue = append(c.sendQueue, msg)
}

func (c *WSClient) flushQueue() {
	c.mu.Lock()
	queue := c.sendQueue
	c.sendQueue = nil
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return
	}
	for _, msg := range queue {
		data, err := json.Marshal(msg)
		if err != nil {
			continue
		}
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			// 重新入队
			c.mu.Lock()
			c.enqueueLocked(msg)
			c.mu.Unlock()
			return
		}
	}
}

func (c *WSClient) isClosed() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed
}
