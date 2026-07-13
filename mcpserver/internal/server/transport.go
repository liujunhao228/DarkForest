package server

import (
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// NewStreamableHandler 创建 Streamable HTTP handler,用于处理 MCP 客户端连接。
// 单实例 server,SDK 内部管理多 session。
func NewStreamableHandler(server *mcp.Server) http.Handler {
	return mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		return server
	}, nil)
}

// NewMux 创建 HTTP 路由,挂载 MCP 端点和健康检查。
func NewMux(endpoint string, mcpServer *mcp.Server) http.Handler {
	mux := http.NewServeMux()
	mux.Handle(endpoint, NewStreamableHandler(mcpServer))
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})
	return mux
}
