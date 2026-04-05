#!/bin/bash
# ============================================================
# 黑暗森林 (Dark Forest) - 生产部署脚本
# 优化：缓存构建、优雅更新、错误处理、部署验证
# 用法: ./deploy.sh [--rebuild] [--rollback]
# ============================================================

set -euo pipefail

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
COMPOSE_FILE="docker-compose.production.yml"
BACKUP_DIR="./backups"
MAX_BACKUPS=5

# 工具函数
log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 解析参数
REBUILD=false
ROLLBACK=false
for arg in "$@"; do
  case $arg in
    --rebuild) REBUILD=true; shift ;;
    --rollback) ROLLBACK=true; shift ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

# ============================================================
echo "=========================================="
echo "  黑暗森林 - 生产环境部署"
echo "=========================================="

# -------------------- 预检查 --------------------

# 检查 Docker
if ! command -v docker &> /dev/null; then
  log_error "Docker 未安装"
  exit 1
fi

if ! docker compose version &> /dev/null; then
  log_error "Docker Compose 未安装"
  exit 1
fi

# 检查环境变量
if [ ! -f .env ]; then
  log_error "未找到 .env 文件"
  log_info "执行: cp .env.example .env"
  exit 1
fi

# 检查密钥安全性
if grep -q "your-super-secret-jwt-key" .env; then
  log_warn "JWT_SECRET 使用默认值，生产环境请修改！"
  log_info "生成: openssl rand -base64 32"
  read -p "是否继续？(y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

if grep -q "your-admin-secret-key" .env; then
  log_warn "ADMIN_SECRET_KEY 使用默认值，生产环境请修改！"
fi

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# -------------------- 回滚模式 --------------------
if [ "$ROLLBACK" = true ]; then
  log_info "回滚到上一个版本..."
  
  LATEST_BACKUP=$(ls -t "$BACKUP_DIR" 2>/dev/null | head -n1)
  if [ -z "$LATEST_BACKUP" ]; then
    log_error "没有找到备份文件"
    exit 1
  fi
  
  log_info "恢复备份: $LATEST_BACKUP"
  docker compose -f "$COMPOSE_FILE" down
  tar -xzf "$BACKUP_DIR/$LATEST_BACKUP" -C "$BACKUP_DIR/"
  docker compose -f "$COMPOSE_FILE" up -d
  log_ok "回滚完成"
  exit 0
fi

# -------------------- 备份数据库 --------------------
log_info "备份数据库..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/db_$TIMESTAMP.db"

if docker compose -f "$COMPOSE_FILE" ps app | grep -q "Up"; then
  docker compose -f "$COMPOSE_FILE" exec -T app cp /app/db/custom.db /tmp/db_backup.db || true
  docker cp darkforest-app:/tmp/db_backup.db "$BACKUP_FILE" 2>/dev/null || true
  
  if [ -f "$BACKUP_FILE" ]; then
    log_ok "数据库已备份: $BACKUP_FILE"
  else
    log_warn "备份失败（数据库可能不存在）"
  fi
else
  log_info "应用未运行，跳过备份"
fi

# 清理旧备份（保留最近 N 个）
ls -t "$BACKUP_DIR"/db_*.db 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm -f

# -------------------- 构建镜像 --------------------
if [ "$REBUILD" = true ]; then
  log_info "完全重建镜像（无缓存）..."
  docker compose -f "$COMPOSE_FILE" build --no-cache
else
  log_info "构建镜像（使用缓存加速）..."
  docker compose -f "$COMPOSE_FILE" build --pull
fi

# -------------------- 优雅更新 --------------------
log_info "启动服务..."

# 检查是否有旧容器在运行
if docker compose -f "$COMPOSE_FILE" ps app | grep -q "Up"; then
  log_info "优雅停止旧容器..."
  docker compose -f "$COMPOSE_FILE" up -d --no-deps --scale app=0 app 2>/dev/null || true
fi

# 启动/更新服务
docker compose -f "$COMPOSE_FILE" up -d

# -------------------- 数据库迁移 --------------------
log_info "等待应用启动..."
RETRY=0
MAX_RETRIES=15
until docker compose -f "$COMPOSE_FILE" exec -T app wget -qO- http://localhost:3000/api/health &>/dev/null || [ $RETRY -ge $MAX_RETRIES ]; do
  sleep 2
  RETRY=$((RETRY + 1))
done

if [ $RETRY -ge $MAX_RETRIES ]; then
  log_error "应用启动超时"
  docker compose -f "$COMPOSE_FILE" logs app
  exit 1
fi

log_info "执行数据库迁移..."
if docker compose -f "$COMPOSE_FILE" exec -T app bunx prisma db push --accept-data-loss; then
  log_ok "数据库迁移成功"
else
  log_error "数据库迁移失败，查看日志："
  docker compose -f "$COMPOSE_FILE" logs app
  exit 1
fi

# -------------------- 验证部署 --------------------
log_info "验证部署..."

# 检查健康状态
HEALTH=$(docker compose -f "$COMPOSE_FILE" ps --format json | grep -o '"health":"[^"]*"' | head -n1)
if echo "$HEALTH" | grep -q "healthy"; then
  log_ok "健康检查通过"
else
  log_warn "健康检查未通过（可能仍在启动中）"
fi

# 检查端口
if curl -sf http://localhost:3000/api/health &>/dev/null; then
  log_ok "API 端点可访问"
else
  log_warn "API 端点不可达（检查网络配置）"
fi

# -------------------- 完成 --------------------
echo ""
echo "=========================================="
echo -e "  ${GREEN}部署完成！${NC}"
echo "=========================================="
echo ""
echo "  访问地址: http://localhost:3000"
echo "  查看日志: docker compose -f $COMPOSE_FILE logs -f"
echo "  查看状态: docker compose -f $COMPOSE_FILE ps"
echo "  回滚命令: ./deploy.sh --rollback"
echo ""
