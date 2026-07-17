// Package server 端到端注册验证测试。
//
// 本文件是 Task 17 SubTask 17.5 的整合验证:用 InMemoryTransports 启动
// server.New(cfg, pool, mgr, db) 注册的全部 tool/resource/prompt,通过客户端
// 列出并断言关键名称存在、数量符合预期、所有 Resource 可读、所有 Prompt 可调用。
//
// 测试不调用任何 tool(避免依赖真实 GameSession/账户池),仅做注册元数据校验。
package server

import (
	"context"
	"sort"
	"testing"

	"darkforest/mcpserver/internal/account"
	"darkforest/mcpserver/internal/config"
	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/persistence"
	"darkforest/mcpserver/internal/session"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// TestRegistration_AllToolsResourcesPromptsListed 是 Task 17 的核心整合测试:
//
//  1. 构造 server.New 所需依赖(cfg/pool/mgr/db),全部用最小可用值
//  2. 用 mcp.NewInMemoryTransports 连接 client + server
//  3. 通过 client.ListTools/ListResources/ListPrompts 列出全部注册项
//  4. 断言关键 tool 名称存在(覆盖 Phase E 重组后的全部 tool)
//  5. 断言 8 个 Resource URI 全部存在且可读
//  6. 断言 2 个 Prompt 名称全部存在且可调用
//
// 任何注册遗漏、handler panic、schema 生成失败都会让本测试失败。
func TestRegistration_AllToolsResourcesPromptsListed(t *testing.T) {
	ctx := context.Background()

	// 构造最小依赖:配置、账户池、会话管理器、SQLite。
	// 用 t.TempDir() 在测试结束后自动清理 DB 文件。
	cfg := &config.Config{
		GameAPIURL: "http://localhost:8080",
		GameWSURL:  "ws://localhost:8080/ws",
		AdminToken: "test-admin-token",
	}
	dbPath := t.TempDir() + "/test.db"
	db, err := persistence.Open(dbPath)
	if err != nil {
		t.Fatalf("persistence.Open 失败: %v", err)
	}
	defer db.Close()

	pool := account.NewPool(db.Account, nil)
	httpC := gamesdk.NewHTTPClient(cfg.GameAPIURL)
	mgr := session.NewManager(pool, httpC, cfg.GameWSURL, cfg.WSReconnectMax)

	// 调用 server.New 触发全部 tool/resource/prompt 注册。
	// 任何注册函数 panic 或 schema 生成失败都会在此暴露。
	mcpServer := New(cfg, pool, mgr, db)

	// 用 InMemoryTransports 连接 client + server,无需启动真实 HTTP 服务。
	t1, t2 := mcp.NewInMemoryTransports()
	if _, err := mcpServer.Connect(ctx, t1, nil); err != nil {
		t.Fatalf("server.Connect 失败: %v", err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "v0.0.1"}, nil)
	cs, err := client.Connect(ctx, t2, nil)
	if err != nil {
		t.Fatalf("client.Connect 失败: %v", err)
	}
	defer cs.Close()

	// --- 1. 列出全部 Tool ---
	toolsResult, err := cs.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("ListTools 失败: %v", err)
	}
	gotToolNames := make([]string, 0, len(toolsResult.Tools))
	for _, tl := range toolsResult.Tools {
		gotToolNames = append(gotToolNames, tl.Name)
	}
	sort.Strings(gotToolNames)
	t.Logf("已注册 %d 个 tool: %v", len(gotToolNames), gotToolNames)

	// 关键 tool 必须存在(覆盖 Phase E 重组后的认知层 + 详情层 + 合并 strike + 保留动作)。
	// 注:旧 4 个状态查询 tool(get_game_state 等)与旧 6 个 strike tool(move_strike 等)已下线,不应出现。
	mustTools := []string{
		// 认知层(Task 9)
		"get_agent_view", "get_affordances", "get_recent_delta", "get_turn_delta",
		// strike 合并(Task 10)
		"resolve_strike_action",
		// 详情层(Task 11)
		"get_card_detail", "get_card_glossary",
		// 保留动作 tool
		"play_card", "deploy_card", "strike", "broadcast", "respond_broadcast",
		"select_broadcast_responder", "cancel_broadcast", "recycle_card",
		"end_turn", "lightspeed_ship",
		// 连接/匹配/房间/状态/回放/统计/管理(保留)
		"ensure_connected", "disconnect", "get_my_profile", "get_connection_status",
		"join_match_queue", "cancel_match_queue", "get_match_status",
		"create_custom_queue", "join_custom_queue", "leave_custom_queue",
		"get_queue_info", "get_my_queues",
		"get_room_info", "leave_room",
		"get_game_logs", "wait_for_event",
		"list_my_replays", "get_replay", "fetch_and_save_replay",
		"list_local_replays", "get_local_replay", "fetch_shared_replay",
		"get_replay_deltas",
		"get_my_stats", "get_player_stats",
		"register_pool_account", "add_pool_account", "list_pool_accounts",
		"get_tool_call_stats",
	}
	toolNameSet := make(map[string]bool, len(gotToolNames))
	for _, n := range gotToolNames {
		toolNameSet[n] = true
	}
	for _, name := range mustTools {
		if !toolNameSet[name] {
			t.Errorf("必须存在的 tool %q 未注册", name)
		}
	}

	// 已下线 tool 不应出现(SubTask 13.1/13.2 的回归保护)。
	offlinedTools := []string{
		// 旧 4 个状态查询 tool(Task 13.1)
		"get_game_state", "get_game_summary", "get_broadcast_state", "get_pending_action",
		// 旧 6 个 strike tool(Task 13.2)
		"move_strike", "retarget_strike", "select_strike",
		"skip_strike_select", "announce_strike", "skip_announce_strike",
	}
	for _, name := range offlinedTools {
		if toolNameSet[name] {
			t.Errorf("已下线 tool %q 仍被注册(违反 Task 13)", name)
		}
	}

	// --- 2. 列出全部 Resource ---
	gotResourceURIs := make(map[string]bool)
	for r, err := range cs.Resources(ctx, nil) {
		if err != nil {
			t.Fatalf("cs.Resources 迭代失败: %v", err)
		}
		gotResourceURIs[r.URI] = true
	}
	t.Logf("已注册 %d 个 Resource URI", len(gotResourceURIs))

	for _, uri := range expectedResourceURIs {
		if !gotResourceURIs[uri] {
			t.Errorf("Resource URI %q 未注册", uri)
		}
	}
	if len(gotResourceURIs) != len(expectedResourceURIs) {
		t.Errorf("注册 Resource 数 = %d, 期望 %d;实际 URI 列表: %v",
			len(gotResourceURIs), len(expectedResourceURIs), sortedKeys(gotResourceURIs))
	}

	// 逐个读取 Resource,断言返回非空内容。
	for _, uri := range expectedResourceURIs {
		result, err := cs.ReadResource(ctx, &mcp.ReadResourceParams{URI: uri})
		if err != nil {
			t.Errorf("ReadResource(%q) 失败: %v", uri, err)
			continue
		}
		if result == nil || len(result.Contents) == 0 {
			t.Errorf("ReadResource(%q) 返回空内容", uri)
			continue
		}
		content := result.Contents[0]
		if len(content.Text) == 0 {
			t.Errorf("ReadResource(%q) 返回空 Text", uri)
		}
		t.Logf("Resource %q: %d 字节, MIME=%s", uri, len(content.Text), content.MIMEType)
	}

	// --- 3. 列出全部 Prompt ---
	gotPromptNames := make(map[string]bool)
	for p, err := range cs.Prompts(ctx, nil) {
		if err != nil {
			t.Fatalf("cs.Prompts 迭代失败: %v", err)
		}
		gotPromptNames[p.Name] = true
	}
	t.Logf("已注册 %d 个 Prompt", len(gotPromptNames))

	for _, name := range expectedPromptNames {
		if !gotPromptNames[name] {
			t.Errorf("Prompt %q 未注册", name)
		}
	}
	if len(gotPromptNames) != len(expectedPromptNames) {
		t.Errorf("注册 Prompt 数 = %d, 期望 %d", len(gotPromptNames), len(expectedPromptNames))
	}

	// 逐个调用 Prompt,断言返回非空消息。
	for _, name := range expectedPromptNames {
		result, err := cs.GetPrompt(ctx, &mcp.GetPromptParams{Name: name})
		if err != nil {
			t.Errorf("GetPrompt(%q) 失败: %v", name, err)
			continue
		}
		if result == nil || len(result.Messages) == 0 {
			t.Errorf("GetPrompt(%q) 返回空消息", name)
			continue
		}
		msg := result.Messages[0]
		tc, ok := msg.Content.(*mcp.TextContent)
		if !ok {
			t.Errorf("GetPrompt(%q) Content 不是 TextContent", name)
			continue
		}
		if len(tc.Text) == 0 {
			t.Errorf("GetPrompt(%q) 返回空 Text", name)
		}
		t.Logf("Prompt %q: %d 字节", name, len(tc.Text))
	}
}

// sortedKeys 返回 map 键的有序列表,用于稳定错误输出。
func sortedKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
