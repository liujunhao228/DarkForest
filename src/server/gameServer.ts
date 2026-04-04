// ============================
// 黑暗森林 - WebSocket 游戏服务器（权威服务器模式）
// ============================
// 基于 Socket.IO 的多人游戏服务器
// 所有游戏逻辑在服务器端运行，客户端只能观察和请求操作
// ============================

import { createServer } from 'http';
import { Server } from 'socket.io';
import { RoomManager } from './RoomManager';
import { EventHandlers } from './EventHandlers';

// ============================
// 服务器配置
// ============================

const PORT = process.env.WEBSOCKET_PORT || 3003;
const MATCH_CHECK_INTERVAL = 5000;  // 匹配检查间隔 (ms)

// ============================
// 服务器初始化
// ============================

const httpServer = createServer();
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ============================
// 初始化模块
// ============================

console.log('🎮 黑暗森林 - 权威服务器模式');
console.log('================================');

// 创建房间管理器
const roomManager = new RoomManager(io);
console.log('✅ 房间管理器已创建');

// 创建事件处理器
const eventHandlers = new EventHandlers(io, roomManager);
console.log('✅ 事件处理器已创建');

// 注册事件
eventHandlers.registerEvents();
console.log('✅ 事件已注册');

// ============================
// 启动服务器
// ============================

httpServer.listen(PORT, () => {
  console.log('\n🚀 服务器已启动');
  console.log(`   WebSocket 端口: ${PORT}`);
  console.log(`   匹配检查间隔: ${MATCH_CHECK_INTERVAL}ms`);
  console.log(`   架构模式: 权威服务器\n`);
});

// ============================
// 优雅关闭
// ============================

function gracefulShutdown(signal: string): void {
  console.log(`\n📡 收到 ${signal} 信号，正在关闭服务器...`);
  
  // 销毁事件处理器（包括清理定时器）
  eventHandlers.destroy();
  
  // 销毁房间管理器
  roomManager.destroy();
  
  // 关闭 Socket.IO
  io.close(() => {
    console.log('✅ WebSocket 服务器已关闭');
    
    // 关闭 HTTP 服务器
    httpServer.close(() => {
      console.log('✅ HTTP 服务器已关闭');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================
// 导出供测试使用
// ============================

export { io, roomManager, eventHandlers };
