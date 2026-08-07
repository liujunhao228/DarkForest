"""伪 OneBot v11 反转 WS 客户端（替代 SnowLuma / 真实 QQ 账号）.

E2E 测试以本客户端连接 bot 的反转 WS 服务器（nonebot 监听 /onebot/v11/ws），
扮演真实 QQ 传输层：向 bot 推送 OneBot ``message`` 事件，接收 bot 下发的
API 请求帧并自动应答，把所有 ``send_group_msg`` / ``send_private_msg`` 等动作
归档供断言。bot 侧 nonebot + 命令插件 + 后端 WS 连接保持完全真实。

线程模型：FakeOneBot 运行在会话级后台事件循环线程上；公开方法为同步 API，
内部经 ``run_coroutine_threadsafe`` 派发到该循环。测试可在任意线程直接同步调用，
且接收循环跨测试常驻，规避 pytest-asyncio 的 loop 作用域约束。

协议参考 nonebot-adapter-onebot v11（webSocket 方向）：
- bot → 客户端：HTTP 请求带 ``x-self-id`` 头（bot 自身 QQ 号）。
- 客户端 → bot：``post_type="message"`` 事件帧。
- bot → 客户端：``{"action","params","echo"}`` 指令帧，须回
  ``{"status":"ok","retcode":0,"data":{...},"echo":...}``。
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from collections import deque
from typing import Any

from websockets.asyncio.client import connect as ws_connect

logger = logging.getLogger(__name__)

_BOT_DEFAULT_ID = 20000001


class FakeOneBot:
    """OneBot v11 反转 WS 客户端，后台循环常驻运行。

    Attributes:
        bot_id: 模拟的 QQ 机器人自身账号（对应收发 ``x-self_id``）。
        sent: 已接收的 ``{"action", "params"}`` 指令帧（按到达顺序）。
    """

    def __init__(
        self,
        host: str,
        port: int,
        bot_id: int = _BOT_DEFAULT_ID,
        access_token: str = "",
    ) -> None:
        self.host = host
        self.port = port
        self.bot_id = bot_id
        self.access_token = access_token

        self.sent: deque[dict[str, Any]] = deque()
        self._new_event = asyncio.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._ws = None
        self._recv_task: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------
    # 同步 API（线程安全，供测试调用）
    # ------------------------------------------------------------------

    def connect(self, timeout: float = 20.0) -> None:
        """启动后台事件循环线程并建立到 bot 反转 WS 的连接（含自动重试）。

        Raises:
            RuntimeError: 连接期间持续失败。
        """
        if self._loop is not None:
            raise RuntimeError("FakeOneBot 已连接")
        loop = asyncio.new_event_loop()
        threading.Thread(
            target=_run_loop,
            args=(loop,),
            name="fake-onebot",
            daemon=True,
        ).start()
        self._loop = loop
        deadline = time.monotonic() + timeout
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            try:
                self._call(self._connect_async(), timeout=5.0)
                return
            except Exception as exc:  # noqa: BLE001 - 连接重试吞掉具体网络异常
                last_error = exc
                time.sleep(0.5)
        self._loop = None
        raise ConnectionError(f"FakeOneBot 连 bot 失败: {last_error!r}")

    def close(self, timeout: float = 5.0) -> None:
        """关闭连接并停止后台循环线程。"""
        if self._loop is None:
            return
        try:
            self._call(self._close_async(), timeout=timeout)
        except Exception:
            pass
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._loop = None

    def send_private_message(self, user_id: int, text: str, timeout: float = 5.0) -> None:
        """向 bot 推送一条私聊 text 消息事件。"""
        self._call(self._push_event(self._private_event(user_id, text)), timeout=timeout)

    def send_group_message(
        self,
        group_id: int,
        user_id: int,
        text: str,
        at_bot: bool = False,
        timeout: float = 5.0,
    ) -> None:
        """向 bot 推送一条群聊 text 消息事件；``at_bot`` 时消息首段 at 机器人。"""
        self._call(
            self._push_event(self._group_event(group_id, user_id, text, at_bot)),
            timeout=timeout,
        )

    def wait_for(
        self,
        action: str,
        contains: str | None = None,
        has_image: bool = False,
        timeout: float = 20.0,
    ) -> dict[str, Any]:
        """同步等待 bot 发出指定 action 的帧；返回匹配帧或超时抛 TimeoutError。

        Args:
            action: ``send_group_msg`` / ``send_private_msg`` 等。
            contains: 须在消息文本/序列化表示中出现的子串（None 不校验）。
            has_image: 消息是否须含 base64 图片段。
        """
        return self._call(
            self._wait_for_async(action, contains, has_image),
            timeout=timeout + 1.0,
        )

    def pop_sent(self, action: str) -> list[dict[str, Any]]:
        """取出所有已归档的 action 帧（供一次性断言）。"""
        return [f for f in list(self.sent) if f["action"] == action]

    @staticmethod
    def to_text(frame: dict[str, Any]) -> str:
        """公开：取帧内消息的可读文本表示。"""
        return FakeOneBot._to_text(frame)

    @staticmethod
    def extract_image_b64(frame: dict[str, Any]) -> str | None:
        """公开：取帧内第一张 base64 图片的编码串；无则返回 None。"""
        message = frame.get("params", {}).get("message")
        if not isinstance(message, list):
            return None
        for seg in message:
            if not isinstance(seg, dict) or seg.get("type") != "image":
                continue
            file = str(seg.get("data", {}).get("file", ""))
            if file.startswith("base64://"):
                return file[len("base64://") :]
        return None

    # ------------------------------------------------------------------
    # 事件构造
    # ------------------------------------------------------------------

    def _private_event(self, user_id: int, text: str) -> dict[str, Any]:
        message = [{"type": "text", "data": {"text": text}}]
        return {
            "post_type": "message",
            "message_type": "private",
            "time": int(time.time()),
            "self_id": self.bot_id,
            "sub_type": "friend",
            "user_id": user_id,
            "message_id": self._next_msg_id(),
            "raw_message": text,
            "message": message,
            "original_message": message,
            "sender": {"user_id": user_id, "nickname": f"user{user_id}"},
            "font": 0,
        }

    def _group_event(self, group_id: int, user_id: int, text: str, at_bot: bool) -> dict[str, Any]:
        segments: list[dict[str, Any]] = []
        if at_bot:
            segments.append({"type": "at", "data": {"qq": str(self.bot_id), "name": "bot"}})
        segments.append({"type": "text", "data": {"text": text}})
        return {
            "type": "message",
            "post_type": "message",
            "message_type": "group",
            "time": int(time.time()),
            "self_id": self.bot_id,
            "group_id": group_id,
            "user_id": user_id,
            "message_id": self._next_msg_id(),
            "raw_message": text,
            "message": segments,
            "original_message": segments,
            "sub_type": "normal",
            "anonymous": None,
            "at_sender": False,
            "sender": {
                "user_id": user_id,
                "nickname": f"user{user_id}",
                "card": "",
                "role": "member",
            },
            "font": 0,
        }

    def _next_msg_id(self) -> int:
        return int(time.time() * 1000) % 1000000

    # ------------------------------------------------------------------
    # 内部 async 实现（运行于后台循环）
    # ------------------------------------------------------------------

    async def _connect_async(self) -> None:
        headers = {"Origin": "http://localhost", "x-self-id": str(self.bot_id)}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        ws = await ws_connect(
            f"ws://{self.host}:{self.port}/onebot/v11/ws",
            additional_headers=headers,
        )
        self._ws = ws
        self._recv_task = asyncio.create_task(self._recv_loop())
        logger.debug("FakeOneBot connected to %s:%s", self.host, self.port)

    async def _close_async(self) -> None:
        if self._recv_task is not None:
            self._recv_task.cancel()
            try:
                await self._recv_task
            except asyncio.CancelledError:
                pass
            self._recv_task = None
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

    async def _recv_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                try:
                    frame = json.loads(raw)
                except (TypeError, ValueError):
                    logger.warning("FakeOneBot: 无法解析帧 %r", raw)
                    continue
                await self._on_frame(frame)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("FakeOneBot recv_loop 异常")

    async def _on_frame(self, frame: dict[str, Any]) -> None:
        action = frame.get("action", "")
        params = frame.get("params", {})
        echo = frame.get("echo")
        self.sent.append({"action": action, "params": params})
        self._new_event.set()
        await self._reply(echo)

    async def _reply(self, echo: Any) -> None:
        if self._ws is None:
            return
        payload = {
            "status": "ok",
            "retcode": 0,
            "data": {"message_id": self._next_msg_id()},
            "echo": echo,
        }
        try:
            await self._ws.send(json.dumps(payload, ensure_ascii=False))
        except Exception:
            logger.exception("FakeOneBot 应答失败")

    async def _push_event(self, event: dict[str, Any]) -> None:
        assert self._ws is not None
        await self._ws.send(json.dumps(event, ensure_ascii=False))

    async def _wait_for_async(
        self, action: str, contains: str | None, has_image: bool
    ) -> dict[str, Any]:
        while True:
            frame = self._pop_matching(action, contains, has_image)
            if frame is not None:
                return frame
            await self._new_event.wait()
            self._new_event.clear()

    def _pop_matching(
        self, action: str, contains: str | None, has_image: bool
    ) -> dict[str, Any] | None:
        unmatched: deque[dict[str, Any]] = deque()
        matched: dict[str, Any] | None = None
        while self.sent:
            frame = self.sent.popleft()
            if (
                frame["action"] == action
                and (not contains or contains in self._to_text(frame))
                and (not has_image or self._has_image(frame))
            ):
                matched = frame
                break
            unmatched.append(frame)
        for back in unmatched:
            self.sent.appendleft(back)
        return matched

    @staticmethod
    def _to_text(frame: dict[str, Any]) -> str:
        message = frame.get("params", {}).get("message")
        if isinstance(message, str):
            return message
        if isinstance(message, list):
            buf: list[str] = []
            for seg in message:
                if not isinstance(seg, dict):
                    continue
                if seg.get("type") == "text":
                    buf.append(str(seg.get("data", {}).get("text", "")))
                else:
                    buf.append(str(seg))
            return "".join(buf)
        return str(message or "")

    @staticmethod
    def _has_image(frame: dict[str, Any]) -> bool:
        message = frame.get("params", {}).get("message")
        if not isinstance(message, list):
            return False
        return any(
            isinstance(seg, dict)
            and seg.get("type") == "image"
            and "base64://" in str(seg.get("data", {}).get("file", ""))
            for seg in message
        )

    # ------------------------------------------------------------------
    # 派发助手
    # ------------------------------------------------------------------

    def _call(self, coro: Any, timeout: float) -> Any:
        assert self._loop is not None, "FakeOneBot 未 connect()"
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        try:
            return future.result(timeout=timeout)
        except TimeoutError:
            future.cancel()
            raise


def _run_loop(loop: asyncio.AbstractEventLoop) -> None:
    asyncio.set_event_loop(loop)
    loop.run_forever()
