# 黑暗森林 (Dark Forest) - 部署文档

## 目录

- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [环境变量说明](#环境变量说明)
- [Docker 部署](#docker-部署)
- [手动部署](#手动部署)
- [常见问题](#常见问题)

---

## 环境要求

### 开发环境

- **Go**: 1.23+ (推荐 1.23.5)
- **Node.js**: 20+ (推荐 20.11)
- **pnpm**: 8+ (推荐 8.15)
- **PostgreSQL**: 16+ (推荐 16.2)
- **Docker**: 24+ (可选，用于容器化部署)
- **Docker Compose**: 2.20+ (可选)

### 生产环境

- **Docker**: 24+ (推荐使用容器化部署)
- **PostgreSQL**: 16+ (推荐使用云数据库服务)
- **Caddy**: 2.7+ (反向代理，可选)
- **内存**: 最小 512MB，推荐 1GB+
- **CPU**: 最小 1 核，推荐 2 核+

---

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/your-org/darkforest.git
cd darkforest
```

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 编辑环境变量
nano backend/.env
nano frontend/.env
```

### 3. 启动 PostgreSQL

```bash
# 使用 Docker Compose 启动 PostgreSQL
docker compose up -d postgres

# 等待 PostgreSQL 启动
sleep 5
```

### 4. 运行数据库迁移

```bash
cd backend

# 安装 golang-migrate 工具
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

# 运行迁移
make migrate-up

# 或使用 Docker
make docker-up
make migrate-up
```

### 5. 构建并启动服务

```bash
# 构建前端
cd frontend
pnpm install
pnpm build

# 构建后端
cd ../backend
make build

# 启动服务
./bin/server
```

---

## 环境变量说明

### 后端环境变量 (backend/.env)

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `DATABASE_URL` | 是 | - | PostgreSQL 连接字符串<br>格式: `postgres://user:password@host:port/database?sslmode=disable` |
| `JWT_SECRET` | 是 | - | JWT 签名密钥<br>生成: `openssl rand -base64 32` |
| `ADMIN_SECRET_KEY` | 是 | - | 管理员初始化密钥<br>生成: `openssl rand -base64 32` |
| `PORT` | 否 | `8080` | HTTP 服务端口 |
| `STATIC_DIR` | 否 | `/app/static` | 前端静态资源目录 |
| `CORS_ALLOW_ORIGINS` | 否 | `*` | CORS 允许的域名<br>生产环境应限制为实际域名<br>多个域名用逗号分隔 |
| `ENVIRONMENT` | 否 | `development` | 运行环境<br>`development` 或 `production` |
| `LOG_LEVEL` | 否 | `info` | 日志级别<br>`debug`, `info`, `warn`, `error` |

### 前端环境变量 (frontend/.env)

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `VITE_API_BASE_URL` | 否 | `/api` | API 基础路径 |
| `VITE_WS_URL` | 否 | `/ws` | WebSocket 连接路径 |

### Docker Compose 环境变量

在 `docker-compose.production.new.yml` 中，以下环境变量必须设置：

```bash
# 创建 .env 文件
cat > .env << EOF
JWT_SECRET=$(openssl rand -base64 32)
ADMIN_SECRET_KEY=$(openssl rand -base64 32)
CORS_ALLOW_ORIGINS=https://your-domain.com
EOF
```

---

## Docker 部署

### 使用 Docker Compose（推荐）

#### 1. 构建镜像

```bash
# 构建镜像
docker compose -f docker-compose.production.new.yml build
```

#### 2. 启动服务

```bash
# 启动所有服务
docker compose -f docker-compose.production.new.yml up -d

# 查看服务状态
docker compose -f docker-compose.production.new.yml ps

# 查看日志
docker compose -f docker-compose.production.new.yml logs -f app
```

#### 3. 停止服务

```bash
# 停止服务
docker compose -f docker-compose.production.new.yml down

# 停止并清理数据
docker compose -f docker-compose.production.new.yml down -v
```

### 仅使用 Dockerfile

#### 1. 构建镜像

```bash
# 构建镜像
docker build -f Dockerfile.new -t darkforest:latest .
```

#### 2. 运行容器

```bash
# 运行容器（需要 PostgreSQL）
docker run -d \
  --name darkforest-app \
  -p 8080:8080 \
  -e DATABASE_URL="postgres://darkforest:darkforest_secret@postgres-host:5432/darkforest?sslmode=disable" \
  -e JWT_SECRET="your-jwt-secret" \
  -e ADMIN_SECRET_KEY="your-admin-secret" \
  darkforest:latest
```

---

## 手动部署

### 1. 安装依赖

#### Go 后端

```bash
cd backend
go mod download
```

#### 前端

```bash
cd frontend
pnpm install
```

### 2. 构建应用

#### Go 后端

```bash
cd backend
make build
```

#### 前端

```bash
cd frontend
pnpm build
```

### 3. 配置 PostgreSQL

```bash
# 创建数据库
psql -U postgres -c "CREATE DATABASE darkforest;"

# 创建用户
psql -U postgres -c "CREATE USER darkforest WITH PASSWORD 'darkforest_secret';"

# 授权
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE darkforest TO darkforest;"
```

### 4. 运行迁移

```bash
cd backend
make migrate-up
```

### 5. 启动服务

#### 使用 systemd（推荐）

创建 systemd 服务文件：

```bash
# /etc/systemd/system/darkforest.service
[Unit]
Description=Dark Forest Game Server
After=network.target postgresql.service

[Service]
Type=simple
User=darkforest
WorkingDirectory=/opt/darkforest
ExecStart=/opt/darkforest/bin/server
Restart=on-failure
RestartSec=5s

Environment=DATABASE_URL=postgres://darkforest:darkforest_secret@localhost:5432/darkforest
Environment=JWT_SECRET=your-jwt-secret
Environment=ADMIN_SECRET_KEY=your-admin-secret
Environment=PORT=8080
Environment=STATIC_DIR=/opt/darkforest/static
Environment=ENVIRONMENT=production

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable darkforest
sudo systemctl start darkforest
sudo systemctl status darkforest
```

#### 直接运行

```bash
cd backend
./bin/server
```

---

## 常见问题

### 1. PostgreSQL 连接失败

**症状**: `connection refused` 或 `authentication failed`

**解决方案**:
- 检查 PostgreSQL 服务是否运行: `systemctl status postgresql`
- 检查连接字符串格式是否正确
- 检查用户名和密码是否正确
- 检查防火墙是否允许 PostgreSQL 端口 (5432)

### 2. JWT 验证失败

**症状**: `token is invalid` 或 `signature is invalid`

**解决方案**:
- 确保 `JWT_SECRET` 环境变量正确设置
- 确保 JWT_SECRET 在前后端一致
- 检查 token 是否过期

### 3. CORS 错误

**症状**: 浏览器控制台显示 CORS 错误

**解决方案**:
- 设置 `CORS_ALLOW_ORIGINS` 为实际域名
- 确保前端请求路径正确 (`/api` 和 `/ws`)
- 检查 Caddyfile 配置是否正确

### 4. WebSocket 连接失败

**症状**: WebSocket 连接立即断开

**解决方案**:
- 检查 WebSocket 路径是否正确 (`/ws`)
- 检查 JWT token 是否有效
- 检查反向代理配置是否支持 WebSocket

### 5. 前端静态资源加载失败

**症状**: 404 错误或页面空白

**解决方案**:
- 检查 `STATIC_DIR` 环境变量是否正确
- 检查前端构建产物是否存在于指定目录
- 检查 Caddyfile 的静态资源配置

### 6. 数据迁移失败

**症状**: 迁移脚本执行失败

**解决方案**:
- 检查 SQLite 数据库文件是否存在
- 检查 PostgreSQL 连接是否正常
- 查看 `scripts/migrate-db.sh` 的日志输出
- 手动执行迁移 SQL 文件

---

## 性能优化建议

### 1. 数据库优化

- 使用连接池（已在代码中实现）
- 定期清理过期数据
- 为常用查询字段添加索引

### 2. 应用优化

- 启用 GZIP 压缩（Caddy 自动支持）
- 使用 CDN 加速静态资源
- 配置合理的资源限制（Docker）

### 3. 监控与日志

- 使用结构化日志（JSON 格式）
- 配置日志轮转（Docker logging）
- 监控关键指标（CPU、内存、连接数）

---

## 安全建议

### 1. 密钥管理

- 不要将密钥提交到 Git
- 使用环境变量或密钥管理服务
- 定期更换 JWT_SECRET

### 2. CORS 配置

- 生产环境限制 CORS 允许的域名
- 不要使用 `*` 作为 CORS_ALLOW_ORIGINS

### 3. 数据库安全

- 使用强密码
- 限制数据库访问 IP
- 定期备份数据

### 4. 网络安全

- 使用 HTTPS（Caddy 自动支持）
- 配置防火墙规则
- 使用反向代理隐藏内部服务

---

## 相关文档

- [运维手册 (RUNBOOK.md)](./RUNBOOK.md)
- [架构文档 (ARCHITECTURE.md)](./ARCHITECTURE.md)
- [任务清单 (.trae/specs/tasks.md)](../.trae/specs/tasks.md)