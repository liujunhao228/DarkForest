"""Tests for backend/client.py WSClient.

Uses websockets.asyncio.server to spin up a mock backend on a random localhost
port. Tests cover:
- connect() sets connected=True
- send() produces correct JSON wire format
- server-pushed messages dispatch to subscribed handlers
- disconnect() sets connected=False and stops the recv loop
- URL encoding of name (Chinese, spaces, emoji)
- subscribe() returns a working unsubscribe callable
- handler exceptions do not break the recv loop
- reconnect triggers on_reconnect callback (@pytest.mark.slow)
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
import websockets
from websockets.asyncio.server import ServerConnection, serve

from darkforest_bot.backend.client import WSClient
from darkforest_bot.backend.protocol import ClientEvent, ServerEvent

# ---------------------------------------------------------------------------
# Fixtures: mock backend server
# ---------------------------------------------------------------------------


class MockBackend:
    """A minimal mock backend WS server for testing WSClient.

    Records all received messages and can push messages to the client.
    """

    def __init__(self) -> None:
        self.received: list[dict[str, Any]] = []
        self._server: Any = None
        self._port: int = 0
        self._client_ws: ServerConnection | None = None
        self._client_ready = asyncio.Event()

    async def handler(self, ws: ServerConnection) -> None:
        """Server-side handler: one connection per test."""
        self._client_ws = ws
        self._client_ready.set()
        try:
            async for raw in ws:
                msg = json.loads(raw)
                self.received.append(msg)
        except websockets.exceptions.ConnectionClosed:
            pass

    async def start(self) -> str:
        """Start the server on a random port and return the WS URL."""
        self._server = await serve(self.handler, "127.0.0.1", 0)
        # Extract the assigned port from the server object.
        socks = self._server.sockets
        self._port = socks[0].getsockname()[1]  # type: ignore[index]
        return f"ws://127.0.0.1:{self._port}/ws"

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    async def wait_client_connected(self, timeout: float = 5.0) -> None:
        """Wait until a client has connected to the mock server."""
        await asyncio.wait_for(self._client_ready.wait(), timeout=timeout)

    async def push(self, msg: dict[str, Any]) -> None:
        """Push a JSON message to the connected client."""
        assert self._client_ws is not None, "No client connected"
        await self._client_ws.send(json.dumps(msg))

    async def close_client(self) -> None:
        """Close the client connection from the server side."""
        if self._client_ws is not None:
            await self._client_ws.close()
            self._client_ws = None
            self._client_ready.clear()


@pytest.fixture
async def mock_backend() -> MockBackend:
    """Start a mock backend server and yield it. Stops on teardown."""
    backend = MockBackend()
    url = await backend.start()
    # Store URL on the object for convenience.
    backend._url = url  # type: ignore[attr-defined]
    try:
        yield backend
    finally:
        await backend.stop()


# ---------------------------------------------------------------------------
# Tests: connect / connected state
# ---------------------------------------------------------------------------


class TestWSClientConnect:
    async def test_connect_sets_connected_true(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=12345, name="Alice", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        assert client.connected is False
        await client.connect()
        await mock_backend.wait_client_connected()
        assert client.connected is True
        await client.disconnect()

    async def test_url_contains_qq_and_name(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=999, name="Bob", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        uri = client._build_uri()
        assert "qq=999" in uri
        assert "name=Bob" in uri
        await client.connect()
        await mock_backend.wait_client_connected()
        await client.disconnect()


class TestWSClientUrlEncoding:
    @pytest.mark.parametrize(
        ("name", "expected_encoded"),
        [
            ("Alice", "Alice"),
            ("张三", "%E5%BC%A0%E4%B8%89"),
            ("Hello World", "Hello%20World"),
            ("玩家#123", "%E7%8E%A9%E5%AE%B6%23123"),
        ],
    )
    def test_name_url_encoded(self, name: str, expected_encoded: str) -> None:
        client = WSClient(qq=1, name=name, backend_ws_url="ws://localhost:8080/ws")
        uri = client._build_uri()
        assert f"name={expected_encoded}" in uri

    def test_special_chars_encoded(self) -> None:
        """Emoji and special chars must be percent-encoded."""
        client = WSClient(qq=1, name="🎮Test&Name", backend_ws_url="ws://localhost:8080/ws")
        uri = client._build_uri()
        # & must be encoded so it doesn't start a new query param.
        assert "&" not in uri.split("name=")[1]
        assert "qq=1" in uri


# ---------------------------------------------------------------------------
# Tests: send
# ---------------------------------------------------------------------------


class TestWSClientSend:
    async def test_send_produces_correct_json(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=12345, name="Alice", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        await client.send(
            ClientEvent.MATCH_JOIN_QUEUE,
            {"preferredCount": 4, "gameMode": "classic"},
        )
        # Give the server a moment to receive.
        await asyncio.sleep(0.1)

        assert len(mock_backend.received) == 1
        msg = mock_backend.received[0]
        assert msg["type"] == "match:joinQueue"
        assert msg["payload"] == {"preferredCount": 4, "gameMode": "classic"}
        assert msg["roomId"] is None

        await client.disconnect()

    async def test_send_with_room_id(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        await client.send(
            ClientEvent.ROOM_READY,
            room_id="room-abc-123",
        )
        await asyncio.sleep(0.1)

        assert len(mock_backend.received) == 1
        msg = mock_backend.received[0]
        assert msg["type"] == "room:ready"
        assert msg["roomId"] == "room-abc-123"
        # payload should be None when not provided
        assert msg["payload"] is None

        await client.disconnect()

    async def test_send_when_not_connected_raises(self) -> None:
        client = WSClient(qq=1, name="A", backend_ws_url="ws://127.0.0.1:1/ws")
        with pytest.raises(RuntimeError, match="not connected"):
            await client.send(ClientEvent.MATCH_JOIN_QUEUE)


# ---------------------------------------------------------------------------
# Tests: subscribe / message dispatch
# ---------------------------------------------------------------------------


class TestWSClientSubscribe:
    async def test_server_push_dispatches_to_handler(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        received_payloads: list[dict[str, Any]] = []

        async def handler(payload: dict[str, Any]) -> None:
            received_payloads.append(payload)

        client.subscribe(ServerEvent.MATCH_FOUND, handler)

        # Server pushes a match:found message.
        await mock_backend.push(
            {
                "type": "match:found",
                "payload": {
                    "roomId": "r1",
                    "roomCode": "CODE1",
                    "hostId": "p1",
                    "players": [],
                    "isHost": True,
                },
                "roomId": "r1",
            }
        )
        await asyncio.sleep(0.1)

        assert len(received_payloads) == 1
        assert received_payloads[0]["roomId"] == "r1"
        assert received_payloads[0]["roomCode"] == "CODE1"

        await client.disconnect()

    async def test_unsubscribe_stops_dispatch(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        received: list[dict[str, Any]] = []

        async def handler(payload: dict[str, Any]) -> None:
            received.append(payload)

        unsub = client.subscribe(ServerEvent.MATCH_FOUND, handler)

        # First push: handler fires.
        await mock_backend.push(
            {"type": "match:found", "payload": {"roomId": "r1"}, "roomId": "r1"}
        )
        await asyncio.sleep(0.1)
        assert len(received) == 1

        # Unsubscribe.
        unsub()

        # Second push: handler does not fire.
        await mock_backend.push(
            {"type": "match:found", "payload": {"roomId": "r2"}, "roomId": "r2"}
        )
        await asyncio.sleep(0.1)
        assert len(received) == 1  # still 1, not 2

        await client.disconnect()

    async def test_multiple_handlers_same_event(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        calls_a: list[dict[str, Any]] = []
        calls_b: list[dict[str, Any]] = []

        async def handler_a(payload: dict[str, Any]) -> None:
            calls_a.append(payload)

        async def handler_b(payload: dict[str, Any]) -> None:
            calls_b.append(payload)

        client.subscribe(ServerEvent.PLAYER_LOGIN_SUCCESS, handler_a)
        client.subscribe(ServerEvent.PLAYER_LOGIN_SUCCESS, handler_b)

        await mock_backend.push(
            {"type": "player:loginSuccess", "payload": {"id": "p1"}, "roomId": ""}
        )
        await asyncio.sleep(0.1)

        assert len(calls_a) == 1
        assert len(calls_b) == 1
        assert calls_a[0]["id"] == "p1"

        await client.disconnect()

    async def test_handler_exception_does_not_break_loop(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        good_calls: list[dict[str, Any]] = []

        async def bad_handler(payload: dict[str, Any]) -> None:
            raise ValueError("intentional failure")

        async def good_handler(payload: dict[str, Any]) -> None:
            good_calls.append(payload)

        # Register bad handler first, then good handler.
        client.subscribe(ServerEvent.MATCH_QUEUE_JOINED, bad_handler)
        client.subscribe(ServerEvent.MATCH_QUEUE_JOINED, good_handler)

        # First push: bad_handler raises, good_handler should still fire.
        await mock_backend.push(
            {"type": "match:queueJoined", "payload": {"position": 1}, "roomId": ""}
        )
        await asyncio.sleep(0.1)
        assert len(good_calls) == 1

        # Second push: both handlers should fire again (loop not broken).
        await mock_backend.push(
            {"type": "match:queueJoined", "payload": {"position": 2}, "roomId": ""}
        )
        await asyncio.sleep(0.1)
        assert len(good_calls) == 2

        await client.disconnect()

    async def test_unknown_event_ignored(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        # Push an event with an unknown type — should not crash.
        await mock_backend.push({"type": "some:unknownEvent", "payload": {}, "roomId": ""})
        await asyncio.sleep(0.1)

        # Client should still be connected and functional.
        assert client.connected is True

        await client.disconnect()

    async def test_malformed_json_ignored(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        # Push invalid JSON.
        assert mock_backend._client_ws is not None
        await mock_backend._client_ws.send("not valid json{{{")
        await asyncio.sleep(0.1)

        # Client should still be connected.
        assert client.connected is True

        # Subsequent valid message should still work.
        received: list[dict[str, Any]] = []

        async def handler(payload: dict[str, Any]) -> None:
            received.append(payload)

        client.subscribe(ServerEvent.MATCH_ERROR, handler)
        await mock_backend.push(
            {"type": "match:error", "payload": {"code": "X", "message": "err"}, "roomId": ""}
        )
        await asyncio.sleep(0.1)
        assert len(received) == 1

        await client.disconnect()


# ---------------------------------------------------------------------------
# Tests: disconnect
# ---------------------------------------------------------------------------


class TestWSClientDisconnect:
    async def test_disconnect_sets_connected_false(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()
        assert client.connected is True

        await client.disconnect()
        assert client.connected is False

    async def test_disconnect_idempotent(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        await client.disconnect()
        # Second disconnect should not raise.
        await client.disconnect()
        assert client.connected is False

    async def test_disconnect_prevents_reconnect(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        await client.disconnect()
        # Wait a moment to ensure no reconnect is scheduled.
        await asyncio.sleep(0.2)
        assert client._reconnect_task is None


# ---------------------------------------------------------------------------
# Tests: reconnect (marked slow — uses short delays)
# ---------------------------------------------------------------------------


@pytest.mark.slow
class TestWSClientReconnect:
    async def test_reconnect_triggers_on_reconnect_callback(
        self, mock_backend: MockBackend, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Patch delays to near-zero for fast testing.
        monkeypatch.setattr("darkforest_bot.backend.client.RECONNECT_DELAYS", (0.05, 0.05, 0.05))

        reconnected_qqs: list[int] = []

        async def on_reconnect(qq: int) -> None:
            reconnected_qqs.append(qq)

        client = WSClient(
            qq=42,
            name="A",
            backend_ws_url=mock_backend._url,  # type: ignore[attr-defined]
            on_reconnect=on_reconnect,
        )
        await client.connect()
        await mock_backend.wait_client_connected()

        # Close the connection from the server side to simulate a drop.
        await mock_backend.close_client()

        # Wait for reconnect to fire.
        await asyncio.sleep(0.5)

        assert 42 in reconnected_qqs
        assert client.connected is True

        await client.disconnect()

    async def test_reconnect_clears_subscribers(
        self, mock_backend: MockBackend, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("darkforest_bot.backend.client.RECONNECT_DELAYS", (0.05, 0.05, 0.05))

        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        received: list[dict[str, Any]] = []

        async def handler(payload: dict[str, Any]) -> None:
            received.append(payload)

        client.subscribe(ServerEvent.MATCH_FOUND, handler)
        assert len(client._subscribers) == 1

        # Force a reconnect by closing the server-side connection.
        await mock_backend.close_client()
        await asyncio.sleep(0.5)

        # After reconnect, subscribers should be cleared.
        assert len(client._subscribers) == 0
        assert client.connected is True

        await client.disconnect()

    async def test_disconnect_cancels_reconnect(
        self, mock_backend: MockBackend, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Use a longer delay so we can disconnect while it's waiting.
        monkeypatch.setattr("darkforest_bot.backend.client.RECONNECT_DELAYS", (10.0, 10.0))

        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        await mock_backend.close_client()
        await asyncio.sleep(0.2)

        # Reconnect task should be running (waiting on the 10s sleep).
        assert client._reconnect_task is not None

        # Disconnect should cancel the reconnect task.
        await client.disconnect()
        assert client._reconnect_task is None
        assert client.connected is False


# ---------------------------------------------------------------------------
# Tests: subscribe with payload=None
# ---------------------------------------------------------------------------


class TestWSClientPayloadNone:
    async def test_payload_none_passes_empty_dict(self, mock_backend: MockBackend) -> None:
        client = WSClient(qq=1, name="A", backend_ws_url=mock_backend._url)  # type: ignore[attr-defined]
        await client.connect()
        await mock_backend.wait_client_connected()

        received_payloads: list[dict[str, Any]] = []

        async def handler(payload: dict[str, Any]) -> None:
            received_payloads.append(payload)

        client.subscribe(ServerEvent.ROOM_JOINED, handler)

        # Push a message with no payload field.
        await mock_backend.push({"type": "room:joined", "roomId": "r1"})
        await asyncio.sleep(0.1)

        assert len(received_payloads) == 1
        # Handler should receive an empty dict, not None.
        assert received_payloads[0] == {}

        await client.disconnect()
