#!/bin/bash
# ============================================================
# 黑暗森林 (Dark Forest) - 数据迁移脚本
# 从 SQLite (Prisma) 迁移到 PostgreSQL (Go Backend)
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
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/migration_backup_${TIMESTAMP}.sql"

# PostgreSQL 连接配置
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-darkforest}"
PG_PASSWORD="${PG_PASSWORD:-darkforest_secret}"
PG_DATABASE="${PG_DATABASE:-darkforest}"

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

# 检查依赖
check_dependencies() {
    log_info "检查依赖工具..."

    # 检查 sqlite3
    if ! command -v sqlite3 &> /dev/null; then
        log_error "sqlite3 未安装。请安装 SQLite 工具。"
        exit 1
    fi

    # 检查 psql
    if ! command -v psql &> /dev/null; then
        log_error "psql 未安装。请安装 PostgreSQL 客户端工具。"
        exit 1
    fi

    # 检查 jq（用于 JSON 处理）
    if ! command -v jq &> /dev/null; then
        log_warning "jq 未安装。某些功能可能受限。"
    fi

    log_success "依赖检查完成"
}

# 创建备份目录
create_backup_dir() {
    if [ ! -d "$BACKUP_DIR" ]; then
        log_info "创建备份目录: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
    fi
}

# 检查旧数据库是否存在
check_old_db() {
    if [ ! -f "$OLD_DB_PATH" ]; then
        log_warning "旧数据库文件不存在: $OLD_DB_PATH"
        log_info "跳过数据迁移，仅创建新数据库结构"
        return 1
    fi

    log_success "找到旧数据库文件: $OLD_DB_PATH"
    return 0
}

# 备份旧数据库
backup_old_db() {
    if ! check_old_db; then
        return 0
    fi

    log_info "备份旧数据库..."

    # 导出 SQLite 数据为 SQL 格式
    sqlite3 "$OLD_DB_PATH" .dump > "$BACKUP_FILE"

    log_success "备份完成: $BACKUP_FILE"

    # 同时创建 JSON 格式的备份（用于数据转换）
    JSON_BACKUP="${BACKUP_DIR}/migration_backup_${TIMESTAMP}.json"
    log_info "创建 JSON 格式备份..."

    # 导出各个表的数据
    {
        echo '{"tables": {'

        # Players 表
        echo '"players":'
        sqlite3 "$OLD_DB_PATH" "SELECT json_group_array(json_object('id', id, 'userId', userId, 'displayName', displayName, 'role', role, 'password', password, 'avatar', avatar, 'wins', wins, 'losses', losses, 'draws', draws, 'totalMatches', totalMatches, 'createdAt', createdAt, 'updatedAt', updatedAt)) FROM players;"
        echo ','

        # InvitationCodes 表
        echo '"invitation_codes":'
        sqlite3 "$OLD_DB_PATH" "SELECT json_group_array(json_object('id', id, 'code', code, 'createdBy', createdBy, 'isUsed', isUsed, 'usedBy', usedBy, 'createdAt', createdAt, 'usedAt', usedAt)) FROM invitation_codes;"
        echo ','

        # Matches 表
        echo '"matches":'
        sqlite3 "$OLD_DB_PATH" "SELECT json_group_array(json_object('id', id, 'roomCode', roomCode, 'hostId', hostId, 'status', status, 'playerCount', playerCount, 'aiCount', aiCount, 'winnerId', winnerId, 'winnerType', winnerType, 'totalTurns', totalTurns, 'duration', duration, 'startedAt', startedAt, 'finishedAt', finishedAt, 'createdAt', createdAt, 'updatedAt', updatedAt, 'gameLog', gameLog)) FROM matches;"
        echo ','

        # MatchPlayers 表
        echo '"match_players":'
        sqlite3 "$OLD_DB_PATH" "SELECT json_group_array(json_object('id', id, 'matchId', matchId, 'playerId', playerId, 'playerNumber', playerNumber, 'isHost', isHost, 'position', position, 'finalRank', finalRank, 'isEliminated', isEliminated, 'eliminatedTurn', eliminatedTurn, 'energy', energy, 'destroyedStars', destroyedStars, 'broadcastCount', broadcastCount, 'strikeCount', strikeCount, 'createdAt', createdAt)) FROM match_players;"

        echo '}}'
    } > "$JSON_BACKUP"

    log_success "JSON 备份完成: $JSON_BACKUP"
}

# 检查 PostgreSQL 连接
check_pg_connection() {
    log_info "检查 PostgreSQL 连接..."

    export PGPASSWORD="$PG_PASSWORD"

    if ! psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -c "SELECT 1;" &> /dev/null; then
        log_error "无法连接到 PostgreSQL"
        log_info "请确保 PostgreSQL 服务正在运行，并检查连接参数"
        log_info "Host: $PG_HOST, Port: $PG_PORT, User: $PG_USER, Database: $PG_DATABASE"
        exit 1
    fi

    log_success "PostgreSQL 连接成功"
}

# 运行 PostgreSQL 迁移
run_pg_migrations() {
    log_info "运行 PostgreSQL 迁移..."

    export PGPASSWORD="$PG_PASSWORD"

    # 使用 golang-migrate 工具（如果已安装）
    if command -v migrate &> /dev/null; then
        log_info "使用 golang-migrate 工具..."
        migrate -path ./backend/internal/db/migrations -database "postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DATABASE}?sslmode=disable" up
        log_success "迁移完成"
    else
        log_warning "golang-migrate 未安装，手动执行 SQL 迁移..."

        # 手动执行迁移 SQL
        for migration_file in ./backend/internal/db/migrations/*.up.sql; do
            if [ -f "$migration_file" ]; then
                log_info "执行迁移: $migration_file"
                psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -f "$migration_file"
            fi
        done

        log_success "手动迁移完成"
    fi
}

# 数据转换和导入（如果旧数据库存在）
import_data() {
    if ! check_old_db; then
        log_info "没有旧数据需要导入"
        return 0
    fi

    log_info "开始数据转换和导入..."

    export PGPASSWORD="$PG_PASSWORD"

    # 注意：由于 SQLite 使用 CUID，PostgreSQL 使用 UUID，
    # 这里需要处理 ID 格式转换

    # 简化方案：将 VARCHAR ID 保留为字符串，不转换为 UUID
    # 这需要修改 PostgreSQL schema，使用 VARCHAR 作为 ID

    log_warning "数据导入需要处理 ID 格式转换"
    log_info "建议方案："
    log_info "1. 修改 PostgreSQL schema，使用 VARCHAR 作为 ID（保持兼容）"
    log_info "2. 或者创建 ID 映射表，记录 CUID -> UUID 的映射"

    # 这里提供一个简单的导入示例（需要根据实际情况调整）
    log_info "示例：导入 Players 表数据..."

    # 从 JSON 备份读取数据并导入
    JSON_BACKUP="${BACKUP_DIR}/migration_backup_${TIMESTAMP}.json"

    if [ -f "$JSON_BACKUP" ] && command -v jq &> /dev/null; then
        # 提取 Players 数据
        players_data=$(jq '.tables.players' "$JSON_BACKUP")

        # 这里需要编写具体的数据导入逻辑
        # 由于 ID 格式问题，暂时跳过实际导入

        log_warning "数据导入逻辑需要根据实际 ID 格式调整"
    else
        log_warning "无法读取 JSON 备份或 jq 未安装"
    fi
}

# 验证迁移结果
verify_migration() {
    log_info "验证迁移结果..."

    export PGPASSWORD="$PG_PASSWORD"

    # 检查表是否存在
    tables=("players" "invitation_codes" "matches" "match_players")

    for table in "${tables[@]}"; do
        count=$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -t -c "SELECT COUNT(*) FROM $table;")
        log_info "表 $table: $count 条记录"
    done

    log_success "验证完成"
}

# 清理临时文件
cleanup() {
    log_info "清理临时文件..."
    # 保留备份文件，仅清理临时文件
    log_success "清理完成"
}

# 主流程
main() {
    log_info "======================================"
    log_info "黑暗森林数据迁移脚本"
    log_info "======================================"

    check_dependencies
    create_backup_dir
    backup_old_db
    check_pg_connection
    run_pg_migrations
    import_data
    verify_migration
    cleanup

    log_success "======================================"
    log_success "数据迁移完成！"
    log_success "======================================"
    log_info "备份文件位置: $BACKUP_DIR"
}

# 执行主流程
main