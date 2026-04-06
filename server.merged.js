/**
 * 黑暗森林 - 合并服务器入口（HTTP + WebSocket）
 *
 * 此脚本同时启动：
 * 1. Next.js HTTP 服务器（端口 3000）- 提供 Web 界面和 API
 * 2. WebSocket 游戏服务器（端口 3003）- 提供多人实时联机
 *
 * 在 Docker 环境中接收 SIGTERM/SIGINT 时优雅关闭所有服务。
 */

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

// HTTP 服务器配置
const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);

// 创建 Next.js 应用
const app = next({
  dev: process.env.NODE_ENV !== 'production',
  hostname: process.env.HOSTNAME || '0.0.0.0',
  port: HTTP_PORT,
});
const handle = app.getRequestHandler();

// 全局服务器引用（用于优雅关闭）
let httpServer = null;
let wsServer = null;
let eventHandlers = null;
let roomManager = null;

/**
 * 启动 WebSocket 游戏服务器
 */
async function startWebSocketServer() {
  try {
    // 动态导入 TypeScript 编译后的模块
    // 注意：在生产环境中，需要先编译 gameServer.ts
    const { createGameServer } = require('./dist/server/gameServer');
    
    const wsPort = parseInt(process.env.WEBSOCKET_PORT || '3003', 10);
    const result = await createGameServer(wsPort);
    
    wsServer = result.httpServer;
    eventHandlers = result.eventHandlers;
    roomManager = result.roomManager;
    
    console.log(`✅ WebSocket 游戏服务器已启动 (端口 ${wsPort})`);
    return result;
  } catch (error) {
    console.error('❌ WebSocket 服务器启动失败:', error);
    console.warn('⚠️  继续运行 HTTP 服务器，但多人游戏功能不可用');
    return null;
  }
}

/**
 * 优雅关闭函数
 */
function gracefulShutdown(signal) {
  console.log(`\n📡 收到 ${signal} 信号，正在优雅关闭所有服务...`);

  let shutdownCount = 0;
  const totalServers = [httpServer, wsServer].filter(Boolean).length;

  function checkAllClosed() {
    shutdownCount++;
    if (shutdownCount >= totalServers) {
      console.log('✅ 所有服务已关闭');
      process.exit(0);
    }
  }

  // 关闭 HTTP 服务器
  if (httpServer) {
    httpServer.close((err) => {
      if (err) {
        console.error('❌ HTTP 服务器关闭时出错:', err.message);
      } else {
        console.log('✅ HTTP 服务器已关闭');
      }
      checkAllClosed();
    });
  }

  // 关闭 WebSocket 服务器
  if (wsServer && eventHandlers) {
    try {
      eventHandlers.destroy();
    } catch (e) {
      console.error('事件处理器关闭失败:', e);
    }
  }

  if (wsServer && roomManager) {
    try {
      roomManager.destroy();
    } catch (e) {
      console.error('房间管理器关闭失败:', e);
    }
  }

  if (wsServer) {
    wsServer.close((err) => {
      if (err) {
        console.error('❌ WebSocket 服务器关闭时出错:', err.message);
      } else {
        console.log('✅ WebSocket 服务器已关闭');
      }
      checkAllClosed();
    });
  }

  // 强制超时（30 秒后强制退出）
  setTimeout(() => {
    console.error('⚠️  优雅关闭超时，强制退出');
    process.exit(1);
  }, 25000).unref();
}

// 启动应用
app.prepare().then(async () => {
  // 创建 HTTP 服务器
  httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('❌ 请求处理错误:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  // 错误处理
  httpServer.on('error', (err) => {
    console.error('❌ HTTP 服务器错误:', err);
    process.exit(1);
  });

  // 监听 HTTP 端口
  httpServer.listen(HTTP_PORT, () => {
    console.log(`🚀 黑暗森林 HTTP 服务器已启动`);
    console.log(`   监听地址: http://0.0.0.0:${HTTP_PORT}`);
    console.log(`   环境: ${process.env.NODE_ENV || 'production'}`);
    console.log(`   PID: ${process.pid}`);
  });

  // 启动 WebSocket 服务器（如果环境变量启用）
  if (process.env.ENABLE_WEBSOCKET !== 'false') {
    await startWebSocketServer();
  }

  // 注册信号处理器
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // 处理未捕获的异常
  process.on('uncaughtException', (err) => {
    console.error('❌ 未捕获的异常:', err);
    gracefulShutdown('uncaughtException');
  });

  // 处理未处理的 Promise 拒绝
  process.on('unhandledRejection', (reason) => {
    console.error('❌ 未处理的 Promise 拒绝:', reason);
  });

}).catch((err) => {
  console.error('❌ Next.js 应用启动失败:', err);
  process.exit(1);
});
