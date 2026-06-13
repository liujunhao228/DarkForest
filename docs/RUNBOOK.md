# 黑暗森林 (Dark Forest) - 运维手册 (Runbook)

## 目录

- [服务管理](#服务管理)
- [日志查看](#日志查看)
- [数据库管理](#数据库管理)
- [故障排查](#故障排查)
- [回滚操作](#回滚操作)
- [备份恢复](#备份恢复)
- [监控告警](#监控告警)

---

## 服务管理

### Docker Compose 方式

#### 启动服务

```bash
# 启动所有服务
docker compose -f docker-compose.production.new.yml up -d

# 仅启动特定服务
docker compose -f docker-compose.production.new.yml up -d app postgres

# 查看服务状态
docker compose -f docker-compose.production.new.yml ps
```

#### 停止服务

```bash
# 停止所有服务
docker compose -f docker-compose.production.new.yml stop

# 停止特定服务
docker compose -f docker-compose.production.new.yml stop app

# 停止并删除容器
docker compose -f docker-compose.production.new.yml down

# 停止并删除容器和数据卷
docker compose -f docker-compose.production.new.yml down -v
```

#### 重启服务

```bash
# 重启所有服务
docker compose -f docker-compose.production.new.yml restart

# 重启特定服务
docker compose -f docker-compose.production.new.yml restart app

# 重新构建并重启
docker compose -f docker-compose.production.new.yml up -d --build app
```

#### 更新服务

```bash
# 拉取最新代码
git pull origin main

# 重新构建镜像
docker compose -f docker-compose.production.new.yml build

# 重启服务
docker compose -f docker-compose.production.new.yml up -d
```

### systemd 方式

#### 启动服务

```bash
sudo systemctl start darkforest
```

#### 停止服务

```bash
sudo systemctl stop darkforest
```

#### 重启服务

```bash
sudo systemctl restart darkforest
```

#### 查看状态

```bash
sudo systemctl status darkforest
```

#### 查看日志

```bash
sudo journalctl -u darkforest -f
```

---

## 日志查看

### Docker 日志

#### 查看实时日志

```bash
# 查看所有服务日志
docker compose -f docker-compose.production.new.yml logs -f

# 查看特定服务日志
docker compose -f docker-compose.production.new.yml logs -f app

# 查看最近 100 行日志
docker compose -f docker-compose.production.new.yml logs --tail=100 app
```

#### 查看历史日志

```bash
# 查看过去 1 小时的日志
docker compose -f docker-compose.production.new.yml logs --since=1h app

# 查看特定时间段的日志
docker compose -f docker-compose.production.new.yml logs --since="2024-01-01T10:00:00" --until="2024-01-01T11:00:00" app
```

#### 导出日志

```bash
# 导出日志到文件
docker compose -f docker-compose.production.new.yml logs app > app.log

# 导出所有服务日志
docker compose -f docker-compose.production.new.yml logs > all.log
```

### 应用日志

#### 日志位置

- **Docker**: 日志由 Docker 管理，使用 `docker logs` 查看
- **systemd**: 日志由 systemd 管理，使用 `journalctl` 查看
- **直接运行**: 日志输出到 stdout/stderr

#### 日志级别

- `debug`: 详细调试信息
- `info`: 一般信息（默认）
- `warn`: 警告信息
- `error`: 错误信息

#### 日志格式

日志采用 JSON 格式，便于解析和分析：

```json
{
  "level": "info",
  "time": "2024-01-01T10:00:00Z",
  "msg": "request started",
  "method": "GET",
  "path": "/api/health",
  "request_id": "abc123",
  "remote_addr": "192.168.1.1"
}
```

---

## 数据库管理

### PostgreSQL 连接

#### 使用 psql

```bash
# 连接到数据库
psql -h localhost -U darkforest -d darkforest

# 或使用环境变量
export PGPASSWORD=darkforest_secret
psql -h localhost -U darkforest -d darkforest
```

#### 使用 Docker

```bash
# 连接到 PostgreSQL 容器
docker compose -f docker-compose.production.new.yml exec postgres psql -U darkforest -d darkforest
```

### 数据库备份

#### 手动备份

```bash
# 创建备份目录
mkdir -p backups

# 备份整个数据库
pg_dump -h localhost -U darkforest -d darkforest > backups/darkforest_$(date +%Y%m%d).sql

# 备份特定表
pg_dump -h localhost -U darkforest -d darkforest -t players > backups/players_$(date +%Y%m%d).sql

# 备份为压缩格式
pg_dump -h localhost -U darkforest -d darkforest | gzip > backups/darkforest_$(date +%Y%m%d).sql.gz
```

#### 自动备份脚本

创建 `/opt/darkforest/scripts/db-backup.sh`：

```bash
#!/bin/bash
BACKUP_DIR="/opt/darkforest/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/darkforest_${TIMESTAMP}.sql.gz"

export PGPASSWORD=darkforest_secret

pg_dump -h localhost -U darkforest -d darkforest | gzip > "$BACKUP_FILE"

# 保留最近 7 天的备份
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_FILE"
```

配置 cron 定时任务：

```bash
# 每天凌晨 2 点备份
0 2 * * * /opt/darkforest/scripts/db-backup.sh >> /opt/darkforest/logs/backup.log 2>&1
```

### 数据库恢复

#### 从备份恢复

```bash
# 解压备份文件
gunzip backups/darkforest_20240101.sql.gz

# 恢复数据库
psql -h localhost -U darkforest -d darkforest < backups/darkforest_20240101.sql
```

#### 恢复特定表

```bash
psql -h localhost -U darkforest -d darkforest -t players < backups/players_20240101.sql
```

### 数据库维护

#### 清理过期数据

```bash
# 清理过期的匹配队列
psql -h localhost -U darkforest -d darkforest -c "DELETE FROM matchmaking_queues WHERE joined_at < NOW() - INTERVAL '1 hour';"

# 清理已完成的对局（保留最近 30 天）
psql -h localhost -U darkforest -d darkforest -c "DELETE FROM matches WHERE status = 'finished' AND finished_at < NOW() - INTERVAL '30 days';"
```

#### 数据库优化

```bash
# 分析数据库
psql -h localhost -U darkforest -d darkforest -c "ANALYZE;"

# 重建索引
psql -h localhost -U darkforest -d darkforest -c "REINDEX DATABASE darkforest;"
```

---

## 故障排查

### 服务无法启动

#### 检查步骤

1. **检查日志**

```bash
docker compose -f docker-compose.production.new.yml logs app
```

2. **检查配置**

```bash
# 检查环境变量
docker compose -f docker-compose.production.new.yml config
```

3. **检查依赖服务**

```bash
# 检查 PostgreSQL 是否运行
docker compose -f docker-compose.production.new.yml ps postgres

# 检查 PostgreSQL 健康状态
docker compose -f docker-compose.production.new.yml exec postgres pg_isready
```

4. **检查端口占用**

```bash
# 检查 8080 端口是否被占用
netstat -tuln | grep 8080

# 或使用 ss
ss -tuln | grep 8080
```

#### 常见原因

- PostgreSQL 未启动或连接失败
- 环境变量配置错误
- 端口被占用
- 镜像构建失败

### 服务响应异常

#### 检查步骤

1. **检查健康状态**

```bash
curl http://localhost:8080/api/health
```

2. **检查日志**

```bash
docker compose -f docker-compose.production.new.yml logs -f app
```

3. **检查资源使用**

```bash
# 检查容器资源使用
docker stats darkforest-app

# 检查系统资源
top
htop
```

4. **检查数据库连接**

```bash
# 检查数据库连接数
psql -h localhost -U darkforest -d darkforest -c "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = 'darkforest';"

# 检查数据库性能
psql -h localhost -U darkforest -d darkforest -c "SELECT * FROM pg_stat_activity;"
```

#### 常见原因

- 数据库连接池耗尽
- 内存不足
- CPU 过载
- 网络延迟

### WebSocket 连接失败

#### 检查步骤

1. **检查 WebSocket 路径**

```bash
# 测试 WebSocket 连接
wscat -c ws://localhost:8080/ws -H "Authorization: Bearer YOUR_TOKEN"
```

2. **检查反向代理配置**

```bash
# 检查 Caddyfile
cat Caddyfile.new
```

3. **检查 JWT token**

```bash
# 解析 JWT token
echo "YOUR_TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```

#### 常见原因

- JWT token 无效或过期
- 反向代理不支持 WebSocket
- CORS 配置错误

---

## 回滚操作

### 使用回滚脚本

#### 准备工作

```bash
# 查看可用的备份文件
ls -lh backups/

# 设置环境变量
export RESTORE_BACKUP=./backups/migration_backup_20240101_120000.sql
```

#### 执行回滚

```bash
# 执行回滚脚本
bash scripts/rollback.sh
```

#### 验证回滚

```bash
# 检查 SQLite 数据库
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM players;"

# 检查旧版服务
curl http://localhost:3000/api/health
```

### 手动回滚

#### 1. 停止新版服务

```bash
docker compose -f docker-compose.production.new.yml down
```

#### 2. 恢复 SQLite 数据库

```bash
# 从备份恢复
sqlite3 prisma/dev.db < backups/migration_backup_20240101.sql
```

#### 3. 启动旧版服务

```bash
docker compose -f docker-compose.yml up -d
```

---

## 备份恢复

### 完整备份

#### 备份所有数据

```bash
# 创建备份目录
mkdir -p backups/full_$(date +%Y%m%d)

# 备份数据库
pg_dump -h localhost -U darkforest -d darkforest | gzip > backups/full_$(date +%Y%m%d)/database.sql.gz

# 备份配置文件
cp backend/.env backups/full_$(date +%Y%m%d)/backend.env
cp frontend/.env backups/full_$(date +%Y%m%d)/frontend.env
cp docker-compose.production.new.yml backups/full_$(date +%Y%m%d)/docker-compose.yml
cp Caddyfile.new backups/full_$(date +%Y%m%d)/Caddyfile

# 备份静态资源
tar -czf backups/full_$(date +%Y%m%d)/static.tar.gz frontend/dist/
```

### 完整恢复

#### 恢复所有数据

```bash
# 解压数据库备份
gunzip backups/full_20240101/database.sql.gz

# 恢复数据库
psql -h localhost -U darkforest -d darkforest < backups/full_20240101/database.sql

# 恢复配置文件
cp backups/full_20240101/backend.env backend/.env
cp backups/full_20240101/frontend.env frontend/.env

# 恢复静态资源
tar -xzf backups/full_20240101/static.tar.gz -C frontend/

# 重启服务
docker compose -f docker-compose.production.new.yml restart app
```

---

## 监控告警

### 基础监控

#### 使用 Docker stats

```bash
# 实时监控容器资源
docker stats darkforest-app darkforest-postgres

# 导出监控数据
docker stats --no-stream > monitoring/docker_stats.log
```

#### 使用系统工具

```bash
# CPU 和内存监控
top -b -n 1 | head -20

# 网络监控
iftop

# 磁盘监控
df -h
```

### 应用监控

#### 健康检查

```bash
# 定期健康检查脚本
cat > scripts/health-check.sh << 'EOF'
#!/bin/bash
URL="http://localhost:8080/api/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $URL)

if [ "$RESPONSE" != "200" ]; then
    echo "Health check failed: HTTP $RESPONSE"
    # 发送告警（邮件、短信等）
    # mail -s "DarkForest Health Check Failed" admin@example.com
fi
EOF

# 配置 cron 定时检查
*/5 * * * * /opt/darkforest/scripts/health-check.sh >> /opt/darkforest/logs/health-check.log 2>&1
```

#### 日志监控

```bash
# 监控错误日志
tail -f /var/log/darkforest/app.log | grep --line-buffered "ERROR" | while read line; do
    echo "$line" >> /var/log/darkforest/errors.log
    # 发送告警
done
```

### 告警配置

#### 邮件告警

```bash
# 安装 mail 工具
apt-get install mailutils

# 发送告警邮件
mail -s "DarkForest Alert: Service Down" admin@example.com << EOF
Service: darkforest-app
Status: DOWN
Time: $(date)
Action: Please check the service immediately
EOF
```

#### Webhook 告警

```bash
# 发送 Webhook 告警
curl -X POST https://your-webhook-url \
  -H "Content-Type: application/json" \
  -d '{"service": "darkforest-app", "status": "DOWN", "time": "'$(date)'"}'
```

---

## 相关文档

- [部署文档 (DEPLOYMENT.md)](./DEPLOYMENT.md)
- [架构文档 (ARCHITECTURE.md)](./ARCHITECTURE.md)
- [任务清单 (.trae/specs/tasks.md)](../.trae/specs/tasks.md)