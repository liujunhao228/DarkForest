"""WSConnectionPool: one-QQ-one-WS invariant manager.

The pool ensures that for each QQ number, at most one WSClient connection
to the backend exists at any time. All connect/disconnect operations are
serialized through an asyncio.Lock, so concurrent ``get_or_connect`` calls
for the same qq will not create duplicate connections.

Usage::

    pool = WSConnectionPool(backend_ws_url="ws://127.0.0.1:8080/ws")
    ws = await pool.get_or_connect(qq=12345, name="Alice")
    # ... use ws ...
    await pool.disconnect(qq=12345)
    # On shutdown:
    await pool.disconnect_all()
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from loguru import logger

from darkforest_bot.backend.client import WSClient

if TYPE_CHECKING:
    pass

# Type alias for the on_reconnect callback signature.
OnReconnectCallback = Callable[[int], Awaitable[None]]


class WSConnectionPool:
    """Manages WSClient instances keyed by QQ number.

    The "one QQ one WS" invariant is enforced by serializing all mutating
    operations (get_or_connect, disconnect, disconnect_all) through a single
    asyncio.Lock. Read-only access via get() does not acquire the lock.
    """

    def __init__(
        self,
        backend_ws_url: str = "ws://127.0.0.1:8080/ws",
        on_reconnect: OnReconnectCallback | None = None,
    ) -> None:
        self.backend_ws_url = backend_ws_url
        self.on_reconnect = on_reconnect
        self._clients: dict[int, WSClient] = {}
        self._lock: asyncio.Lock = asyncio.Lock()
        self._logger = logger.bind(component="WSConnectionPool")

    async def get_or_connect(self, qq: int, name: str) -> WSClient:
        """Return the WSClient for ``qq``, connecting if necessary.

        If a client already exists and is connected, returns it directly.
        Otherwise creates a new WSClient, connects it, stores it, and returns
        it. Thread-safe via the pool's internal lock.

        Raises websockets exceptions on connect failure.
        """
        async with self._lock:
            existing = self._clients.get(qq)
            if existing is not None and existing.connected:
                self._logger.debug("Reusing existing connection", qq=qq)
                return existing

            # Either no existing client or it's disconnected — create new.
            if existing is not None:
                # Clean up the stale disconnected client before replacing.
                try:
                    await existing.disconnect()
                except Exception:
                    self._logger.debug("Stale client disconnect failed (ignored)", qq=qq)

            self._logger.info("Creating new WSClient", qq=qq, name=name)
            client = WSClient(
                qq=qq,
                name=name,
                backend_ws_url=self.backend_ws_url,
                on_reconnect=self.on_reconnect,
            )
            await client.connect()
            self._clients[qq] = client
            return client

    async def disconnect(self, qq: int) -> None:
        """Disconnect and remove the WSClient for ``qq``.

        Safe to call even if no client exists for ``qq``.
        """
        async with self._lock:
            client = self._clients.pop(qq, None)
            if client is None:
                return
            self._logger.info("Disconnecting WSClient", qq=qq)
            await client.disconnect()

    async def disconnect_all(self) -> None:
        """Disconnect all active WSClients. Used during shutdown."""
        async with self._lock:
            qqs = list(self._clients.keys())
            for qq in qqs:
                client = self._clients.pop(qq, None)
                if client is not None:
                    self._logger.info("Disconnecting WSClient (shutdown)", qq=qq)
                    try:
                        await client.disconnect()
                    except Exception:
                        self._logger.warning("Disconnect failed during shutdown (ignored)", qq=qq)

    def get(self, qq: int) -> WSClient | None:
        """Return the WSClient for ``qq`` without connecting.

        Does NOT acquire the lock — for read-only access only. Returns None
        if no client exists or the existing client is disconnected.
        """
        client = self._clients.get(qq)
        if client is not None and client.connected:
            return client
        return None
