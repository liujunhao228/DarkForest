"""WSClient: single-connection WebSocket client for backend LOCAL_TRUST_MODE.

One WSClient instance corresponds to one QQ account's WS connection to the
backend. The connect URL carries ``?qq=<n>&name=<nick>`` query parameters,
which the backend's TrustModeHandler uses for player identification (bypassing
JWT).

Lifecycle::

    client = WSClient(qq=12345, name="Alice", ...)
    await client.connect()                # establishes WS, starts recv loop
    unsub = client.subscribe(ServerEvent.MATCH_FOUND, handler)
    await client.send(ClientEvent.MATCH_JOIN_QUEUE, {"preferredCount": 4, ...})
    ...
    await client.disconnect()             # cancels recv loop, closes WS

Reconnect: on connection drop, _reconnect_loop retries with exponential
backoff (1,2,4,8,16,30,30,...s). On success, old subscribers are cleared
(stale after reconnect) and the on_reconnect callback fires so the session
manager can reset state. P2 does NOT auto-restore session state (planned for P5).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from loguru import logger
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed

from darkforest_bot.backend.protocol import (
    ClientEvent,
    Message,
    ServerEvent,
)

if TYPE_CHECKING:
    from websockets.asyncio.client import ClientConnection

# Handler signature: receives the payload dict (empty dict if payload is None).
Handler = Callable[[dict[str, Any]], Awaitable[None]]

# Exponential backoff delays (seconds) for reconnect. After the last entry,
# repeats the last value indefinitely. Patchable in tests.
RECONNECT_DELAYS: tuple[int, ...] = (1, 2, 4, 8, 16, 30)


class WSClient:
    """Single-connection WebSocket client for one QQ account.

    Thread-safety: WSClient is asyncio-native and must be used from a single
    event loop. All public methods are coroutines unless noted otherwise.
    """

    def __init__(
        self,
        qq: int,
        name: str,
        backend_ws_url: str = "ws://127.0.0.1:8080/ws",
        on_reconnect: Callable[[int], Awaitable[None]] | None = None,
    ) -> None:
        self.qq = qq
        self.name = name
        self.backend_ws_url = backend_ws_url
        self.on_reconnect = on_reconnect

        self.connected: bool = False
        self.player_id: str | None = None

        self._ws: ClientConnection | None = None
        self._recv_task: asyncio.Task[None] | None = None
        self._reconnect_task: asyncio.Task[None] | None = None
        self._subscribers: dict[ServerEvent, list[Handler]] = {}
        self._should_reconnect = False
        self._logger = logger.bind(component="WSClient", qq=qq)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def connect(self) -> None:
        """Establish the WS connection and start the recv loop.

        Raises websockets exceptions on connect failure (caller handles
        initial-connect errors; _reconnect_loop handles subsequent drops).
        """
        await self._do_connect()
        self._recv_task = asyncio.create_task(self._recv_loop())

    async def send(
        self,
        event: ClientEvent,
        payload: dict[str, Any] | None = None,
        room_id: str = "",
    ) -> None:
        """Send a protocol message to backend.

        Raises RuntimeError if not connected.
        """
        if not self.connected or self._ws is None:
            raise RuntimeError(f"WSClient(qq={self.qq}) not connected")
        rid = room_id if room_id else None
        msg = Message(type=event.value, payload=payload, roomId=rid)
        await self._ws.send(msg.model_dump_json(by_alias=True))

    def subscribe(self, event: ServerEvent, handler: Handler) -> Callable[[], None]:
        """Register a handler for a server event. Returns an unsubscribe callable.

        Multiple handlers per event are supported; each is called in
        registration order. If a handler raises, it is logged but does not
        block subsequent handlers or the recv loop.
        """
        self._subscribers.setdefault(event, []).append(handler)

        def unsubscribe() -> None:
            handlers = self._subscribers.get(event)
            if handlers is None:
                return
            try:
                handlers.remove(handler)
            except ValueError:
                pass
            if not handlers:
                self._subscribers.pop(event, None)

        return unsubscribe

    async def disconnect(self) -> None:
        """Cleanly close the connection and stop all background tasks.

        After disconnect, the client will NOT attempt to reconnect.
        Safe to call multiple times.
        """
        self._should_reconnect = False

        if self._reconnect_task is not None:
            self._reconnect_task.cancel()
            try:
                await self._reconnect_task
            except asyncio.CancelledError:
                pass
            self._reconnect_task = None

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
                self._logger.debug("ws.close() during disconnect failed (ignored)")
            self._ws = None

        self.connected = False

    # ------------------------------------------------------------------
    # Internal: connection management
    # ------------------------------------------------------------------

    async def _do_connect(self) -> None:
        """Internal: establish WS connection and set connected=True."""
        uri = self._build_uri()
        self._logger.info("Connecting to backend", ws_url=uri)
        self._ws = await ws_connect(uri)
        self.connected = True
        self._should_reconnect = True
        self._logger.info("Connected to backend")

    def _build_uri(self) -> str:
        """Build the WS URL with qq and name query parameters (URL-encoded)."""
        encoded_name = quote(self.name, safe="")
        return f"{self.backend_ws_url}?qq={self.qq}&name={encoded_name}"

    # ------------------------------------------------------------------
    # Internal: recv loop
    # ------------------------------------------------------------------

    async def _recv_loop(self) -> None:
        """Receive and dispatch messages until connection drops or task cancelled."""
        assert self._ws is not None
        try:
            async for raw in self._ws:
                await self._handle_message(raw)
        except ConnectionClosed:
            self._logger.info("Connection closed by remote")
        except asyncio.CancelledError:
            self._logger.debug("recv_loop cancelled")
            raise
        except Exception:
            self._logger.exception("recv_loop unexpected error")
        finally:
            self.connected = False
            # Schedule reconnect if we exited due to connection drop (not
            # explicit disconnect) and no reconnect is already running.
            if self._should_reconnect and self._reconnect_task is None:
                self._reconnect_task = asyncio.create_task(self._reconnect_loop())

    async def _handle_message(self, raw: str | bytes) -> None:
        """Parse a raw WS message and dispatch to subscribed handlers."""
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        try:
            msg = Message.model_validate_json(raw)
        except Exception:
            self._logger.warning("Failed to parse message", raw=raw[:200])
            return

        try:
            event = ServerEvent(msg.type)
        except ValueError:
            self._logger.warning("Unknown server event type", event_type=msg.type)
            return

        handlers = list(self._subscribers.get(event, []))
        payload = msg.payload if msg.payload is not None else {}
        for handler in handlers:
            try:
                await handler(payload)
            except Exception:
                self._logger.exception("Handler raised exception", event=event.value)

    # ------------------------------------------------------------------
    # Internal: reconnect
    # ------------------------------------------------------------------

    async def _reconnect_loop(self) -> None:
        """Retry connection with exponential backoff until success or cancel."""
        attempt = 0
        try:
            while self._should_reconnect:
                delay = RECONNECT_DELAYS[min(attempt, len(RECONNECT_DELAYS) - 1)]
                self._logger.info("Reconnecting", attempt=attempt + 1, delay_seconds=delay)
                await asyncio.sleep(delay)
                if not self._should_reconnect:
                    return
                try:
                    await self._do_connect()
                except Exception:
                    self._logger.warning("Reconnect attempt failed", attempt=attempt + 1)
                    attempt += 1
                    continue

                # Success: clear stale subscribers and notify session manager.
                self._subscribers.clear()
                self._recv_task = asyncio.create_task(self._recv_loop())
                self._logger.info("Reconnected successfully", attempts=attempt + 1)
                if self.on_reconnect is not None:
                    try:
                        await self.on_reconnect(self.qq)
                    except Exception:
                        self._logger.exception("on_reconnect callback failed")
                return
        except asyncio.CancelledError:
            self._logger.debug("reconnect_loop cancelled")
            raise
        finally:
            self._reconnect_task = None
