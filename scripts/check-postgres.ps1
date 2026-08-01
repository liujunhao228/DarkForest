#Requires -Version 5.1
# Postgres 前置检查脚本 - E2E 运行前验证数据库可达
$ErrorActionPreference = 'Stop'

# 解析 backend/.env 中的 DATABASE_URL
$envPath = Join-Path $PSScriptRoot '..\backend\.env'
if (-not (Test-Path $envPath)) {
    Write-Host "未找到 backend/.env 文件: $envPath" -ForegroundColor Red
    Write-Host "请参考 backend/.env.example 创建配置文件"
    exit 1
}

$databaseUrl = $null
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^\s*DATABASE_URL\s*=\s*(.+)\s*$') {
        $databaseUrl = $matches[1].Trim()
    }
}

if (-not $databaseUrl) {
    Write-Host "backend/.env 中未配置 DATABASE_URL" -ForegroundColor Red
    exit 1
}

# 从 postgres://user:pass@host:port/db 解析 host 与 port
if ($databaseUrl -match '@([^:/]+):(\d+)') {
    $pgHost = $matches[1]
    $pgPort = [int]$matches[2]
} else {
    $pgHost = 'localhost'
    $pgPort = 5432
    Write-Host "DATABASE_URL 未含 host:port，使用默认 ${pgHost}:${pgPort}" -ForegroundColor Yellow
}

# 探测端口连通
$test = Test-NetConnection -ComputerName $pgHost -Port $pgPort -WarningAction SilentlyContinue
if ($test.TcpTestSucceeded) {
    Write-Host "Postgres reachable at ${pgHost}:${pgPort}" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Postgres 不可达 at ${pgHost}:${pgPort}" -ForegroundColor Red
    Write-Host "请启动 Postgres，例如：" -ForegroundColor Yellow
    Write-Host "  docker run -d --name darkforest-pg -e POSTGRES_USER=darkforest -e POSTGRES_PASSWORD=darkforest_secret -e POSTGRES_DB=darkforest -p 5432:5432 postgres:16" -ForegroundColor Yellow
    exit 1
}
