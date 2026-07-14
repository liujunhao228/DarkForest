package server

import (
	"container/list"
	"context"
	"sync"

	"iter"
)

// streamBuffer 是单个 SSE stream 的事件缓冲。
// 使用 container/list 实现带容量上限的有序队列。
type streamBuffer struct {
	events *list.List // [][]byte,按追加顺序排列
	size   int        // 当前事件数
	max    int        // 容量上限
}

func newStreamBuffer(max int) *streamBuffer {
	if max <= 0 {
		max = 100
	}
	return &streamBuffer{
		events: list.New(),
		max:    max,
	}
}

// Append 追加一个事件,超过上限时丢弃最旧。
// 返回该事件的索引(从 0 开始)。
func (b *streamBuffer) Append(data []byte) int {
	b.events.PushBack(data)
	b.size++
	// 超过上限:丢弃最旧
	for b.size > b.max {
		front := b.events.Front()
		if front == nil {
			break
		}
		b.events.Remove(front)
		b.size--
	}
	return b.size - 1
}

// After 返回 index+1 之后的所有事件(含 index+1)。
// 若 index < 0,从开头返回。
// 返回 (data, error) 对;error 非 nil 时迭代终止。
// 若 index 之后的数据已被丢弃,立即返回错误。
func (b *streamBuffer) After(index int) iter.Seq2[[]byte, error] {
	return func(yield func([]byte, error) bool) {
		// 计算被丢弃的事件数:列表中第一个元素的原始索引
		firstIdx := b.size - b.events.Len()
		// 如果请求的 index 落在被丢弃的范围内,返回错误
		if index >= 0 && index < firstIdx-1 {
			yield(nil, errDataDropped)
			return
		}
		// 跳过 index 之前的事件
		currentIdx := firstIdx - 1 // 即将遍历的第一个元素的索引 - 1
		for el := b.events.Front(); el != nil; el = el.Next() {
			currentIdx++
			if index >= 0 && currentIdx <= index {
				continue
			}
			if !yield(el.Value.([]byte), nil) {
				return
			}
		}
	}
}

// errDataDropped 表示请求的索引之前的数据已被丢弃。
var errDataDropped = &dataDroppedError{}

type dataDroppedError struct{}

func (e *dataDroppedError) Error() string { return "data after index was dropped" }

// MemoryEventStore 是 mcp.EventStore 的内存实现。
// 每个 session 持有多个 stream,每个 stream 最多保留 maxEventsPerStream 个事件。
type MemoryEventStore struct {
	mu       sync.Mutex
	sessions map[string]map[string]*streamBuffer // sessionID → streamID → buffer
	maxEvents int
}

// NewMemoryEventStore 创建内存 EventStore。
// maxEventsPerStream 控制每个 stream 的事件上限(超出丢弃最旧)。
func NewMemoryEventStore(maxEventsPerStream int) *MemoryEventStore {
	if maxEventsPerStream <= 0 {
		maxEventsPerStream = 100
	}
	return &MemoryEventStore{
		sessions: make(map[string]map[string]*streamBuffer),
		maxEvents: maxEventsPerStream,
	}
}

// Open 初始化指定 stream 的 buffer(若不存在)。
func (s *MemoryEventStore) Open(_ context.Context, sessionID, streamID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	streams, ok := s.sessions[sessionID]
	if !ok {
		streams = make(map[string]*streamBuffer)
		s.sessions[sessionID] = streams
	}
	if _, ok := streams[streamID]; !ok {
		streams[streamID] = newStreamBuffer(s.maxEvents)
	}
	return nil
}

// Append 追加事件到指定 stream。
func (s *MemoryEventStore) Append(_ context.Context, sessionID, streamID string, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	streams, ok := s.sessions[sessionID]
	if !ok {
		streams = make(map[string]*streamBuffer)
		s.sessions[sessionID] = streams
	}
	buf, ok := streams[streamID]
	if !ok {
		buf = newStreamBuffer(s.maxEvents)
		streams[streamID] = buf
	}
	buf.Append(data)
	return nil
}

// After 返回指定 stream 中 index 之后的事件迭代器。
func (s *MemoryEventStore) After(_ context.Context, sessionID, streamID string, index int) iter.Seq2[[]byte, error] {
	s.mu.Lock()
	_, ok := s.sessions[sessionID]
	if !ok {
		s.mu.Unlock()
		return emptySeq
	}
	s.mu.Unlock()
	// 返回闭包,在迭代时加锁;期间 buffer 可能被 Append/SessionClosed 修改。
	return func(yield func([]byte, error) bool) {
		s.mu.Lock()
		defer s.mu.Unlock()
		streams, ok := s.sessions[sessionID]
		if !ok {
			return
		}
		buf, ok := streams[streamID]
		if !ok {
			return
		}
		for data, err := range buf.After(index) {
			if err != nil {
				yield(nil, err)
				return
			}
			if !yield(data, nil) {
				return
			}
		}
	}
}

// emptySeq 是一个空的迭代器。
var emptySeq iter.Seq2[[]byte, error] = func(yield func([]byte, error) bool) {}

// SessionClosed 清理指定 session 的所有 stream。
func (s *MemoryEventStore) SessionClosed(_ context.Context, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, sessionID)
	return nil
}
