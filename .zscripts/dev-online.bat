@echo off
REM 黑暗森林 - Windows 开发环境启动脚本
REM 同时启动 WebSocket 服务器和 Next.js 开发服务器

echo.
echo 🌌 黑暗森林 - 开发环境
echo ======================
echo.

REM 检查 Bun 是否安装
where bun >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ 错误：Bun 未安装
    echo 请安装 Bun: https://bun.sh/
    pause
    exit /b 1
)

REM 进入项目目录
cd /d "%~dp0"

echo 📦 安装依赖...
call bun install

echo.
echo 🗄️  推送数据库 Schema...
call bun run db:push

echo.
echo 🚀 启动服务...
echo.
echo   - WebSocket 服务器：http://localhost:3003
echo   - Next.js 开发服务器：http://localhost:3000
echo.
echo 按 Ctrl+C 停止所有服务
echo.

REM 启动 WebSocket 服务器（后台）
echo [WebSocket] 启动服务器...
start /B bun run src/server/gameServer.ts

REM 等待 WebSocket 服务器启动
timeout /t 3 /nobreak >nul

REM 启动 Next.js 开发服务器
echo [Next.js] 启动开发服务器...
call bun run dev

echo.
echo 👋 服务已停止
pause
