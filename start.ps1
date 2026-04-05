# ============================================================
# 黑暗森林 (Dark Forest) - 一键 Docker 启动脚本 (PowerShell)
# 用途：个人自用，快速启动/重启服务
# 用法：.\start.ps1 或在 PowerShell 中运行
# ============================================================

# 确保使用 UTF-8 编码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 颜色函数
function Write-Info    { Write-Host "[INFO] $($args -join ' ')" -ForegroundColor Blue }
function Write-Success { Write-Host "[SUCCESS] $($args -join ' ')" -ForegroundColor Green }
function Write-Warn    { Write-Host "[WARN] $($args -join ' ')" -ForegroundColor Yellow }
function Write-Error   { Write-Host "[ERROR] $($args -join ' ')" -ForegroundColor Red }

# 主标题
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  黑暗森林 (Dark Forest) 一键启动" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查 Docker 环境
Write-Info "检查 Docker 环境..."
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker 未安装，请先安装 Docker Desktop"
    Read-Host "按回车键退出"
    exit 1
}

try {
    docker compose version | Out-Null
} catch {
    Write-Error "Docker Compose 未安装，请确保 Docker Desktop 已启用"
    Read-Host "按回车键退出"
    exit 1
}

Write-Success "Docker 环境检查通过"

# 2. 设置环境变量
$envFile = ".env.auto"

if (Test-Path $envFile) {
    Write-Warn "发现已存在的配置文件: $envFile"
    $reuse = Read-Host "是否使用现有配置? (Y/N，默认Y)"
    if ([string]::IsNullOrWhiteSpace($reuse) -or $reuse -match '^[Yy]') {
        Write-Info "使用现有配置: $envFile"
    } else {
        Write-Info "重新生成配置文件..."
        Remove-Item $envFile -Force
    }
}

if (-not (Test-Path $envFile)) {
    Write-Info "生成环境变量配置文件..."
    
    # 生成随机密钥
    $jwtBytes = New-Object byte[] 32
    [System.Security.Cryptography.RNGCryptoServiceProvider]::Create().GetBytes($jwtBytes)
    $jwtSecret = [Convert]::ToBase64String($jwtBytes)
    
    $adminBytes = New-Object byte[] 32
    [System.Security.Cryptography.RNGCryptoServiceProvider]::Create().GetBytes($adminBytes)
    $adminSecret = [Convert]::ToBase64String($adminBytes)
    
    # 创建 .env.auto 文件
    $envContent = @"
# 黑暗森林自动生成的配置文件
# 生成时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
# 此文件已添加到 .gitignore，不会被提交

JWT_SECRET=$jwtSecret
ADMIN_SECRET_KEY=$adminSecret
PRISMA_LOG_LEVEL=error
NEXT_PUBLIC_WEBSOCKET_PORT=3003
WEBSOCKET_PORT=3003
"@
    
    $envContent | Out-File -FilePath $envFile -Encoding UTF8 -NoNewline
    
    Write-Success "配置文件已生成: $envFile"
    Write-Info "请妥善保管以下密钥（已保存到 $envFile）："
    Write-Host "  JWT_SECRET: $($jwtSecret.Substring(0, 20))..." -ForegroundColor Yellow
    Write-Host "  ADMIN_SECRET_KEY: $($adminSecret.Substring(0, 20))..." -ForegroundColor Yellow
    Write-Host ""
}

# 3. 停止现有服务
$runningContainers = docker ps --format "{{.Names}}" 2>$null
if ($runningContainers -match "darkforest-app") {
    Write-Info "停止现有服务..."
    docker compose -f docker-compose.production.yml down 2>$null | Out-Null
    Write-Success "现有服务已停止"
}

# 4. 构建并启动服务
Write-Info "构建并启动服务（首次构建可能需要几分钟）..."
docker compose -f docker-compose.production.yml --env-file .env.auto up -d --build

if ($LASTEXITCODE -ne 0) {
    Write-Error "服务启动失败，请检查日志"
    docker compose -f docker-compose.production.yml logs app
    Read-Host "按回车键退出"
    exit 1
}

Write-Host ""
Write-Success "服务已启动！"
Write-Host ""
Write-Info "服务访问地址："
Write-Host "  🌐 HTTP:       http://localhost:3000" -ForegroundColor Green
Write-Host "  🔌 WebSocket:  ws://localhost:3003" -ForegroundColor Green
Write-Host ""
Write-Info "常用命令："
Write-Host "  查看日志:   docker compose -f docker-compose.production.yml logs -f app" -ForegroundColor Yellow
Write-Host "  停止服务:   docker compose -f docker-compose.production.yml down" -ForegroundColor Yellow
Write-Host "  重启服务:   docker compose -f docker-compose.production.yml restart" -ForegroundColor Yellow
Write-Host "  查看状态:   docker compose -f docker-compose.production.yml ps" -ForegroundColor Yellow
Write-Host ""

# 5. 等待服务健康检查
Write-Info "等待服务健康检查..."
$maxAttempts = 30
$attempt = 0

while ($attempt -lt $maxAttempts) {
    $psOutput = docker compose -f docker-compose.production.yml ps 2>$null
    if ($psOutput -match "\(healthy\)") {
        Write-Success "服务已就绪！"
        break
    }
    $attempt++
    Write-Host "`r  等待中... ($attempt/$maxAttempts)" -NoNewline
    Start-Sleep -Seconds 2
}

if ($attempt -ge $maxAttempts) {
    Write-Host ""
    Write-Warn "服务可能尚未就绪，请检查日志: docker compose -f docker-compose.production.yml logs -f app"
}

Write-Host ""
Write-Success "🎉 黑暗森林已启动完成！"
Write-Host ""
Read-Host "按回车键退出"
