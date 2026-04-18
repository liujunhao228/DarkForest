"""
WebSocket连接测试
=================
测试AI客户端与服务器的WebSocket连接
"""

import asyncio
import logging
from unittest.mock import Mock, patch

from darkforest_ai.agent import AIAgent
from darkforest_ai.config import GAME_SERVER_URL, JWT_TOKEN

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("test-websocket")


async def test_websocket_connection():
    """测试WebSocket连接"""
    logger.info("开始测试WebSocket连接...")
    logger.info(f"游戏服务器: {GAME_SERVER_URL}")
    logger.info(f"JWT Token: {'已设置' if JWT_TOKEN else '未设置'}")
    
    # 创建AI Agent实例
    agent = AIAgent()
    
    # 模拟Socket.IO连接
    with patch('darkforest_ai.agent.AsyncClient') as mock_client:
        # 配置模拟对象
        mock_sio = Mock()
        mock_sio.connect = Mock(return_value=asyncio.coroutine(lambda: None)())
        mock_sio.emit = Mock(return_value=asyncio.coroutine(lambda: None)())
        mock_sio.wait = Mock(return_value=asyncio.coroutine(lambda: None)())
        mock_sio.disconnect = Mock(return_value=asyncio.coroutine(lambda: None)())
        
        mock_client.return_value = mock_sio
        
        # 测试连接
        try:
            # 启动AI Agent（非阻塞）
            task = asyncio.create_task(agent.run())
            
            # 等待一段时间让连接建立
            await asyncio.sleep(2)
            
            # 检查是否调用了connect方法
            mock_sio.connect.assert_called_once()
            connect_args = mock_sio.connect.call_args
            logger.info(f"连接调用参数: {connect_args}")
            
            # 检查是否传递了JWT token
            auth_kwarg = connect_args.kwargs.get('auth', {})
            token = auth_kwarg.get('token')
            logger.info(f"传递的JWT Token: {'已传递' if token == JWT_TOKEN else '未传递'}")
            
            # 检查是否调用了登录方法
            mock_sio.emit.assert_any_call(
                'player:login',
                {'userId': mock.ANY, 'displayName': mock.ANY}
            )
            logger.info("登录消息已发送")
            
            # 取消任务
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            
            logger.info("✅ WebSocket连接测试通过")
            return True
        except Exception as e:
            logger.error(f"❌ WebSocket连接测试失败: {e}")
            return False


async def test_message_format():
    """测试消息格式"""
    logger.info("开始测试消息格式...")
    
    # 创建AI Agent实例
    agent = AIAgent()
    
    # 设置模拟的room_id
    agent.state.room_id = "test-room-123"
    
    # 模拟Socket.IO连接
    with patch('darkforest_ai.agent.AsyncClient') as mock_client:
        # 配置模拟对象
        mock_sio = Mock()
        mock_sio.emit = Mock(return_value=asyncio.coroutine(lambda: None)())
        
        mock_client.return_value = mock_sio
        
        # 测试发送游戏操作
        await agent._send_action("endTurn", {})
        
        # 检查发送的消息格式
        mock_sio.emit.assert_called_once()
        emit_args = mock_sio.emit.call_args
        event_name = emit_args[0][0]
        message = emit_args[0][1]
        
        logger.info(f"发送的事件: {event_name}")
        logger.info(f"发送的消息: {message}")
        
        # 验证消息格式
        assert event_name == "game:action", f"期望事件名 'game:action'，实际为 '{event_name}'"
        assert "roomId" in message, "消息缺少 roomId 字段"
        assert message["roomId"] == "test-room-123", f"期望 roomId 'test-room-123'，实际为 '{message["roomId"]}'"
        assert "action" in message, "消息缺少 action 字段"
        assert message["action"] == "endTurn", f"期望 action 'endTurn'，实际为 '{message["action"]}'"
        assert "payload" in message, "消息缺少 payload 字段"
        
        logger.info("✅ 消息格式测试通过")
        return True


if __name__ == "__main__":
    """运行测试"""
    async def main():
        logger.info("=== WebSocket连接测试 ===")
        await test_websocket_connection()
        
        logger.info("\n=== 消息格式测试 ===")
        await test_message_format()
        
        logger.info("\n=== 测试完成 ===")
    
    asyncio.run(main())
