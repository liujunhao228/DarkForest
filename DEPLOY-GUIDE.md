# 黑暗森林 Docker 部署指南

## 快速部署

### 1. 生成密钥

```bash
# 生成 JWT 密钥
openssl rand -base64 32

# 生成管理员密钥
openssl rand -base64 32
```

### 2. 设置环境变量

**方式 A：命令行直接传入**
```bash
JWT_SECRET="your-jwt-secret" \
ADMIN_SECRET_KEY="your-admin-secret" \
docker compose -f docker-compose.production.yml up -d
```

**方式 B：在服务器上创建 .env 文件（不提交到 Git）**
```bash
# 在服务器上创建
cat > .env << EOF
JWT_SECRET=your-jwt-secret-here
ADMIN_SECRET_KEY=your-admin-secret-here
PRISMA_LOG_LEVEL=error
NEXT_PUBLIC_WEBSOCKET_PORT=3003
WEBSOCKET_PORT=3003
NEXT_PUBLIC_BASE_URL=http://your-domain.com
EOF

# 启动（docker compose 会自动读取 .env）
docker compose -f docker-compose.production.yml up -d
```

### 3. 验证部署

```bash
# 查看容器状态
docker compose -f docker-compose.production.yml ps

# 查看日志
docker compose -f docker-compose.production.yml logs -f app

# 健康检查
curl http://localhost:3000/api/health
```

## 环境变量说明

### 必需变量（必须设置）

| 变量 | 说明 | 示例 |
|------|------|------|
| `JWT_SECRET` | JWT 签名密钥（至少 32 字符） | `openssl rand -base64 32` |
| `ADMIN_SECRET_KEY` | 管理员 API 密钥 | `openssl rand -base64 32` |

### 可选变量（有默认值）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `file:/app/db/custom.db` | SQLite 数据库路径 |
| `PRISMA_LOG_LEVEL` | `error` | 日志级别：error/warn/info/query |
| `NEXT_PUBLIC_WEBSOCKET_PORT` | `3003` | WebSocket 端口 |
| `WEBSOCKET_PORT` | `3003` | WebSocket 端口（服务端） |
| `NEXT_PUBLIC_BASE_URL` | - | 应用基础 URL |

## 安全注意事项

⚠️ **永远不要：**
- 将 `.env` 文件提交到 Git
- 在 Dockerfile 中硬编码密钥
- 使用弱密钥（建议至少 32 字符）
- 在日志中输出密钥

✅ **推荐做法：**
- 使用密码管理器存储密钥
- 定期轮换密钥（需要重启容器）
- 使用强随机密钥（`openssl rand -base64 32`）
- 限制服务器 SSH 访问

## 更新密钥

```bash
# 1. 停止当前服务
docker compose -f docker-compose.production.yml down

# 2. 设置新密钥
export JWT_SECRET="new-secret"
export ADMIN_SECRET_KEY="new-admin-secret"

# 3. 重新启动
docker compose -f docker-compose.production.yml up -d
```

## 备份数据库

```bash
# 备份
docker cp darkforest-app:/app/db/custom.db ./backup-$(date +%Y%m%d).db

# 恢复
docker cp ./backup.db darkforest-app:/app/db/custom.db
```
