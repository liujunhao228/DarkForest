# 黑暗森林 - 生产容器化部署指南

## 部署架构

```
用户 → Caddy (80/443) → Next.js App (3000) → SQLite (持久化卷)
```

## 快速部署

### 1. 环境准备

```bash
# 复制环境配置
cp .env.example .env

# 生成安全的密钥
openssl rand -base64 32  # 用于 JWT_SECRET
openssl rand -base64 32  # 用于 ADMIN_SECRET_KEY
```

编辑 `.env` 文件，填入生成的密钥。

### 2. 一键部署

```bash
# 赋予脚本执行权限
chmod +x deploy.sh

# 执行部署
./deploy.sh
```

### 3. 手动部署

```bash
# 构建镜像
docker compose -f docker-compose.production.yml build

# 启动服务
docker compose -f docker-compose.production.yml up -d

# 初始化数据库
docker compose -f docker-compose.production.yml exec app npx prisma db push --accept-data-loss

# 查看状态
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f
```

## 容器说明

### 服务列表

| 容器 | 端口 | 说明 |
|------|------|------|
| `darkforest-app` | 3000 | Next.js 应用 |
| `darkforest-caddy` | 80, 443 | 反向代理 |

### 持久化卷

| 卷 | 用途 |
|------|------|
| `dbdata` | SQLite 数据库 |
| `caddy_data` | Caddy SSL 证书 |
| `caddy_config` | Caddy 配置缓存 |

## 常用操作

### 查看日志

```bash
# 所有服务日志
docker compose -f docker-compose.production.yml logs -f

# 特定服务日志
docker compose -f docker-compose.production.yml logs -f app
docker compose -f docker-compose.production.yml logs -f caddy
```

### 重启服务

```bash
docker compose -f docker-compose.production.yml restart app
```

### 停止服务

```bash
docker compose -f docker-compose.production.yml down
```

### 更新部署

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker compose -f docker-compose.production.yml up -d --build
```

### 数据库备份

```bash
# 备份数据库
docker cp darkforest-app:/app/db/custom.db ./backup-$(date +%Y%m%d).db

# 恢复数据库
docker cp ./backup.db darkforest-app:/app/db/custom.db
docker compose -f docker-compose.production.yml restart app
```

### 进入容器

```bash
# 进入应用容器
docker compose -f docker-compose.production.yml exec app sh

# 查看数据库
docker compose -f docker-compose.production.yml exec app npx prisma studio
```

## 安全配置

### 文件权限

- 应用以非 root 用户 `appuser` (UID 1001) 运行
- 数据库目录具有正确的所有权

### 容器安全

- `no-new-privileges:true` - 禁止提权
- 资源限制 - CPU 和内存限制
- 健康检查 - 自动重启不健康容器

### 密钥管理

```bash
# 生产环境必须修改以下密钥：
JWT_SECRET=your-super-secret-jwt-key-change-in-production
ADMIN_SECRET_KEY=your-admin-secret-key-change-in-production
```

## 监控

### 健康检查

```bash
# 手动检查健康状态
docker compose -f docker-compose.production.yml ps

# 查看健康日志
docker compose -f docker-compose.production.yml exec app wget -qO- http://localhost:3000/api/health
```

### 资源使用

```bash
docker stats darkforest-app darkforest-caddy
```

## 故障排查

### 容器无法启动

```bash
# 查看详细日志
docker compose -f docker-compose.production.yml logs app

# 检查配置
docker compose -f docker-compose.production.yml config
```

### 数据库问题

```bash
# 重置数据库（会丢失数据！）
docker compose -f docker-compose.production.yml exec app npx prisma migrate reset --force
```

### 端口冲突

```bash
# 检查端口占用
netstat -tulpn | grep -E '3000|80|443'

# 修改 docker-compose.production.yml 中的端口映射
```

## 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `DATABASE_URL` | ✅ | SQLite 数据库路径 |
| `JWT_SECRET` | ✅ | JWT 签名密钥 |
| `ADMIN_SECRET_KEY` | ✅ | 管理员 API 密钥 |
| `PRISMA_LOG_LEVEL` | ❌ | Prisma 日志级别 |
| `WEBSOCKET_PORT` | ❌ | WebSocket 端口 |

## 性能优化

### 构建缓存

```bash
# 使用 BuildKit 加速构建
DOCKER_BUILDKIT=1 docker compose -f docker-compose.production.yml build
```

### 资源调整

编辑 `docker-compose.production.yml` 中的 `deploy.resources` 部分调整资源限制。

## 备份与恢复

### 完整备份

```bash
# 备份所有卷
docker run --rm -v darkforest_dbdata:/data -v $(pwd):/backup alpine tar czf /backup/dbdata.tar.gz -C /data .
docker run --rm -v darkforest_caddy_data:/data -v $(pwd):/backup alpine tar czf /backup/caddy-data.tar.gz -C /data .
```

### 完整恢复

```bash
# 停止服务
docker compose -f docker-compose.production.yml down

# 恢复数据
docker run --rm -v darkforest_dbdata:/data -v $(pwd):/backup alpine tar xzf /backup/dbdata.tar.gz -C /data
docker run --rm -v darkforest_caddy_data:/data -v $(pwd):/backup alpine tar xzf /backup/caddy-data.tar.gz -C /data

# 重启服务
docker compose -f docker-compose.production.yml up -d
```
