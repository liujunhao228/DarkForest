package server

import (
	"context"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// prompts_test.go 验证 RegisterPrompts 注册的 2 个叙述型知识 Prompt:
//   - 注册过程不 panic
//   - 客户端能 list 出全部 2 个 Prompt
//   - 客户端能 get 每个 Prompt 并获得非空文本
//   - strategy_primer 文本含位置推断段落 4 个核心要点
//   - 全部文本不含禁用词(promptForbiddenWords)
//
// 使用 SDK 内置的 InMemoryTransports,无需启动真实 HTTP 服务。

// expectedPromptNames 是 RegisterPrompts 应注册的全部 Prompt 名称(2 个)。
var expectedPromptNames = []string{
	"game_overview",
	"strategy_primer",
}

// positionInferenceMarkers 是 strategy_primer 位置推断段落必须包含的关键短语,
// 对应 Spec 4 个核心要点。
var positionInferenceMarkers = []string{
	"对手位置不会直接展示",                           // 要点 1: 位置不直接展示
	"信息隐藏在零散事件中",                           // 要点 2: 信息隐藏在零散事件中
	"MCP 不提供服务端推断",                         // 要点 3: MCP 不提供服务端推断
	"PositionView 不含 inferredFoePositions", // 要点 3: 显式引用 PositionView 字段约束
	"Agent 自行维护对手位置推断矩阵",                   // 要点 4: Agent 自行维护
}

// TestRegisterPrompts_NoPanic 验证 RegisterPrompts 注册过程不 panic。
func TestRegisterPrompts_NoPanic(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("RegisterPrompts panic: %v", r)
		}
	}()
	server := mcp.NewServer(&mcp.Implementation{Name: "test", Version: "v0.0.1"}, nil)
	RegisterPrompts(server)
}

// TestRegisterPrompts_ListAndGet 验证客户端能列出并获取全部 2 个 Prompt。
func TestRegisterPrompts_ListAndGet(t *testing.T) {
	ctx := context.Background()

	server := mcp.NewServer(&mcp.Implementation{Name: "test", Version: "v0.0.1"}, nil)
	RegisterPrompts(server)

	t1, t2 := mcp.NewInMemoryTransports()
	if _, err := server.Connect(ctx, t1, nil); err != nil {
		t.Fatalf("server.Connect 失败: %v", err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "client", Version: "v0.0.1"}, nil)
	cs, err := client.Connect(ctx, t2, nil)
	if err != nil {
		t.Fatalf("client.Connect 失败: %v", err)
	}
	defer cs.Close()

	// 列出所有 Prompt,收集 Name
	gotNames := make(map[string]bool)
	for p, err := range cs.Prompts(ctx, nil) {
		if err != nil {
			t.Fatalf("cs.Prompts 迭代失败: %v", err)
		}
		gotNames[p.Name] = true
	}
	for _, name := range expectedPromptNames {
		if !gotNames[name] {
			t.Errorf("Prompt %q 未注册", name)
		}
	}
	if len(gotNames) != len(expectedPromptNames) {
		t.Errorf("注册 Prompt 数 = %d, 期望 %d", len(gotNames), len(expectedPromptNames))
	}

	// 逐个获取 Prompt,验证返回非空文本
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
	}
}

// TestStrategyPrimer_ContainsPositionInference 验证 strategy_primer 文本
// 包含位置推断段落 4 个核心要点(Spec 硬约束)。
func TestStrategyPrimer_ContainsPositionInference(t *testing.T) {
	for _, marker := range positionInferenceMarkers {
		if !strings.Contains(strategyPrimerText, marker) {
			t.Errorf("strategy_primer 文本缺少位置推断要点: %q", marker)
		}
	}
}

// TestPromptTexts_NoForbiddenWords 验证两个 Prompt 文本均不含禁用词。
// 禁用词列表对齐 Spec 与 semantic.strikeForbiddenWords。
func TestPromptTexts_NoForbiddenWords(t *testing.T) {
	texts := []struct {
		name string
		text string
	}{
		{"game_overview", gameOverviewText},
		{"strategy_primer", strategyPrimerText},
	}
	for _, tt := range texts {
		t.Run(tt.name, func(t *testing.T) {
			for _, w := range promptForbiddenWords {
				if strings.Contains(tt.text, w) {
					t.Errorf("Prompt %q 包含禁用词 %q", tt.name, w)
				}
			}
		})
	}
}
