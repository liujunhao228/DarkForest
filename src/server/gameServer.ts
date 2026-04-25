// ============================
// 黑暗森林 - WebSocket 游戏服务器（权威服务器模式）
// ============================
// 基于 Socket.IO 的多人游戏服务器
// 所有游戏逻辑在服务器端运行，客户端只能观察和请求操作
// ============================

import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { RoomManager } from './RoomManager';
import { EventHandlers } from './EventHandlers';
import { replayStorageService } from './ReplayStorageService';
import { verifyToken } from '@/lib/auth';
import { db } from '@/lib/db';
import { createLogger } from '@/lib/logger';

const logger = createLogger('gameServer');

// ============================
// 服务器配置
// ============================

const PORT = process.env.WEBSOCKET_PORT || 3003;
const MATCH_CHECK_INTERVAL = 5000;  // 匹配检查间隔 (ms)

// CORS 配置：生产环境必须明确指定允许的域名
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGINS?.split(',') ?? [])  // 生产环境：必须配置，否则为空数组（拒绝所有）
  : ['http://localhost:3000', 'http://localhost:3001'];  // 开发环境：本地调试

// 生产环境验证：如果未配置 ALLOWED_ORIGINS 则警告
if (process.env.NODE_ENV === 'production' && (!process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS.trim() === '')) {
  logger.warn('⚠️  生产环境未设置 ALLOWED_ORIGINS 环境变量，所有跨域请求将被拒绝');
}

// 回放存储配置
const REPLAY_CONFIG = {
  maxAgeDays: parseInt(process.env.REPLAY_MAX_AGE_DAYS || '30'),
  maxStorageSizeMB: parseInt(process.env.REPLAY_MAX_STORAGE_MB || '500'),
  cleanupIntervalHours: parseInt(process.env.REPLAY_CLEANUP_INTERVAL_HOURS || '24')
};

// ============================
// 服务器初始化
// ============================

const httpServer = createServer();
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ============================
// JWT 认证中间件
// ============================

io.use(async (socket: Socket, next) => {
  try {
    // 仅从 auth 对象获取 token（不推荐 URL 查询参数）
    const token = socket.handshake.auth?.token;

    if (!token) {
      logger.debug(`未提供 token: ${socket.id}`);
      return next(new Error('未提供认证 token'));
    }

    // 验证 JWT
    const payload = verifyToken(token as string);

    if (!payload) {
      logger.debug(`Token 验证失败: ${socket.id}`);
      return next(new Error('Token 验证失败'));
    }

    // 验证玩家是否存在
    const player = await db.player.findUnique({
      where: { id: payload.playerId },
    });

    if (!player) {
      logger.debug(`玩家不存在: ${payload.playerId}`);
      return next(new Error('玩家不存在'));
    }

    // 认证成功
    socket.data.authenticated = true;
    socket.data.playerId = player.id;
    socket.data.userId = player.userId;
    socket.data.displayName = player.displayName;
    socket.data.role = player.role;

    logger.debug(`认证成功: ${player.displayName} (${player.role})`);
    next();
  } catch (error) {
    logger.error('认证错误:', error);
    return next(new Error('认证失败'));
  }
});

// ============================
// 初始化模块
// ============================

logger.info('🎮 黑暗森林 - 权威服务器模式');
logger.info('================================');

// 应用回放存储配置
replayStorageService.setConfig(REPLAY_CONFIG);
logger.info('✅ 回放存储配置已应用:', REPLAY_CONFIG);

// 创建房间管理器
const roomManager = new RoomManager(io);
logger.info('✅ 房间管理器已创建');

// 创建事件处理器
const eventHandlers = new EventHandlers(io, roomManager);
logger.info('✅ 事件处理器已创建');

// 注册事件
eventHandlers.registerEvents();
logger.info('✅ 事件已注册');

// ============================
// 启动服务器
// ============================

httpServer.listen(PORT, () => {
  logger.info('\n🚀 服务器已启动');
  logger.info(`   WebSocket 端口: ${PORT}`);
  logger.info(`   匹配检查间隔: ${MATCH_CHECK_INTERVAL}ms`);
  logger.info(`   架构模式: 权威服务器\n`);
});

// ============================
// 优雅关闭
// ============================

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`\n📡 收到 ${signal} 信号，正在关闭服务器...`);
  
  try {
    // 销毁事件处理器（包括清理定时器）
    eventHandlers.destroy();
    
    // 销毁回放存储服务
    replayStorageService.destroy();
    logger.info('✅ 回放存储服务已销毁');
    
    // 销毁房间管理器
    await roomManager.destroy();
    
    // 关闭 Socket.IO
    io.close(() => {
      logger.info('✅ WebSocket 服务器已关闭');
      
      // 关闭 HTTP 服务器
      httpServer.close(() => {
        logger.info('✅ HTTP 服务器已关闭');
        process.exit(0);
      });
    });
  } catch (error) {
    logger.error('关闭服务器时出错:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================
// 导出供测试使用
// ============================

export { io, roomManager, eventHandlers };
