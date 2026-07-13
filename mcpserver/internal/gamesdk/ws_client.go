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

// WSClient 是到游戏后端的 WebSocket 客户端,支持重连、心跳、离线队列。
type WSClient struct {
	wsURL      string
	token      string
	maxReconnect int

	mu       sync.Mutex
	conn     *websocket.Conn
	connected bool
	closed   bool

	handlers  map[string][]EventHandler
	allHandlers []EventHandler // 接收所有事件

	sendQueue []Message // 离线发送队列

	done    chan struct{}
	wg      sync.WaitGroup
}

// NewWSClient 创建 WebSocket 客户端。
func NewWSClient(wsURL, token string, maxReconnect int) *WSClient {
	if maxReconnect <= 0 {
		maxReconnect = 5
	}
	return &WSClient{
		wsURL:        wsURL,
		token:        token,
		maxReconnect: maxReconnect,
		handlers:     make(map[string][]EventHandler),
		done:         make(chan struct{}),
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
	c.mu.Unlock()
	// flush 离线队列
	c.flushQueue()
	return nil
}

// IsConnected 返回连接状态。
func (c *WSClient) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

// Send 发送消息。若未连接则入离线队列。
func (c *WSClient) Send(msg Message) error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return fmt.Errorf("客户端已关闭")
	}
	if !c.connected || c.conn == nil {
		c.sendQueue = append(c.sendQueue, msg)
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
		c.mu.Unlock()
		// 入队,等重连后发送
		c.mu.Lock()
		c.sendQueue = append(c.sendQueue, msg)
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
	close(c.done)
	conn := c.conn
	c.connected = false
	c.mu.Unlock()
	if conn != nil {
		_ = conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		_ = conn.Close()
	}
	c.wg.Wait()
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
			c.mu.Unlock()
			if c.isClosed() {
				return
			}
			// 尝试重连
			if !c.reconnect() {
				return
			}
			continue
		}
		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			continue // 忽略无法解析的消息
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

// heartbeatLoop 每 54s 发送 ping。
func (c *WSClient) heartbeatLoop() {
	defer c.wg.Done()
	ticker := time.NewTicker(54 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			_ = c.Send(Message{Type: EventPing})
		}
	}
}

// reconnect 执行指数退避重连。返回 false 表示重试耗尽或已关闭。
func (c *WSClient) reconnect() bool {
	for attempt := 1; attempt <= c.maxReconnect; attempt++ {
		select {
		case <-c.done:
			return false
		case <-time.After(time.Duration(attempt*attempt) * time.Second):
		}
		if c.isClosed() {
			return false
		}
		if err := c.dial(); err == nil {
			// 重连成功,通知连接恢复
			c.dispatch(Message{Type: "connect"})
			return true
		}
	}
	log.Printf("WS 重连失败,已达最大次数 %d", c.maxReconnect)
	return false
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
			c.sendQueue = append(c.sendQueue, msg)
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
