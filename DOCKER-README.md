# 黑暗森林 Docker 部署指南

## 📦 目录

- [快速开始](#快速开始)
- [开发环境](#开发环境)
- [生产环境](#生产环境)
- [常用命令](#常用命令)
- [故障排查](#故障排查)
- [架构说明](#架构说明)
- [安全建议](#安全建议)
- [环境变量管理](#环境变量管理)

---

## 快速开始

### 前置要求

- Docker >= 24.0
- Docker Compose >= 2.20
- Git

### 一键启动开发环境

```bash
# 1. 克隆项目
git clone <repository-url>
cd DarkForest

# 2. 启动开发环境 (自动创建 .env.development)
bun run docker:dev:build

# 3. 访问应用
# http://localhost:3000
# 健康检查: http://localhost:3000/api/health
```

---

## 开发环境

### 启动开发服务器

```bash
# 方式 1: 使用 npm scripts (推荐)
bun run docker:dev

# 方式 2: 使用 docker compose (自动加载 override 文件)
docker compose up

# 后台运行
docker compose up -d

# 强制重新构建
docker compose up --build
```

### 开发环境特性

| 特性 | 说明 |
|------|------|
| **热重载** | 源代码修改自动重新加载 |
| **数据库持久化** | 使用 Docker Volume 保存数据 |
| **端口映射** | 3000 (应用) + 3003 (WebSocket) |
| **自动初始化** | 首次启动自动创建数据库和表 |
| **环境变量** | 自动创建 `.env.development` (可安全提交) |

### 访问服务

| 服务 | 地址 | 说明 |
|------|------|------|
| 主应用 | http://localhost:3000 | Next.js 应用 |
| WebSocket | ws://localhost:3003 | 实时通信 |
| 健康检查 | http://localhost:3000/api/health | Docker 健康状态 |

---

## 生产环境

### 部署步骤

```bash
# 1. 配置生产环境变量
cp .env.example .env

# 2. 生成强随机密钥
openssl rand -base64 32  # 用于 JWT_SECRET
openssl rand -base64 32  # 用于 ADMIN_SECRET_KEY

# 3. 编辑 .env 文件，填入生成的密钥
nano .env

# 4. 构建并启动生产环境
bun run docker:prod:build

# 或分步执行
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 生产环境特性

| 特性 | 说明 |
|------|------|
| **多阶段构建** | 最小化生产镜像体积 (~150MB) |
| **非 root 用户** | 安全运行，防止权限提升 |
| **健康检查** | 自动监控服务状态 (`/api/health`) |
| **资源限制** | CPU 4核 / 内存 4GB 上限 |
| **自动重启** | 崩溃后自动恢复 |
| **本地端口暴露** | 仅 127.0.0.1 监听，配合反向代理 |
| **能力丢弃** | 丢弃所有 Linux capabilities (仅保留 NET_BIND_SERVICE) |
| **日志轮转** | 自动轮转，防止磁盘耗尽 (10MB x 5 文件) |
| **tmpfs** | 临时文件写入内存，避免容器层膨胀 |
| **Caddy 反向代理** | 默认启用，自动 HTTPS/TLS |

---

## 常用命令

### 日常管理

```bash
# 查看运行状态
docker compose ps

# 查看实时日志
bun run docker:logs

# 查看最后 50 行日志
docker compose logs --tail=50 app

# 停止服务
bun run docker:down

# 停止生产服务
bun run docker:down:prod
```

### 数据库操作

```bash
# 进入容器执行 Prisma 命令
docker compose exec app bun run db:push
docker compose exec app bun run db:migrate
docker compose exec app bun run db:generate

# 查看数据库文件
docker compose exec app ls -la /app/db/
```

### 调试与排查

```bash
# 进入应用容器
docker compose exec app sh

# 检查健康状态
docker compose ps

# 查看资源使用
docker stats darkforest-dev

# 检查健康检查端点
docker compose exec app wget -qO- http://localhost:3000/api/health

# 检查网络
docker compose exec app wget -qO- http://localhost:3000/
```

### 清理与重置

```bash
# 停止并删除所有容器 (保留数据卷)
bun run docker:down

# 停止并删除所有容器和数据卷 (⚠️ 危险操作)
bun run docker:clean

# 完全清理 (包括镜像)
docker compose down --rmi all -v
```

---

## 故障排查

### 问题 1: 数据库初始化失败

**症状**: `init-db` 容器报错退出

**解决方案**:
```bash
# 查看初始化日志
docker compose logs init-db

# 删除数据卷重新初始化
docker compose down -v
docker compose up --build
```

### 问题 2: 端口冲突

**症状**: `port is already allocated`

**解决方案**:
```bash
# 检查端口占用
netstat -tulpn | grep :3000
netstat -tulpn | grep :3003

# 修改 docker-compose.yml 中的端口映射
ports:
  - "3001:3000"   # 改为其他端口
```

### 问题 3: Prisma 客户端未生成

**症状**: `@prisma/client` 找不到

**解决方案**:
```bash
docker compose exec app bun run db:generate
```

### 问题 4: 权限问题

**症状**: `EACCES: permission denied`

**解决方案**:
```bash
# 检查文件所有权
docker compose exec app ls -la /app/db/

# 修复权限
docker compose exec app chown -R darkforest:darkforest /app/db
```

### 问题 5: WebSocket 连接失败

**症状**: 前端无法连接 WebSocket

**解决方案**:
1. 确认 3003 端口已暴露
2. 检查 `NEXT_PUBLIC_WEBSOCKET_PORT` 环境变量
3. 查看 WebSocket 服务器日志:
   ```bash
   docker compose logs -f app | grep -i websocket
   ```

### 问题 6: 健康检查失败

**症状**: 容器状态显示 `unhealthy`

**解决方案**:
```bash
# 检查健康检查端点
curl http://localhost:3000/api/health

# 查看健康检查日志
docker compose logs app | grep -i health

# 手动执行健康检查
docker compose exec app wget -qO- http://localhost:3000/api/health
```

---

## 架构说明

### Docker 镜像分层

```
┌─────────────────────────────────────────┐
│  production (最终运行环境)               │
│  - standalone 输出                       │
│  - 非 root 用户                          │
│  - 健康检查 (/api/health)                │
│  - 能力丢弃 (cap_drop: ALL)              │
│  - 日志轮转 (10MB x 5)                   │
├─────────────────────────────────────────┤
│  build (构建阶段)                        │
│  - Next.js 构建                          │
│  - Prisma 生成                           │
├─────────────────────────────────────────┤
│  dev (开发环境)                          │
│  - 完整源代码                            │
│  - 热重载                                │
├─────────────────────────────────────────┤
│  deps (依赖安装)                         │
│  - node_modules                          │
└─────────────────────────────────────────┘
```

### 网络拓扑

```
┌───────────────────────────────────────────┐
│           darkforest-net (bridge)          │
│                                           │
│  ┌─────────┐         ┌─────────────────┐ │
│  │   app   │◄───────►│   init-db       │ │
│  │ :3000   │  内部    │ (一次性初始化)   │ │
│  │ :3003   │  通信    └─────────────────┘ │
│  │         │                              │
│  │ 健康检查:                              │
│  │ /api/health                            │
│  └────┬────┘                              │
│       │                                   │
└───────┼───────────────────────────────────┘
        │
        ▼
  宿主机端口映射 (开发)
  3000:3000
  3003:3003

  生产环境仅绑定 127.0.0.1
  127.0.0.1:3000:3000
  127.0.0.1:3003:3003
```

### 服务发现

容器间通过 Docker 内部 DNS 解析服务名：

| 服务名 | 地址 | 说明 |
|--------|------|------|
| `app` | http://app:3000 | 主应用服务 |
| `app` | ws://app:3003 | WebSocket 服务 |
| `localhost` | http://localhost:3000 | 容器内访问主应用 |

**示例**: 如果未来添加独立数据库服务，可以这样连接：
```
DATABASE_URL=postgresql://user:pass@db:5432/darkforest
# "db" 会被解析到数据库容器的 IP
```

### 数据持久化

| 数据卷 | 用途 | 环境 |
|--------|------|------|
| `dev-db-data` | SQLite 数据库 | 开发 |
| `prod-db-data` | SQLite 数据库 | 生产 |
| `caddy-data` | TLS 证书 | 生产 |
| `caddy-config` | Caddy 配置 | 生产 |

### 文件结构

```
docker-compose.yml              # 基础配置 (所有环境共享)
docker-compose.override.yml     # 开发环境覆盖 (自动加载)
docker-compose.prod.yml         # 生产环境覆盖 (显式加载)
.env.development                # 开发环境变量 (可提交)
.env                            # 生产环境变量 (不提交!)
.env.example                    # 环境变量模板
```

---

## 安全建议

### 生产环境必做

1. **修改密钥**
   ```bash
   # 生成强随机 JWT_SECRET
   openssl rand -base64 32

   # 生成强随机 ADMIN_SECRET_KEY
   openssl rand -base64 32
   ```

2. **不要提交 .env 文件**
   ```bash
   # 确认已加入 .gitignore
   grep ".env" .gitignore
   ```

3. **启用 HTTPS**
   - Caddy 已默认启用，自动配置 TLS
   - 确保域名 DNS 指向服务器 IP
   - 修改 `Caddyfile` 中的域名

4. **定期更新镜像**
   ```bash
   docker compose pull
   docker compose up -d --build
   ```

5. **监控日志**
   ```bash
   # 查看日志 (自动轮转)
   docker compose logs -f app

   # 检查日志文件大小
   docker inspect darkforest-prod --format='{{.LogPath}}'
   ```

### 安全清单

- [x] 非 root 用户运行
- [x] 最小化生产镜像 (Alpine 基础)
- [x] 固定基础镜像版本 (`1.1-alpine3.19`)
- [x] 端口仅本地暴露 (127.0.0.1)
- [x] 健康检查配置 (`/api/health`)
- [x] 资源限制配置
- [x] 能力丢弃 (cap_drop: ALL)
- [x] 日志轮转配置
- [x] 密钥未硬编码 (使用 env_file)
- [ ] 密钥已更换 (生产环境)
- [ ] HTTPS 已启用 (生产环境 - Caddy 自动处理)
- [ ] 日志监控已配置 (生产环境)

---

## 环境变量管理

### 环境文件说明

| 文件 | 用途 | 是否提交 |
|------|------|----------|
| `.env.example` | 生产环境变量模板 | ✅ |
| `.env` | 生产环境变量 (实际值) | ❌ |
| `.env.development` | 开发环境变量 (默认值) | ✅ |

### 开发环境工作流

```bash
# 1. 首次启动自动创建 .env.development
docker compose up

# 2. 如需修改开发环境变量
# 直接编辑 .env.development，然后重启
docker compose restart
```

### 生产环境工作流

```bash
# 1. 从模板创建
cp .env.example .env

# 2. 生成密钥并编辑
openssl rand -base64 32  # 复制输出
nano .env                # 粘贴到 JWT_SECRET 和 ADMIN_SECRET_KEY

# 3. 启动生产服务
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 密钥轮换

```bash
# 1. 生成新密钥
NEW_JWT_SECRET=$(openssl rand -base64 32)
NEW_ADMIN_KEY=$(openssl rand -base64 32)

# 2. 更新 .env 文件
sed -i "s/JWT_SECRET=.*/JWT_SECRET=$NEW_JWT_SECRET/" .env
sed -i "s/ADMIN_SECRET_KEY=.*/ADMIN_SECRET_KEY=$NEW_ADMIN_KEY/" .env

# 3. 重启服务
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart
```

---

## 性能优化建议

### 构建加速

```bash
# 使用 BuildKit
export DOCKER_BUILDKIT=1

# 利用缓存 (不要加 --no-cache 除非必要)
docker compose build

# 并行构建
docker compose build --parallel
```

### 镜像体积优化

当前各阶段镜像体积估算：

| 阶段 | 估计大小 | 说明 |
|------|----------|------|
| deps | ~200MB | 依赖安装 |
| dev | ~350MB | 开发环境 |
| build | ~400MB | 构建中间态 |
| production | ~150MB | 最终生产镜像 |

### 资源调优

根据实际负载调整 `docker-compose.prod.yml` 中的资源限制：

```yaml
deploy:
  resources:
    limits:
      cpus: "4.0"      # 增加 CPU 限制
      memory: 2G       # 增加内存限制
```

---

## CI/CD 集成示例

### GitHub Actions

```yaml
name: Docker Build and Deploy

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          target: production
          push: false
          load: true
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Deploy
        run: |
          docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

---

## 相关资源

- [Docker 官方文档](https://docs.docker.com/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- [Next.js Docker 部署](https://nextjs.org/docs/app/building-your-application/deploying)
- [Bun Docker 指南](https://bun.sh/guides/ecosystem/docker)
- [Prisma SQLite 文档](https://www.prisma.io/docs/orm/overview/databases/sqlite)
- [Docker 安全最佳实践](https://docs.docker.com/develop/security-best-practices/)

---

## 许可证

与项目主许可证一致。
