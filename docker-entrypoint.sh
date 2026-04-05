#!/bin/bash
# ============================================================
# 黑暗森林 (Dark Forest) - 容器启动入口脚本
# 在容器启动时自动初始化数据库
# ============================================================

set -e

echo "=========================================="
echo "  黑暗森林 - 容器启动"
echo "=========================================="

# 设置数据库 URL（如果未设置）
export DATABASE_URL=${DATABASE_URL:-"file:/app/db/custom.db"}

echo "数据库路径: $DATABASE_URL"

# -------------------- 数据库初始化 --------------------
echo ""
echo "正在初始化数据库..."

# 确保数据库目录存在
mkdir -p /app/db

# 生成 Prisma 客户端（如果不存在）
if [ ! -d "/app/node_modules/.prisma" ]; then
  echo "生成 Prisma 客户端..."
  bunx prisma generate
fi

# 推送数据库 Schema（创建表和索引）
echo "推送数据库 Schema..."
bunx prisma db push --accept-data-loss

echo "数据库初始化完成！"

# -------------------- 启动应用 --------------------
echo ""
echo "启动应用服务器..."
exec "$@"
