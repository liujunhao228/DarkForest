# GPT-Load Docker 容器化部署方案

## 目录
- [概述](#概述)
- [架构设计](#架构设计)
- [文件说明](#文件说明)
- [快速开始](#快速开始)
- [配置详解](#配置详解)
- [高级部署](#高级部署)
- [运维管理](#运维管理)
- [最佳实践](#最佳实践)

---

## 概述

GPT-Load 采用 **多阶段 Docker 构建** + **Docker Compose 编排** 的容器化部署方案，支持：

- ✅ 多平台镜像构建（linux/amd64, linux/arm64）
- ✅ 前端（Vue/Vite）+ 后端（Go）分离构建
- ✅ 多数据库支持（SQLite/MySQL/PostgreSQL）
- ✅ 缓存支持（Redis/内存缓存）
- ✅ 健康检查与自动重启
- ✅ 优雅停机（Graceful Shutdown）
- ✅ 数据持久化（Volumes）
- ✅ 环境变量配置

---

## 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────┐
│           Docker Compose                    │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────────┐  ┌──────────┐  ┌───────┐ │
│  │  GPT-Load    │  │  MySQL   │  │ Redis │ │
│  │  (主服务)     │  │ (可选)    │  │(可选)  │ │
│  │  Port: 3001  │  │  Port    │  │ Port  │ │
│  │              │  │  :3306   │  │ :6379 │ │
│  └──────────────┘  └──────────┘  └───────┘ │
│         ↓                  ↓          ↓     │
│  ┌──────────────────────────────────────┐   │
│  │         Shared Network               │   │
│  └──────────────────────────────────────┘   │
│         ↓                                    │
│  ┌──────────────────────────────────────┐   │
│  │       Volume: ./data:/app/data       │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### 多阶段构建流程

```
Stage 1: 前端构建                Stage 2: 后端编译              Stage 3: 运行镜像
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│  node:20-alpine  │        │ golang:1.24-alpine│        │     alpine       │
│                  │        │                  │        │                  │
│  1. npm ci       │ ───→   │  1. go mod       │ ───→   │  1. ca-certificates│
│  2. npm run build│        │     download     │        │  2. tzdata       │
│                  │        │  2. go build     │        │  3. gpt-load 二进制│
│  输出: web/dist  │        │     (含dist)      │        │  4. EXPOSE 3001  │
└──────────────────┘        └──────────────────┘        └──────────────────┘
```

---

## 文件说明

### 核心文件清单

| 文件 | 用途 | 说明 |
|------|------|------|
| `Dockerfile` | 镜像构建文件 | 三阶段构建：前端 → 后端 → 运行 |
| `docker-compose.yml` | 服务编排 | 定义主服务及可选数据库/缓存 |
| `.dockerignore` | 构建排除 | 排除 .git、node_modules、dist 等 |
| `.env.example` | 配置模板 | 环境变量配置参考 |
| `Makefile` | 开发工具 | 本地开发/构建/密钥迁移命令 |

### Dockerfile 详解

```dockerfile
# Stage 1: 前端构建
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
# 使用 Node.js 20 Alpine 版本，体积更小
# $BUILDPLATFORM 由 Docker Buildx 自动注入，支持跨平台构建

ARG VERSION=1.0.0
WORKDIR /build
COPY ./web/package*.json ./
RUN npm ci                    # 安装前端依赖（精确安装，基于 package-lock.json）
COPY ./web .
RUN VITE_VERSION=${VERSION} npm run build  # 构建前端资源到 dist/

# Stage 2: 后端编译
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS builder2
# Go 1.24 Alpine，支持交叉编译

ARG VERSION=1.0.0
ARG TARGETOS
ARG TARGETARCH
ENV GO111MODULE=on \
    CGO_ENABLED=0             # 禁用 CGO，生成静态二进制

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download           # 下载 Go 依赖（利用 Docker 缓存层）

COPY . .
COPY --from=builder /build/dist ./web/dist  # 从 Stage 1 复制前端资源
RUN GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags "-s -w \
    -X gpt-load/internal/version.Version=${VERSION}" \
    -o gpt-load               # 编译并注入版本号

# Stage 3: 运行镜像
FROM alpine
# 最终运行镜像，仅包含运行时需要的文件

WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata \
    && update-ca-certificates  # 安装证书和时区数据

COPY --from=builder2 /build/gpt-load .
EXPOSE 3001
ENTRYPOINT ["/app/gpt-load"]   # 启动命令
```

### .dockerignore 说明

```
.git              # 排除 Git 历史（减小镜像体积）
.github           # 排除 GitHub Actions 配置
gpt-load          # 排除本地构建的二进制文件
data              # 排除本地数据目录
tmp               # 排除临时文件
web/node_modules  # 排除前端依赖（在容器内重新安装）
web/dist          # 排除前端构建产物（在容器内重新构建）
*.log             # 排除日志文件
.DS_Store         # 排除 macOS 系统文件
```

---

## 快速开始

### 1. 环境准备

```bash
# 安装 Docker 和 Docker Compose
# 验证安装
docker --version
docker compose version
```

### 2. 创建配置文件

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置（必须设置 AUTH_KEY）
vim .env
```

**最小化配置（使用 SQLite + 内存缓存）：**

```env
# 基础配置
PORT=3001
HOST=0.0.0.0
TZ=Asia/Shanghai

# 安全配置（必须设置！）
AUTH_KEY=your-secure-random-string-here
ENCRYPTION_KEY=your-encryption-key-here

# 使用默认 SQLite（无需额外配置）
DATABASE_DSN=

# 使用内存缓存（无需 Redis）
REDIS_DSN=

# 日志配置
LOG_LEVEL=info
LOG_FORMAT=text
LOG_ENABLE_FILE=true
LOG_FILE_PATH=./data/logs/app.log
```

### 3. 启动服务

```bash
# 后台启动
docker compose up -d

# 查看日志
docker compose logs -f

# 检查服务状态
docker compose ps
```

### 4. 验证部署

```bash
# 检查健康状态
curl http://localhost:3001/health

# 访问管理界面
# 浏览器打开：http://localhost:3001
```

---

## 配置详解

### 环境变量完整说明

#### 服务器配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3001 | 服务监听端口 |
| `HOST` | 0.0.0.0 | 绑定地址 |
| `SERVER_READ_TIMEOUT` | 60 | 读取超时（秒） |
| `SERVER_WRITE_TIMEOUT` | 600 | 写入超时（秒） |
| `SERVER_IDLE_TIMEOUT` | 120 | 空闲超时（秒） |
| `SERVER_GRACEFUL_SHUTDOWN_TIMEOUT` | 10 | 优雅停机超时（秒） |

#### 集群配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `IS_SLAVE` | false | 是否作为集群的从节点 |

#### 本地化

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TZ` | Asia/Shanghai | 时区设置 |

#### 安全配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AUTH_KEY` | (空) | **必须设置**，管理 API 和 UI 的认证密钥 |
| `ENCRYPTION_KEY` | (空) | 加密 API 密钥的密钥，留空则禁用加密 |

#### 数据库配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_DSN` | (空) | 留空使用 SQLite：`./data/gpt-load.db` |

**MySQL 连接串示例：**
```env
DATABASE_DSN=root:123456@tcp(mysql:3306)/gpt-load?charset=utf8mb4&parseTime=True&loc=Local
```

**PostgreSQL 连接串示例：**
```env
DATABASE_DSN=postgres://postgres:123456@postgres:5432/gpt-load?sslmode=disable
```

#### 缓存配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REDIS_DSN` | (空) | 留空使用内存缓存 |

**Redis 连接串示例：**
```env
REDIS_DSN=redis://redis:6379/0
```

#### 性能配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAX_CONCURRENT_REQUESTS` | 100 | 最大并发请求数 |

#### CORS 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENABLE_CORS` | true | 是否启用跨域资源共享 |
| `ALLOWED_ORIGINS` | * | 允许的源 |
| `ALLOWED_METHODS` | GET,POST,PUT,DELETE,OPTIONS | 允许的 HTTP 方法 |
| `ALLOWED_HEADERS` | * | 允许的请求头 |
| `ALLOW_CREDENTIALS` | false | 是否允许携带凭证 |

#### 日志配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LOG_LEVEL` | info | 日志级别（debug/info/warn/error） |
| `LOG_FORMAT` | text | 日志格式（text/json） |
| `LOG_ENABLE_FILE` | true | 是否启用文件日志 |
| `LOG_FILE_PATH` | ./data/logs/app.log | 日志文件路径 |

---

## 高级部署

### 方案一：使用预构建镜像（推荐）

```yaml
# docker-compose.yml（默认配置）
services:
  gpt-load:
    image: ghcr.io/tbphp/gpt-load:latest
    container_name: gpt-load
    ports:
      - "3001:3001"
    env_file:
      - .env
    restart: always
    volumes:
      - ./data:/app/data
```

**启动命令：**
```bash
docker compose up -d
```

### 方案二：本地源码构建

```yaml
# docker-compose.yml（修改为本地构建）
services:
  gpt-load:
    # image: ghcr.io/tbphp/gpt-load:latest  # 注释掉
    build:
      context: .
      dockerfile: Dockerfile
      args:
        VERSION: 1.0.0  # 可选：指定版本号
    container_name: gpt-load
    # ... 其他配置保持不变
```

**构建并启动：**
```bash
# 构建镜像
docker compose build

# 启动服务
docker compose up -d
```

### 方案三：完整集群部署（含 MySQL + Redis）

#### 1. 准备环境变量

```env
# .env 文件
PORT=3001
HOST=0.0.0.0
AUTH_KEY=your-very-long-random-string
ENCRYPTION_KEY=your-encryption-key

# 使用 MySQL
DATABASE_DSN=root:123456@tcp(mysql:3306)/gpt-load?charset=utf8mb4&parseTime=True&loc=Local

# 使用 Redis
REDIS_DSN=redis://redis:6379/0

# 集群配置（主节点）
IS_SLAVE=false

# 时区
TZ=Asia/Shanghai

# 日志
LOG_LEVEL=info
LOG_FORMAT=json
LOG_ENABLE_FILE=true
LOG_FILE_PATH=./data/logs/app.log
```

#### 2. 修改 docker-compose.yml

```yaml
services:
  gpt-load:
    image: ghcr.io/tbphp/gpt-load:latest
    container_name: gpt-load
    ports:
      - "3001:3001"
    env_file:
      - .env
    restart: always
    volumes:
      - ./data:/app/data
    stop_grace_period: 10s
    healthcheck:
      test: wget -q --spider -T 10 -O /dev/null http://localhost:3001/health
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    depends_on:
      mysql:
        condition: service_healthy
        restart: true
      redis:
        condition: service_healthy
        restart: true

  mysql:
    image: mysql:8.2
    container_name: gpt-load-mysql
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: 123456
      MYSQL_DATABASE: gpt-load
    volumes:
      - ./data/mysql:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: gpt-load-redis
    restart: always
    volumes:
      - ./data/redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 3
```

#### 3. 启动服务

```bash
# 启动所有服务
docker compose up -d

# 查看服务状态
docker compose ps

# 查看 MySQL 是否正常启动
docker compose logs mysql

# 查看 Redis 是否正常启动
docker compose logs redis
```

### 方案四：多节点集群部署

```yaml
# master 节点 docker-compose.master.yml
services:
  gpt-load-master:
    image: ghcr.io/tbphp/gpt-load:latest
    container_name: gpt-load-master
    ports:
      - "3001:3001"
    environment:
      - IS_SLAVE=false
      - AUTH_KEY=your-master-key
      - DATABASE_DSN=redis://redis-master:6379/0
    volumes:
      - ./data:/app/data

# slave 节点 docker-compose.slave.yml
services:
  gpt-load-slave:
    image: ghcr.io/tbphp/gpt-load:latest
    container_name: gpt-load-slave
    ports:
      - "3001:3001"
    environment:
      - IS_SLAVE=true
      - AUTH_KEY=your-master-key
      - DATABASE_DSN=redis://redis-master:6379/0
    volumes:
      - ./data:/app/data
```

---

## 运维管理

### 日常运维

```bash
# 查看服务状态
docker compose ps

# 查看实时日志
docker compose logs -f

# 查看最近 100 行日志
docker compose logs --tail=100 gpt-load

# 重启服务
docker compose restart gpt-load

# 停止服务
docker compose down

# 停止并删除所有数据卷（⚠️ 危险操作！）
docker compose down -v
```

### 健康检查

```bash
# 检查服务健康状态
docker inspect --format='{{.State.Health.Status}}' gpt-load

# 手动调用健康检查
curl http://localhost:3001/health

# 查看健康检查日志
docker inspect --format='{{json .State.Health}}' gpt-load | jq
```

### 数据备份

```bash
# 备份 SQLite 数据库
docker compose down
tar czf backup-$(date +%Y%m%d-%H%M%S).tar.gz ./data/
docker compose up -d

# 备份 MySQL 数据库
docker exec gpt-load-mysql mysqldump -u root -p123456 gpt-load > backup.sql

# 恢复 MySQL 数据库
docker exec -i gpt-load-mysql mysql -u root -p123456 gpt-load < backup.sql
```

### 版本升级

```bash
# 方式一：使用最新镜像
docker compose pull
docker compose up -d

# 方式二：构建指定版本
docker compose build --build-arg VERSION=2.0.0
docker compose up -d

# 升级前备份
docker compose down
tar czf backup-before-upgrade.tar.gz ./data/
docker compose up -d
```

### 日志管理

```bash
# 查看日志文件
tail -f ./data/logs/app.log

# 按日期轮转日志
find ./data/logs/ -name "*.log" -mtime +7 -delete

# 查看错误日志
grep -i "error\|fatal" ./data/logs/app.log | tail -50
```

### 密钥迁移

```bash
# 查看密钥迁移帮助
docker compose run --rm gpt-load migrate-keys --help

# 启用加密（从明文到加密）
docker compose run --rm gpt-load migrate-keys --to new-encryption-key

# 禁用加密（从加密到明文）
docker compose run --rm gpt-load migrate-keys --from old-encryption-key

# 更换密钥
docker compose run --rm gpt-load migrate-keys \
  --from old-key \
  --to new-key

# ⚠️ 重要：执行前务必备份数据库！
```

---

## 最佳实践

### 1. 安全加固

```env
# .env 文件安全建议

# ✅ 使用长随机字符串（至少 32 字符）
AUTH_KEY=$(openssl rand -base64 32)

# ✅ 启用加密保护 API 密钥
ENCRYPTION_KEY=$(openssl rand -base64 32)

# ✅ 限制 CORS 源
ENABLE_CORS=true
ALLOWED_ORIGINS=https://your-domain.com

# ✅ 使用生产级数据库
DATABASE_DSN=postgres://user:pass@postgres:5432/gpt-load

# ✅ 设置合理的超时时间
SERVER_READ_TIMEOUT=60
SERVER_WRITE_TIMEOUT=600
SERVER_IDLE_TIMEOUT=120
```

### 2. 性能优化

```yaml
# docker-compose.yml 性能优化示例
services:
  gpt-load:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
    
    # 使用 tmpfs 提升日志性能
    tmpfs:
      - /tmp
    
    # 优化日志驱动
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 3. 监控告警

```yaml
# 集成 Prometheus 监控（需要额外部署）
services:
  gpt-load:
    labels:
      - "prometheus.scrape=true"
      - "prometheus.port=3001"
      - "prometheus.path=/metrics"
```

### 4. 多环境配置

```bash
# 目录结构
.env                # 默认配置
.env.development    # 开发环境
.env.staging        # 预发环境
.env.production     # 生产环境
```

```bash
# 使用不同环境文件启动
docker compose --env-file .env.production up -d
```

### 5. CI/CD 集成

```yaml
# .github/workflows/deploy.yml 示例
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build and Deploy
        run: |
          docker compose build --build-arg VERSION=${{ github.sha }}
          docker compose up -d
```

### 6. 故障排查

```bash
# 检查容器状态
docker inspect gpt-load

# 进入容器调试
docker exec -it gpt-load sh

# 查看网络配置
docker compose exec gpt-load wget -q -O - http://localhost:3001/health

# 测试数据库连接
docker compose run --rm gpt-load sh -c 'echo "Testing DB connection..."'

# 查看资源使用
docker stats gpt-load

# 清理无用镜像
docker image prune -a
```

### 7. 生产检查清单

部署到生产环境前，请确认：

- [ ] `AUTH_KEY` 已设置为长随机字符串
- [ ] `ENCRYPTION_KEY` 已设置（如需加密存储 API 密钥）
- [ ] 使用 MySQL 或 PostgreSQL 替代 SQLite
- [ ] 使用 Redis 替代内存缓存（多节点部署）
- [ ] 数据卷已正确备份
- [ ] 健康检查配置正常
- [ ] 日志轮转已配置
- [ ] CORS 源已限制（非 `*`）
- [ ] 资源限制已配置（CPU/内存）
- [ ] 优雅停机超时已设置

---

## 常见问题

### Q1: 如何从 SQLite 迁移到 MySQL？

```bash
# 1. 停止服务
docker compose down

# 2. 备份 SQLite 数据
cp ./data/gpt-load.db ./data/gpt-load.db.bak

# 3. 启动 MySQL
docker compose up -d mysql

# 4. 修改 .env 中的 DATABASE_DSN
# DATABASE_DSN=root:123456@tcp(mysql:3306)/gpt-load?charset=utf8mb4&parseTime=True&loc=Local

# 5. 启动服务（会自动创建表）
docker compose up -d gpt-load

# 6. 使用 API 或手动迁移数据
```

### Q2: 如何修改端口？

```env
# .env 文件
PORT=8080
```

```yaml
# docker-compose.yml（端口映射会自动跟随 PORT 变量）
ports:
  - "${PORT:-3001}:${PORT:-3001}"
```

### Q3: 数据持久化在哪里？

```
./data/                    # 映射到容器内 /app/data
├── gpt-load.db           # SQLite 数据库（如使用）
├── logs/
│   └── app.log           # 应用日志
└── mysql/                # MySQL 数据（如启用）
└── postgres/             # PostgreSQL 数据（如启用）
```

### Q4: 如何查看容器资源占用？

```bash
# 实时查看
docker stats gpt-load

# 查看详细信息
docker inspect --format='{{.State.Pid}}' gpt-load
```

---

## 参考资料

- [Docker 官方文档](https://docs.docker.com/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- [Go 交叉编译指南](https://go.dev/doc/install/source#environment)
- [Alpine Linux 包管理](https://wiki.alpinelinux.org/wiki/Alpine_Linux_package_management)
