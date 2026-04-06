#!/bin/sh
# ============================================================
# 黑暗森林 (Dark Forest) - 启动所有服务脚本
# 同时启动 HTTP 服务器和 WebSocket 游戏服务器
# ============================================================

set -e

echo "=========================================="
echo "  黑暗森林 - 启动所有服务"
echo "=========================================="
echo ""

# 启动 HTTP 服务器（Next.js standalone server）
# 注意：使用 bun 运行 server.js 以兼容 Alpine 环境（无 node 命令）
echo "🌐 启动 HTTP 服务器 (端口 3000)..."
bun server.js &
HTTP_PID=$!
echo "HTTP 服务器 PID: $HTTP_PID"

# 等待 HTTP 服务器启动
sleep 2

# 启动 WebSocket 游戏服务器（如果启用）
if [ "$ENABLE_WEBSOCKET" != "false" ]; then
  echo "🔌 启动 WebSocket 游戏服务器 (端口 ${WEBSOCKET_PORT:-3003})..."
  bun run src/server/gameServer.ts &
  WS_PID=$!
  echo "WebSocket 服务器 PID: $WS_PID"
  echo ""
  
  # 等待任一进程退出
  wait $HTTP_PID || exit $?
  wait $WS_PID || exit $?
else
  echo "WebSocket 服务器已禁用"
  wait $HTTP_PID || exit $?
fi
