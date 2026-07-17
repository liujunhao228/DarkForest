package server

import (
	"context"
	"sort"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// resources_test.go 验证 RegisterResources 注册的 8 个静态知识 Resource:
//   - 注册过程不 panic
//   - 客户端能 list 出全部 8 个 URI
//   - 客户端能 read 每个 URI 并获得非空内容
//
// 使用 SDK 内置的 InMemoryTransports,无需启动真实 HTTP 服务。

// expectedResourceURIs 是 RegisterResources 应注册的全部 URI(8 个)。
var expectedResourceURIs = []string{
	"starmap://topology",
	"cards://library",
	"rules://mode/classic",
	"rules://mode/civilization_relics",
	"rules://mechanism/strike",
	"rules://mechanism/broadcast",
	"rules://mechanism/lightspeed",
	"rules://mechanism/relic",
}

// TestRegisterResources_NoPanic 验证 RegisterResources 注册过程不 panic。
func TestRegisterResources_NoPanic(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("RegisterResources panic: %v", r)
		}
	}()
	server := mcp.NewServer(&mcp.Implementation{Name: "test", Version: "v0.0.1"}, nil)
	RegisterResources(server)
}

// TestRegisterResources_ListAndRead 验证客户端能列出并读取全部 8 个 Resource。
func TestRegisterResources_ListAndRead(t *testing.T) {
	ctx := context.Background()

	// 创建 server 并注册 Resource
	server := mcp.NewServer(&mcp.Implementation{Name: "test", Version: "v0.0.1"}, nil)
	RegisterResources(server)

	// 用 InMemoryTransports 连接 server 与 client
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

	// 列出所有 Resource,收集 URI
	gotURIs := make(map[string]bool)
	for r, err := range cs.Resources(ctx, nil) {
		if err != nil {
			t.Fatalf("cs.Resources 迭代失败: %v", err)
		}
		gotURIs[r.URI] = true
	}

	// 验证全部 8 个 URI 都已注册
	for _, uri := range expectedResourceURIs {
		if !gotURIs[uri] {
			t.Errorf("Resource %q 未注册", uri)
		}
	}
	if len(gotURIs) != len(expectedResourceURIs) {
		t.Errorf("注册 Resource 数 = %d, 期望 %d", len(gotURIs), len(expectedResourceURIs))
	}

	// 逐个读取 Resource,验证返回非空内容
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
		if content.URI != uri {
			t.Errorf("ReadResource(%q) 返回 URI = %q", uri, content.URI)
		}
		if len(content.Text) == 0 {
			t.Errorf("ReadResource(%q) 返回空 Text", uri)
		}
	}
}

// TestExpectedResourceURIs_Sorted 是一个自检测试,确保 expectedResourceURIs 排序后不变,
// 便于在测试报告中稳定显示。非功能性,仅防止手误。
func TestExpectedResourceURIs_Sorted(t *testing.T) {
	sorted := make([]string, len(expectedResourceURIs))
	copy(sorted, expectedResourceURIs)
	sort.Strings(sorted)
	for i, u := range expectedResourceURIs {
		if u != sorted[i] {
			t.Logf("expectedResourceURIs 未排序(不影响功能,仅提示): %v", expectedResourceURIs)
			return
		}
	}
}
