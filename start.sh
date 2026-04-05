#!/usr/bin/env bash
# ============================================================
# 黑暗森林 (Dark Forest) - 一键 Docker 启动脚本
# 用途：个人自用，快速启动/重启服务
# 用法：./start.sh
# ============================================================

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印函数
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检查依赖
check_dependencies() {
    if ! command -v docker &> /dev/null; then
        error "Docker 未安装，请先安装 Docker"
        exit 1
    fi
    
    if ! docker compose version &> /dev/null; then
        error "Docker Compose 未安装，请确保 Docker Desktop 已安装"
        exit 1
    fi
}

# 检查并生成密钥
setup_env() {
    local env_file=".env.auto"
    
    if [ -f "$env_file" ]; then
        warn "发现已存在的配置文件: $env_file"
        read -p "是否重新生成配置? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            info "使用现有配置: $env_file"
            return
        fi
    fi
    
    info "生成环境变量配置文件..."
    
    # 生成密钥
    local jwt_secret
    local admin_secret
    
    if command -v openssl &> /dev/null; then
        jwt_secret=$(openssl rand -base64 32)
        admin_secret=$(openssl rand -base64 32)
    else
        warn "openssl 未安装，使用随机字符串生成密钥"
        jwt_secret=$(head -c 64 /dev/urandom | base64 2>/dev/null || echo "jwt-secret-$(date +%s)")
        admin_secret=$(head -c 64 /dev/urandom | base64 2>/dev/null || echo "admin-secret-$(date +%s)")
    fi
    
    # 创建 .env.auto 文件
    cat > "$env_file" << EOF
# 黑暗森林自动生成的配置文件
# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')
# 此文件已添加到 .gitignore，不会被提交

JWT_SECRET=${jwt_secret}
ADMIN_SECRET_KEY=${admin_secret}
PRISMA_LOG_LEVEL=error
NEXT_PUBLIC_WEBSOCKET_PORT=3003
WEBSOCKET_PORT=3003
EOF
    
    success "配置文件已生成: $env_file"
    info "请妥善保管以下密钥（已保存到 $env_file）："
    echo -e "  JWT_SECRET: ${YELLOW}${jwt_secret:0:20}...${NC}"
    echo -e "  ADMIN_SECRET_KEY: ${YELLOW}${admin_secret:0:20}...${NC}"
}

# 停止现有服务
stop_existing() {
    if docker ps --format '{{.Names}}' | grep -q "darkforest-app"; then
        info "停止现有服务..."
        docker compose -f docker-compose.production.yml down 2>/dev/null || true
        success "现有服务已停止"
    fi
}

# 构建并启动服务
start_services() {
    info "构建并启动服务（首次构建可能需要几分钟）..."
    
    # 使用自动生成的环境变量文件
    docker compose -f docker-compose.production.yml --env-file .env.auto up -d --build
    
    success "服务已启动！"
    echo
    info "服务访问地址："
    echo -e "  🌐 HTTP:     ${GREEN}http://localhost:3000${NC}"
    echo -e "  🔌 WebSocket: ${GREEN}ws://localhost:3003${NC}"
    echo
    info "常用命令："
    echo -e "  查看日志:   ${YELLOW}docker compose -f docker-compose.production.yml logs -f app${NC}"
    echo -e "  停止服务:   ${YELLOW}docker compose -f docker-compose.production.yml down${NC}"
    echo -e "  重启服务:   ${YELLOW}docker compose -f docker-compose.production.yml restart${NC}"
    echo -e "  查看状态:   ${YELLOW}docker compose -f docker-compose.production.yml ps${NC}"
}

# 等待服务就绪
wait_for_health() {
    info "等待服务健康检查..."
    local max_attempts=30
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if docker compose -f docker-compose.production.yml ps | grep -q "(healthy)"; then
            success "服务已就绪！"
            return
        fi
        attempt=$((attempt + 1))
        echo -ne "\r  等待中... ($attempt/$max_attempts)"
        sleep 2
    done
    
    echo
    warn "服务可能尚未就绪，请检查日志: docker compose -f docker-compose.production.yml logs -f app"
}

# 主流程
main() {
    echo -e "${BLUE}"
    echo "========================================"
    echo "  黑暗森林 (Dark Forest) 一键启动"
    echo "========================================"
    echo -e "${NC}"
    
    # 1. 检查依赖
    check_dependencies
    
    # 2. 设置环境变量
    setup_env
    
    # 3. 停止现有服务
    stop_existing
    
    # 4. 构建并启动
    start_services
    
    # 5. 等待健康检查
    wait_for_health
    
    echo
    success "🎉 黑暗森林已启动完成！"
    echo
}

# 执行主流程
main
