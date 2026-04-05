/**
 * 黑暗森林 - 自定义服务器入口（支持优雅退出）
 * 
 * 此脚本包装了 Next.js standalone server，添加了信号处理机制。
 * 在 Docker 环境中接收 SIGTERM/SIGINT 时优雅关闭连接。
 */

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

// 服务器配置
const port = parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';

// 创建 Next.js 应用
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// 全局服务器引用（用于优雅关闭）
let httpServer = null;

/**
 * 优雅关闭函数
 * - 停止接收新连接
 * - 等待现有请求完成（最多 30 秒）
 * - 关闭 Next.js 应用
 */
function gracefulShutdown(signal) {
  console.log(`\n📡 收到 ${signal} 信号，正在优雅关闭 HTTP 服务器...`);
  
  if (httpServer) {
    // 停止接收新连接
    httpServer.close((err) => {
      if (err) {
        console.error('❌ HTTP 服务器关闭时出错:', err.message);
        process.exit(1);
      }
      
      console.log('✅ HTTP 服务器已关闭');
      process.exit(0);
    });

    // 强制超时（30 秒后强制退出）
    setTimeout(() => {
      console.error('⚠️  优雅关闭超时，强制退出');
      process.exit(1);
    }, 25000).unref(); // unref 允许进程在没有其他事件时退出
  } else {
    process.exit(0);
  }
}

// 启动应用
app.prepare().then(() => {
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

  // 监听端口
  httpServer.listen(port, () => {
    console.log(`🚀 黑暗森林 HTTP 服务器已启动`);
    console.log(`   监听地址: http://${hostname}:${port}`);
    console.log(`   环境: ${process.env.NODE_ENV || 'production'}`);
    console.log(`   PID: ${process.pid}`);
  });

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
