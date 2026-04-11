"""
CLI 调试工具
============
实时查看 AI 的 Prompt、决策和指令链。

用法：
  uv run darkforest-debug
"""

import asyncio
import json
import logging
import os
from datetime import datetime

from socketio import AsyncClient

# 日志配置
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("debug-cli")

GAME_SERVER_URL = os.getenv("GAME_SERVER_URL", "http://localhost:3003")


class DebugCLI:
    """CLI 调试工具 - 实时监控 AI Agent 与服务器的交互"""

    def __init__(self):
        self.sio = AsyncClient()
        self.message_count = 0
        self._setup_handlers()

    def _setup_handlers(self):
        """设置事件监听"""

        @self.sio.on("connect")
        async def on_connect():
            self._print_header("已连接到游戏服务器", "✅")

        @self.sio.on("disconnect")
        async def on_disconnect():
            self._print_header("与游戏服务器断开连接", "⚠️")

        @self.sio.on("player:loginSuccess")
        async def on_login(data):
            payload = data.get("payload", {})
            self._log_event("登录成功", f"玩家: {payload.get('displayName')} (ID: {payload.get('playerId')})")

        @self.sio.on("match:found")
        async def on_match(data):
            payload = data.get("payload", {})
            players = payload.get("players", [])
            player_names = ", ".join(p.get("displayName", "?") for p in players)
            self._log_event("匹配成功", f"房间: {payload.get('roomCode')} | 玩家: {player_names}")

        @self.sio.on("room:gameStarting")
        async def on_game_start(data):
            payload = data.get("payload", {})
            game_state = payload.get("gameState", {})
            players = game_state.get("players", [])
            self._log_event("游戏开始", f"玩家数: {len(players)} | 回合: {game_state.get('totalTurn', 0)}")

        @self.sio.on("game:fullSync")
        async def on_sync(data):
            payload = data.get("payload", {})
            state = payload.get("state", {})
            phase = state.get("turnPhase", "?")
            turn = state.get("totalTurn", 0)
            self._log_event("状态同步", f"版本: {payload.get('version')} | 回合: {turn} | 阶段: {phase}")

        @self.sio.on("game:turnStart")
        async def on_turn(data):
            payload = data.get("payload", {})
            self._log_event("回合开始", f"回合 {payload.get('turnNumber')} | 玩家: {payload.get('currentPlayerId')} | 阶段: {payload.get('phase')}")

        @self.sio.on("game:phaseChange")
        async def on_phase(data):
            payload = data.get("payload", {})
            self._log_event("阶段变更", f"{payload.get('oldPhase')} → {payload.get('newPhase')}")

        @self.sio.on("game:playerAction")
        async def on_action(data):
            payload = data.get("payload", {})
            action = payload.get("action", "?")
            result = payload.get("result", {})
            self._log_event("玩家操作", f"玩家: {payload.get('playerId')} | 操作: {action} | 结果: {json.dumps(result, ensure_ascii=False)[:100]}")

        @self.sio.on("game:broadcastRequest")
        async def on_broadcast(data):
            payload = data.get("payload", {})
            self._log_event("广播请求", f"发起者: {payload.get('broadcasterId')} | 范围: {payload.get('range')}")

        @self.sio.on("game:strikeMoveRequest")
        async def on_strike_move(data):
            payload = data.get("payload", {})
            self._log_event("打击移动请求", f"打击牌: {payload.get('strikeUid')} | 可选目标: {payload.get('validMoves')}")

        @self.sio.on("game:actionResult")
        async def on_result(data):
            payload = data.get("payload", {})
            status = "✅ 成功" if payload.get("success") else f"❌ 失败: {payload.get('error')}"
            self._log_event("操作结果", f"{payload.get('action')} | {status}")

        @self.sio.on("game:gameOver")
        async def on_game_over(data):
            payload = data.get("payload", {})
            rankings = payload.get("rankings", [])
            lines = []
            for r in rankings:
                lines.append(f"  {r['displayName']}: 第{r['rank']}名 {'(已淘汰)' if r['eliminated'] else ''}")
            self._log_event("游戏结束", f"获胜者: {payload.get('winnerId')}\n" + "\n".join(lines))

    def _print_header(self, text: str, icon: str = "─"):
        """打印分隔线"""
        print(f"\n{'─' * 60}")
        print(f"{icon} {text}")
        print(f"{'─' * 60}")

    def _log_event(self, title: str, content: str):
        """格式化输出事件"""
        self.message_count += 1
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"\n[{timestamp}] #{self.message_count} {title}")
        # 处理多行内容
        for line in content.strip().split("\n"):
            print(f"  {line}")

    async def run(self):
        """启动调试工具"""
        print("=" * 60)
        print("🔍 黑暗森林 - AI Agent 调试工具")
        print("=" * 60)
        print(f"游戏服务器: {GAME_SERVER_URL}")
        print(f"按 Ctrl+C 退出")
        print()

        try:
            await self.sio.connect(GAME_SERVER_URL)
            print("✅ 连接成功，开始监听...")

            # 保持连接
            await self.sio.wait()

        except KeyboardInterrupt:
            print("\n👋 退出调试工具")
            await self.sio.disconnect()
        except Exception as e:
            print(f"\n❌ 连接失败: {e}")


async def main():
    """入口函数"""
    debug = DebugCLI()
    await debug.run()


if __name__ == "__main__":
    asyncio.run(main())
