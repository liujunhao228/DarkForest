#!/usr/bin/env bash
set -euo pipefail

# Postgres 前置检查脚本 - E2E 运行前验证数据库可达

# 解析 backend/.env 中的 DATABASE_URL
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_PATH="${SCRIPT_DIR}/../backend/.env"

if [[ ! -f "$ENV_PATH" ]]; then
    echo "未找到 backend/.env 文件: $ENV_PATH" >&2
    echo "请参考 backend/.env.example 创建配置文件" >&2
    exit 1
fi

DATABASE_URL=$(grep -E '^\s*DATABASE_URL\s*=' "$ENV_PATH" | head -n1 | sed -E 's/^\s*DATABASE_URL\s*=\s*//; s/\s*$//')
if [[ -z "$DATABASE_URL" ]]; then
    echo "backend/.env 中未配置 DATABASE_URL" >&2
    exit 1
fi

# 从 postgres://user:pass@host:port/db 解析 host 与 port
if [[ "$DATABASE_URL" =~ @([^:/]+):([0-9]+) ]]; then
    PG_HOST="${BASH_REMATCH[1]}"
    PG_PORT="${BASH_REMATCH[2]}"
else
    PG_HOST="localhost"
    PG_PORT="5432"
    echo "DATABASE_URL 未含 host:port，使用默认 ${PG_HOST}:${PG_PORT}" >&2
fi

# 探测端口连通：优先 nc，回退 bash /dev/tcp
if command -v nc >/dev/null 2>&1; then
    if nc -z -w 3 "$PG_HOST" "$PG_PORT" 2>/dev/null; then
        echo "Postgres reachable at ${PG_HOST}:${PG_PORT}"
        exit 0
    fi
elif (echo > "/dev/tcp/${PG_HOST}/${PG_PORT}") >/dev/null 2>&1; then
    echo "Postgres reachable at ${PG_HOST}:${PG_PORT}"
    exit 0
fi

echo "Postgres 不可达 at ${PG_HOST}:${PG_PORT}" >&2
echo "请启动 Postgres，例如：" >&2
echo "  docker run -d --name darkforest-pg -e POSTGRES_USER=darkforest -e POSTGRES_PASSWORD=darkforest_secret -e POSTGRES_DB=darkforest -p 5432:5432 postgres:16" >&2
exit 1
