@echo off
REM ============================================================
REM 黑暗森林 (Dark Forest) - 一键 Docker 启动脚本 (Windows)
REM 用途：个人自用，快速启动/重启服务
REM 用法：双击运行 start.bat 或在命令行执行
REM ============================================================

setlocal enabledelayedexpansion

REM 颜色代码（Windows 10+ 支持）
set "BLUE=[INFO]"
set "GREEN=[SUCCESS]"
set "YELLOW=[WARN]"
set "RED=[ERROR]"

echo.
echo ========================================
echo   黑暗森林 (Dark Forest) 一键启动
echo ========================================
echo.

REM 1. 检查 Docker 是否安装
echo %BLUE% 检查 Docker 环境...
docker --version >nul 2>&1
if errorlevel 1 (
    echo %RED% Docker 未安装，请先安装 Docker Desktop
    pause
    exit /b 1
)

docker compose version >nul 2>&1
if errorlevel 1 (
    echo %RED% Docker Compose 未安装，请确保 Docker Desktop 已启用
    pause
    exit /b 1
)

echo %GREEN% Docker 环境检查通过

REM 2. 检查并生成密钥
set "env_file=.env.auto"

if exist "%env_file%" (
    echo %YELLOW% 发现已存在的配置文件: %env_file%
    set /p reuse="是否使用现有配置? (Y/N，默认Y): "
    if /i "!reuse!"=="" set "reuse=Y"
    if /i not "!reuse!"=="N" (
        echo %BLUE% 使用现有配置: %env_file%
        goto :start_services
    )
)

echo %BLUE% 生成环境变量配置文件...

REM 生成随机密钥（使用 PowerShell）
for /f "usebackq delims=" %%i in (`powershell -Command "[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))"`) do set "jwt_secret=%%i"
for /f "usebackq delims=" %%i in (`powershell -Command "[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))"`) do set "admin_secret=%%i"

REM 创建 .env.auto 文件
(
echo # 黑暗森林自动生成的配置文件
echo # 生成时间: %date% %time%
echo # 此文件已添加到 .gitignore，不会被提交
echo.
echo JWT_SECRET=%jwt_secret%
echo ADMIN_SECRET_KEY=%admin_secret%
echo PRISMA_LOG_LEVEL=error
echo NEXT_PUBLIC_WEBSOCKET_PORT=3003
echo WEBSOCKET_PORT=3003
) > "%env_file%"

echo %GREEN% 配置文件已生成: %env_file%
echo %BLUE% 请妥善保管以下密钥（已保存到 %env_file%）：
echo   JWT_SECRET: %jwt_secret:~0,20%...
echo   ADMIN_SECRET_KEY: %admin_secret:~0,20%...
echo.

:start_services
REM 3. 停止现有服务
docker ps --format "{{.Names}}" | findstr "darkforest-app" >nul 2>&1
if not errorlevel 1 (
    echo %BLUE% 停止现有服务...
    docker compose -f docker-compose.production.yml down >nul 2>&1
    echo %GREEN% 现有服务已停止
)

REM 4. 构建并启动服务
echo %BLUE% 构建并启动服务（首次构建可能需要几分钟）...
docker compose -f docker-compose.production.yml --env-file .env.auto up -d --build

if errorlevel 1 (
    echo %RED% 服务启动失败，请检查日志
    docker compose -f docker-compose.production.yml logs app
    pause
    exit /b 1
)

echo.
echo %GREEN% 服务已启动！
echo.
echo %BLUE% 服务访问地址：
echo   HTTP:       http://localhost:3000
echo   WebSocket:  ws://localhost:3003
echo.
echo %BLUE% 常用命令：
echo   查看日志:   docker compose -f docker-compose.production.yml logs -f app
echo   停止服务:   docker compose -f docker-compose.production.yml down
echo   重启服务:   docker compose -f docker-compose.production.yml restart
echo   查看状态:   docker compose -f docker-compose.production.yml ps
echo.

REM 5. 等待服务就绪
echo %BLUE% 等待服务健康检查...
set /a max_attempts=30
set /a attempt=0

:wait_loop
docker compose -f docker-compose.production.yml ps | findstr "(healthy)" >nul 2>&1
if not errorlevel 1 (
    echo %GREEN% 服务已就绪！
    goto :done
)

set /a attempt+=1
if %attempt% geq %max_attempts% (
    echo.
    echo %YELLOW% 服务可能尚未就绪，请检查日志
    goto :done
)

echo   等待中... (%attempt%/%max_attempts%)
timeout /t 2 /nobreak >nul
goto :wait_loop

:done
echo.
echo %GREEN% 🎉 黑暗森林已启动完成！
echo.
pause
