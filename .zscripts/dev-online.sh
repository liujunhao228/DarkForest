#!/bin/bash
# 黑暗森林 - 开发环境启动脚本
# 同时启动 WebSocket 服务器和 Next.js 开发服务器

echo "🌌 黑暗森林 - 开发环境"
echo "======================"

# 检查 Bun 是否安装
if ! command -v bun &> /dev/null; then
    echo "❌ 错误：Bun 未安装"
    echo "请安装 Bun: https://bun.sh/"
    exit 1
fi

# 进入项目目录
cd "$(dirname "$0")"

echo "📦 安装依赖..."
bun install

echo ""
echo "🗄️  推送数据库 Schema..."
bun run db:push

echo ""
echo "🚀 启动服务..."
echo ""
echo "  - WebSocket 服务器：http://localhost:3003"
echo "  - Next.js 开发服务器：http://localhost:3000"
echo ""
echo "按 Ctrl+C 停止所有服务"
echo ""

# 启动 WebSocket 服务器（后台）
echo "[WebSocket] 启动服务器..."
bun run src/server/gameServer.ts &
WEBSOCKET_PID=$!

# 等待 WebSocket 服务器启动
sleep 2

# 启动 Next.js 开发服务器
echo "[Next.js] 启动开发服务器..."
bun run dev

# 清理
kill $WEBSOCKET_PID 2>/dev/null
echo ""
echo "👋 服务已停止"
