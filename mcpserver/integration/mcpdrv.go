package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// agentDriver 封装一个真实 MCP StreamableHTTP 客户端会话(一个 agent 席位)。
// 两个 driver 各自独立连接 → 两个 MCP 会话 → 借出两个不同 agent(alpha/beta)。
type agentDriver struct {
	t   *testing.T
	cs  *mcp.ClientSession
	url string // mcpserver MCP 端点
}

// newAgentDriver 连接 mcpserver 的 Streamable HTTP 端点,建立独立 MCP 会话。
func newAgentDriver(t *testing.T, mcpURL string) *agentDriver {
	t.Helper()
	client := mcp.NewClient(&mcp.Implementation{Name: "trust-e2e-driver", Version: "v0.0.1"}, nil)
	transport := &mcp.StreamableClientTransport{
		Endpoint:   mcpURL,
		HTTPClient: &http.Client{Timeout: 60 * time.Second},
	}
	cs, err := client.Connect(context.Background(), transport, nil)
	if err != nil {
		t.Fatalf("MCP client 连接 %s 失败: %v", mcpURL, err)
	}
	t.Cleanup(func() { _ = cs.Close() })
	return &agentDriver{t: t, cs: cs, url: mcpURL}
}

// call 调用工具;结构化结果(json.StructuredContent)解码到 outcome。
// outcome 可传 *map[string]any 或具体 struct 指针。
// 工具层错误(IsError=true)直接 t.Fatalf 带出文本。
func (d *agentDriver) call(name string, args map[string]any, outcome any) {
	d.t.Helper()
	if args == nil {
		args = map[string]any{}
	}
	res, err := d.cs.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		d.t.Fatalf("CallTool(%s) 失败: %v", name, err)
	}
	if res == nil {
		d.t.Fatalf("CallTool(%s) 返回空结果", name)
	}
	if res.IsError {
		d.t.Fatalf("CallTool(%s) 工具层错误: %s", name, contentText(res))
	}
	if res.StructuredContent == nil {
		d.t.Fatalf("CallTool(%s) 无结构化输出: %s", name, contentText(res))
	}
	if outcome == nil {
		return
	}
	raw, err := json.Marshal(res.StructuredContent)
	if err != nil {
		d.t.Fatalf("CallTool(%s) 序列化结构化输出失败: %v", name, err)
	}
	if err := json.Unmarshal(raw, outcome); err != nil {
		d.t.Fatalf("CallTool(%s) 解码结构化输出到 %T 失败: %v\n原始: %s", name, outcome, err, raw)
	}
}

// contentText 从 CallToolResult.Content 提取首个文本(用于错误信息)。
func contentText(res *mcp.CallToolResult) string {
	if res == nil || len(res.Content) == 0 {
		return "(无内容)"
	}
	if tc, ok := res.Content[0].(*mcp.TextContent); ok {
		return tc.Text
	}
	return fmt.Sprintf("%v", res.Content[0])
}

// callRaw 调用工具并返回原始结构化内容(供调用方自行解析,如 fullSync 事件 payload)。
func (d *agentDriver) callRaw(name string, args map[string]any) (map[string]any, bool) {
	d.t.Helper()
	if args == nil {
		args = map[string]any{}
	}
	res, err := d.cs.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		d.t.Fatalf("CallTool(%s) 失败: %v", name, err)
	}
	if res == nil || res.StructuredContent == nil {
		return nil, false
	}
	raw, err := json.Marshal(res.StructuredContent)
	if err != nil {
		d.t.Fatalf("CallTool(%s) 序列化失败: %v", name, err)
	}
	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		d.t.Fatalf("CallTool(%s) 解码失败: %v", name, err)
	}
	return out, true
}

// --- 高频工具封装(供全链路测试使用) ---

// ensureConnected 调用 ensure_connected,返回结构化输出。
func (d *agentDriver) ensureConnected() map[string]any {
	d.t.Helper()
	out := map[string]any{}
	d.call("ensure_connected", nil, &out)
	return out
}

// joinQueue 加入快速匹配队列。
func (d *agentDriver) joinQueue(n int) {
	d.t.Helper()
	out := map[string]any{}
	d.call("join_match_queue", map[string]any{"preferredCount": n}, &out)
}

// waitEvent 等待事件,返回结构化输出(含 events 数组)。
func (d *agentDriver) waitEvent(timeoutSec int) map[string]any {
	d.t.Helper()
	out := map[string]any{}
	d.call("wait_for_event", map[string]any{"timeoutSeconds": timeoutSec}, &out)
	return out
}

// endTurn 结束当前回合,返回结构化输出(含 success/error,供判定重试)。
func (d *agentDriver) endTurn() map[string]any {
	d.t.Helper()
	out := map[string]any{}
	d.call("end_turn", nil, &out)
	return out
}

// respondBroadcast 以伪装(agreed=false)响应广播,用于清扫 pendingAction。
func (d *agentDriver) respondBroadcast(agreed bool, cardUID string) {
	d.t.Helper()
	args := map[string]any{"agreed": agreed}
	if cardUID != "" {
		args["cardUid"] = cardUID
	}
	out := map[string]any{}
	d.call("respond_broadcast", args, &out)
}

// selectBroadcastResponder 选择广播响应者,用于清扫 pendingAction。
func (d *agentDriver) selectBroadcastResponder(responderID string) {
	d.t.Helper()
	out := map[string]any{}
	d.call("select_broadcast_responder", map[string]any{"responderId": responderID}, &out)
}

// forfeit 主动弃权(确定性结算)。
func (d *agentDriver) forfeit() map[string]any {
	d.t.Helper()
	out := map[string]any{}
	d.call("forfeit_game", nil, &out)
	return out
}

// fetchSaveReplay 拉取最近对局回放并落 SQLite。
func (d *agentDriver) fetchSaveReplay() map[string]any {
	d.t.Helper()
	out := map[string]any{}
	d.call("fetch_and_save_replay", nil, &out)
	return out
}

// listLocalReplays 列出本地回放。
func (d *agentDriver) listLocalReplays() map[string]any {
	d.t.Helper()
	out := map[string]any{}
	d.call("list_local_replays", nil, &out)
	return out
}

// fetchSharedReplay 按回放 ID 从共享通道拉回并再落 SQLite。
func (d *agentDriver) fetchSharedReplay(replayID string) map[string]any {
	d.t.Helper()
	out := map[string]any{}
	d.call("fetch_shared_replay", map[string]any{"replayId": replayID}, &out)
	return out
}

// getSemanticView 读取回放语义视图。
func (d *agentDriver) getSemanticView(replayID string, turn int) map[string]any {
	d.t.Helper()
	out := map[string]any{}
	d.call("get_replay_semantic_view", map[string]any{"replayId": replayID, "turn": turn}, &out)
	return out
}

// getProfile 查询当前玩家资料。
func (d *agentDriver) getProfile() map[string]any {
	d.t.Helper()
	out := map[string]any{}
	d.call("get_my_profile", nil, &out)
	return out
}

// assertToolsContain 断言工具清单包含指定工具名。
func assertToolsContain(t *testing.T, d *agentDriver, want string) {
	t.Helper()
	res, err := d.cs.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("ListTools 失败: %v", err)
	}
	for _, tl := range res.Tools {
		if tl.Name == want {
			return
		}
	}
	t.Fatalf("工具清单缺少 %q(已注册 %d 个)", want, len(res.Tools))
}
