#!/bin/bash
# ============================================================
# 黑暗森林 (Dark Forest) - 回滚脚本
# 从 PostgreSQL (Go Backend) 回滚到 SQLite (Prisma)
# ============================================================

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
OLD_DB_PATH="${OLD_DB_PATH:-./prisma/dev.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RESTORE_BACKUP="${RESTORE_BACKUP:-}"

# PostgreSQL 连接配置
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-darkforest}"
PG_PASSWORD="${PG_PASSWORD:-darkforest_secret}"
PG_DATABASE="${PG_DATABASE:-darkforest}"

# 旧版服务配置
OLD_SERVER_SCRIPT="${OLD_SERVER_SCRIPT:-./server.js}"
OLD_DOCKER_COMPOSE="${OLD_DOCKER_COMPOSE:-./docker-compose.yml}"

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查备份文件
check_backup() {
    if [ -z "$RESTORE_BACKUP" ]; then
        log_error "未指定备份文件"
        log_info "请使用 RESTORE_BACKUP 环境变量指定备份文件"
        log_info "示例: RESTORE_BACKUP=./backups/migration_backup_20260607_120000.sql"

        # 列出可用的备份文件
        if [ -d "$BACKUP_DIR" ]; then
            log_info "可用的备份文件:"
            ls -lh "$BACKUP_DIR"/*.sql 2>/dev/null || log_warning "没有找到 SQL 备份文件"
            ls -lh "$BACKUP_DIR"/*.json 2>/dev/null || log_warning "没有找到 JSON 备份文件"
        fi

        exit 1
    fi

    if [ ! -f "$RESTORE_BACKUP" ]; then
        log_error "备份文件不存在: $RESTORE_BACKUP"
        exit 1
    fi

    log_success "找到备份文件: $RESTORE_BACKUP"
}

# 停止新版服务
stop_new_services() {
    log_info "停止新版 Go 服务..."

    # 停止 Docker 容器（如果使用 Docker）
    if command -v docker &> /dev/null; then
        if [ -f "./docker-compose.production.new.yml" ]; then
            log_info "停止 Docker 容器..."
            docker compose -f docker-compose.production.new.yml down
            log_success "Docker 容器已停止"
        fi
    fi

    # 停止 Go 服务进程（如果直接运行）
    if pgrep -f "bin/server" &> /dev/null; then
        log_info "停止 Go 服务进程..."
        pkill -f "bin/server"
        sleep 2
        log_success "Go 服务进程已停止"
    fi
}

# 恢复 SQLite 数据库
restore_sqlite_db() {
    log_info "恢复 SQLite 数据库..."

    # 如果备份文件是 SQL 格式
    if [[ "$RESTORE_BACKUP" == *.sql ]]; then
        log_info "从 SQL 备份恢复..."

        # 创建新的 SQLite 数据库
        if [ -f "$OLD_DB_PATH" ]; then
            log_warning "旧数据库文件已存在，将被覆盖"
            rm -f "$OLD_DB_PATH"
        fi

        # 导入 SQL 备份
        sqlite3 "$OLD_DB_PATH" < "$RESTORE_BACKUP"

        log_success "SQLite 数据库恢复完成: $OLD_DB_PATH"
    fi

    # 如果备份文件是 JSON 格式
    if [[ "$RESTORE_BACKUP" == *.json ]]; then
        log_info "从 JSON 备份恢复..."

        if ! command -v jq &> /dev/null; then
            log_error "需要 jq 工具来处理 JSON 备份"
            exit 1
        fi

        # 这里需要编写 JSON -> SQLite 的导入逻辑
        log_warning "JSON 备份恢复逻辑需要实现"
    fi
}

# 清理 PostgreSQL 数据（可选）
cleanup_postgresql() {
    log_warning "是否清理 PostgreSQL 数据？"
    log_info "这将删除 PostgreSQL 中的所有数据"
    read -p "确认清理 PostgreSQL 数据？(yes/no): " confirm

    if [ "$confirm" == "yes" ]; then
        log_info "清理 PostgreSQL 数据..."

        export PGPASSWORD="$PG_PASSWORD"

        # 删除所有表数据
        tables=("players" "invitation_codes" "matches" "match_players" "matchmaking_queues" "custom_match_queues" "custom_match_queue_players" "replays")

        for table in "${tables[@]}"; do
            psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -c "TRUNCATE TABLE $table CASCADE;" &> /dev/null || true
        done

        log_success "PostgreSQL 数据已清理"
    else
        log_info "跳过 PostgreSQL 数据清理"
    fi
}

# 启动旧版服务
start_old_services() {
    log_info "启动旧版 Next.js + Bun 服务..."

    # 使用 Docker Compose 启动旧版服务
    if [ -f "$OLD_DOCKER_COMPOSE" ]; then
        log_info "使用 Docker Compose 启动旧版服务..."
        docker compose -f "$OLD_DOCKER_COMPOSE" up -d
        log_success "旧版服务已启动"
    else
        # 直接启动旧版服务
        if [ -f "$OLD_SERVER_SCRIPT" ]; then
            log_info "直接启动旧版服务..."
            bun run "$OLD_SERVER_SCRIPT" &
            sleep 3
            log_success "旧版服务已启动"
        else
            log_warning "未找到旧版服务脚本: $OLD_SERVER_SCRIPT"
            log_info "请手动启动旧版服务"
        fi
    fi
}

# 验证回滚结果
verify_rollback() {
    log_info "验证回滚结果..."

    # 检查 SQLite 数据库
    if [ -f "$OLD_DB_PATH" ]; then
        tables_count=$(sqlite3 "$OLD_DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';")
        log_info "SQLite 数据库表数量: $tables_count"

        # 检查关键表
        for table in "players" "matches"; do
            count=$(sqlite3 "$OLD_DB_PATH" "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "表不存在")
            log_info "SQLite 表 $table: $count 条记录"
        done
    else
        log_warning "SQLite 数据库文件不存在: $OLD_DB_PATH"
    fi

    # 检查旧版服务状态
    if pgrep -f "bun.*server.js" &> /dev/null; then
        log_success "旧版服务正在运行"
    else
        log_warning "旧版服务未运行"
    fi

    log_success "验证完成"
}

# 主流程
main() {
    log_info "======================================"
    log_info "黑暗森林回滚脚本"
    log_info "======================================"

    check_backup
    stop_new_services
    restore_sqlite_db
    cleanup_postgresql
    start_old_services
    verify_rollback

    log_success "======================================"
    log_success "回滚完成！"
    log_success "======================================"
    log_info "已恢复到旧版 Next.js + SQLite 服务"
}

# 执行主流程
main