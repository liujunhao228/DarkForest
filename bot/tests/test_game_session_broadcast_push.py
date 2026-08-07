"""Tests for backend/game_session.py — Broadcast push policy (P4 + Broadcast).

Covers:
- fullSync with broadcast (broadcaster is local player) → push fires, push_key
  carries phase + card_uid; last_broadcast_card_uid cached.
- deltaSync changing broadcast.phase → push fires (push_key changes).
- deltaSync clearing broadcast → push fires (push_key "" after broadcast_*),
  last_broadcast_card_uid retained for callback to render resolution hint.
- Consecutive broadcasts with different card_uid → no missed push.
- Responder side: must_respond && !responded → push_key broadcast_response:{uid};
  responded → push_key "" triggers push.
- Non-local responder / spectator → push_key "".
"""

from __future__ import annotations

from typing import Any

import pytest

from darkforest_bot.backend.game_session import (
    GameSession,
    GameSessionStore,
)
from darkforest_bot.backend.protocol import ClientEvent, ServerEvent
from darkforest_bot.backend.view_state import ViewState

# ---------------------------------------------------------------------------
# Fakes (mirrors test_game_session_pending.py)
# ---------------------------------------------------------------------------


class FakeWS:
    """Fake WSClient — records subscribe calls + send() invocations."""

    def __init__(self) -> None:
        self.connected: bool = True
        self.player_id: str | None = None
        self.send_calls: list[tuple[ClientEvent, dict[str, Any] | None, str]] = []
        self._handlers: dict[ServerEvent, list[Any]] = {}

    def subscribe(self, event: ServerEvent, handler: Any) -> Any:
        self._handlers.setdefault(event, []).append(handler)

        def unsubscribe() -> None:
            handlers = self._handlers.get(event)
            if handlers is None:
                return
            try:
                handlers.remove(handler)
            except ValueError:
                pass
            if not handlers:
                self._handlers.pop(event, None)

        return unsubscribe

    async def send(
        self,
        event: ClientEvent,
        payload: dict[str, Any] | None = None,
        room_id: str = "",
    ) -> None:
        if not self.connected:
            raise RuntimeError("FakeWS not connected")
        self.send_calls.append((event, payload, room_id))

    def handlers_for(self, event: ServerEvent) -> list[Any]:
        return list(self._handlers.get(event, []))

    @property
    def unsub_count(self) -> int:
        return sum(len(hs) for hs in self._handlers.values())


class FakePushCallback:
    """Records (qq, view_state) invocations for assertion."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, ViewState]] = []

    async def __call__(self, qq: int, vs: ViewState) -> None:
        self.calls.append((qq, vs))


class FakeOnGameOver:
    """Records qq invocations for assertion."""

    def __init__(self) -> None:
        self.calls: list[int] = []

    async def __call__(self, qq: int) -> None:
        self.calls.append(qq)


# ---------------------------------------------------------------------------
# State-dict helpers
# ---------------------------------------------------------------------------


def _player_dict(pid: str, name: str, energy: int = 5) -> dict[str, Any]:
    return {
        "id": pid,
        "name": name,
        "color": "red",
        "position": 1,
        "energy": energy,
        "handCount": 0,
        "hand": [],
        "faceUpCards": [],
        "eliminated": False,
    }


def _response_dict(
    pid: str,
    name: str,
    *,
    can_respond: bool = True,
    must_respond: bool = True,
    responded: bool = False,
    agreed: bool = False,
) -> dict[str, Any]:
    return {
        "playerId": pid,
        "playerName": name,
        "canRespond": can_respond,
        "mustRespond": must_respond,
        "responded": responded,
        "agreed": agreed,
    }


def _broadcast_dict(
    *,
    broadcaster_id: str,
    card_uid: str,
    phase: str = "waiting",
    target_system: int = 3,
    responses: list[dict[str, Any]] | None = None,
    selected_responder_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "broadcasterId": broadcaster_id,
        "cardUid": card_uid,
        "card": None,
        "targetSystem": target_system,
        "range": 2,
        "subtype": None,
        "responses": responses if responses is not None else [],
        "phase": phase,
        "selectedResponderId": selected_responder_id,
        "responseCard": None,
    }
    return payload


def _make_state_dict(
    *,
    total_turn: int = 1,
    current_player_id: str = "p1",
    local_player_id: str = "p1",
    broadcast: dict[str, Any] | None = None,
    winner: str | None = None,
    extra_players: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a minimal ViewState dict for broadcast-push tests."""
    players = [
        _player_dict("p1", "Alice"),
        _player_dict("p2", "Bob"),
    ]
    if extra_players:
        players.extend(extra_players)
    payload: dict[str, Any] = {
        "phase": "playing",
        "totalTurn": total_turn,
        "playerCount": len(players),
        "players": players,
        "currentPlayerIndex": 0,
        "currentPlayerId": current_player_id,
        "localPlayerId": local_player_id,
        "flyingStrikes": [],
        "turnPhase": "actionPhase",
        "logs": [],
        "destroyedStars": [],
        "starEffects": [],
        "winner": winner,
        "isProcessing": False,
        "_viewMeta": {"role": "PLAYER", "viewerId": local_player_id, "timestamp": 1},
    }
    if broadcast is not None:
        payload["broadcast"] = broadcast
    return payload


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------


async def _start_session(
    store: GameSessionStore,
    ws: FakeWS,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
    qq: int = 12345,
) -> GameSession:
    await store.start(
        qq=qq,
        ws=ws,  # type: ignore[arg-type]  # FakeWS quacks like WSClient
        push_callback=push_cb,
        on_game_over=over_cb,
        font_path="/fake/font.ttf",
        canvas_size=400,
    )
    sess = store.get(qq)
    assert sess is not None
    return sess


async def _fire_full_sync(
    ws: FakeWS,
    state_dict: dict[str, Any],
    *,
    version: int = 1,
) -> None:
    handlers = ws.handlers_for(ServerEvent.GAME_FULL_SYNC)
    assert handlers, "no fullSync handler registered"
    payload = {"state": state_dict, "version": version}
    for h in handlers:
        await h(payload)


async def _fire_delta_sync(
    ws: FakeWS,
    changes: list[dict[str, Any]],
    *,
    version: int = 2,
) -> None:
    handlers = ws.handlers_for(ServerEvent.GAME_DELTA_SYNC)
    assert handlers, "no deltaSync handler registered"
    payload = {"changes": changes, "version": version}
    for h in handlers:
        await h(payload)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def store() -> GameSessionStore:
    return GameSessionStore()


@pytest.fixture
def ws() -> FakeWS:
    return FakeWS()


@pytest.fixture
def push_cb() -> FakePushCallback:
    return FakePushCallback()


@pytest.fixture
def over_cb() -> FakeOnGameOver:
    return FakeOnGameOver()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestBroadcastBroadcasterPushPolicy:
    """Broadcaster-side push policy: 4 nodes + card_uid dedup."""

    async def test_first_fullsync_with_broadcast_pushes_once(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """fullSync with broadcast (broadcaster=p1) → push fires once.

        turn_key changes "" → "1:p1" AND push_key changes "" →
        "broadcast_broadcaster:waiting:bc1". Both are first-push signals.
        """
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                total_turn=1,
                current_player_id="p1",
                local_player_id="p1",
                broadcast=_broadcast_dict(
                    broadcaster_id="p1",
                    card_uid="bc1",
                    phase="waiting",
                ),
            ),
        )

        assert len(push_cb.calls) == 1
        assert sess.last_push_key == "broadcast_broadcaster:waiting:bc1"
        assert sess.last_turn_key == "1:p1"
        assert sess.last_broadcast_card_uid == "bc1"

    async def test_phase_change_waiting_to_select_triggers_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """deltaSync changing phase waiting→select → push fires (push_key change)."""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                broadcast=_broadcast_dict(
                    broadcaster_id="p1",
                    card_uid="bc1",
                    phase="waiting",
                )
            ),
        )
        push_cb.calls.clear()
        assert sess.last_push_key == "broadcast_broadcaster:waiting:bc1"

        # Change phase via delta.
        await _fire_delta_sync(
            ws,
            [{"path": "broadcast.phase", "value": "select", "type": "set"}],
        )

        assert len(push_cb.calls) == 1
        assert sess.last_push_key == "broadcast_broadcaster:select:bc1"
        assert sess.last_broadcast_card_uid == "bc1"

    async def test_phase_change_select_to_reveal_triggers_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """deltaSync changing phase select→reveal → push fires."""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                broadcast=_broadcast_dict(
                    broadcaster_id="p1",
                    card_uid="bc1",
                    phase="select",
                )
            ),
        )
        push_cb.calls.clear()
        assert sess.last_push_key == "broadcast_broadcaster:select:bc1"

        await _fire_delta_sync(
            ws,
            [{"path": "broadcast.phase", "value": "reveal", "type": "set"}],
        )

        assert len(push_cb.calls) == 1
        assert sess.last_push_key == "broadcast_broadcaster:reveal:bc1"

    async def test_clearing_broadcast_triggers_push_and_retains_card_uid(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """deltaSync clearing broadcast → push fires (push_key "" after broadcast_*).

        last_broadcast_card_uid retained so push_callback can render resolution
        hint by locating the broadcast log entry in vs.logs.
        """
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                broadcast=_broadcast_dict(
                    broadcaster_id="p1",
                    card_uid="bc1",
                    phase="waiting",
                )
            ),
        )
        push_cb.calls.clear()
        assert sess.last_push_key == "broadcast_broadcaster:waiting:bc1"
        assert sess.last_broadcast_card_uid == "bc1"

        # Clear broadcast via delta (value=None means set to null).
        await _fire_delta_sync(
            ws,
            [{"path": "broadcast", "value": None, "type": "set"}],
        )

        assert len(push_cb.calls) == 1
        assert sess.last_push_key == ""
        # Retained for callback to find resolution log.
        assert sess.last_broadcast_card_uid == "bc1"

    async def test_consecutive_broadcasts_do_not_miss_push(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """Two consecutive broadcasts (different card_uid) → 3 pushes total.

        Sequence: fullSync broadcast bc1 waiting (1st push) → delta clear
        broadcast (2nd push, resolution) → delta set broadcast bc2 waiting
        (3rd push, new broadcast).
        """
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                broadcast=_broadcast_dict(
                    broadcaster_id="p1",
                    card_uid="bc1",
                    phase="waiting",
                )
            ),
        )
        # 1st push: first fullSync.
        assert len(push_cb.calls) == 1
        assert sess.last_push_key == "broadcast_broadcaster:waiting:bc1"

        # Clear broadcast (resolution).
        await _fire_delta_sync(
            ws,
            [{"path": "broadcast", "value": None, "type": "set"}],
        )
        # 2nd push: broadcast cleared (push_key "" after broadcast_*).
        assert len(push_cb.calls) == 2
        assert sess.last_push_key == ""

        # New broadcast with different card_uid.
        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "broadcast",
                    "value": _broadcast_dict(
                        broadcaster_id="p1",
                        card_uid="bc2",
                        phase="waiting",
                    ),
                    "type": "set",
                }
            ],
        )
        # 3rd push: new broadcast (push_key "" → "broadcast_broadcaster:waiting:bc2").
        assert len(push_cb.calls) == 3
        assert sess.last_push_key == "broadcast_broadcaster:waiting:bc2"
        assert sess.last_broadcast_card_uid == "bc2"


class TestBroadcastResponderPushPolicy:
    """Responder-side push policy: push_key carries card_uid."""

    async def test_responder_must_respond_pushes(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """Local player is responder with must_respond && !responded → push_key
        ``broadcast_response:{card_uid}``."""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                local_player_id="p1",
                current_player_id="p2",  # broadcaster's turn
                broadcast=_broadcast_dict(
                    broadcaster_id="p2",
                    card_uid="bc1",
                    phase="waiting",
                    responses=[
                        _response_dict("p1", "Alice", must_respond=True, responded=False)
                    ],
                ),
            ),
        )
        # First fullSync fires push (turn_key "" → "1:p2").
        assert len(push_cb.calls) == 1
        assert sess.last_push_key == "broadcast_response:bc1"
        assert sess.last_broadcast_card_uid == "bc1"

    async def test_responder_responded_clears_push_key(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """Responder responded=True → push_key "" (from broadcast_response:*).

        Triggers a push so callback can render post-response state.
        """
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                local_player_id="p1",
                current_player_id="p2",
                broadcast=_broadcast_dict(
                    broadcaster_id="p2",
                    card_uid="bc1",
                    phase="waiting",
                    responses=[
                        _response_dict("p1", "Alice", must_respond=True, responded=False)
                    ],
                ),
            ),
        )
        push_cb.calls.clear()
        assert sess.last_push_key == "broadcast_response:bc1"

        # Mark responded via delta.
        await _fire_delta_sync(
            ws,
            [
                {
                    "path": "broadcast.responses[0].responded",
                    "value": True,
                    "type": "set",
                }
            ],
        )

        # Push fires because push_key changed (broadcast_response:bc1 → "").
        assert len(push_cb.calls) == 1
        assert sess.last_push_key == ""

    async def test_other_responder_does_not_push_to_local(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """Local player is NOT in responses → push_key "" (don't push others'
        broadcast responses to this player)."""
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                local_player_id="p1",
                current_player_id="p2",
                broadcast=_broadcast_dict(
                    broadcaster_id="p2",
                    card_uid="bc1",
                    phase="waiting",
                    # Responses for p3 only, not p1.
                    responses=[
                        _response_dict("p3", "Charlie", must_respond=True, responded=False)
                    ],
                ),
                extra_players=[_player_dict("p3", "Charlie")],
            ),
        )
        # First fullSync fires push (turn_key "" → "1:p2") — but push_key is ""
        # because local player p1 is neither broadcaster nor responder.
        assert len(push_cb.calls) == 1
        assert sess.last_push_key == ""


class TestBroadcastSpectatorPushPolicy:
    """Spectator (local player not broadcaster, not in responses) → push_key ""."""

    async def test_spectator_push_key_empty(
        self,
        store: GameSessionStore,
        ws: FakeWS,
        push_cb: FakePushCallback,
        over_cb: FakeOnGameOver,
    ) -> None:
        """Local player is neither broadcaster nor responder → push_key "".

        But first fullSync still fires push (turn_key change). Subsequent
        broadcast phase changes do not push (push_key stays "").
        """
        sess = await _start_session(store, ws, push_cb, over_cb)
        await _fire_full_sync(
            ws,
            _make_state_dict(
                local_player_id="p1",
                current_player_id="p2",
                broadcast=_broadcast_dict(
                    broadcaster_id="p2",
                    card_uid="bc1",
                    phase="waiting",
                    responses=[
                        _response_dict("p3", "Charlie", must_respond=True, responded=False)
                    ],
                ),
                extra_players=[_player_dict("p3", "Charlie")],
            ),
        )
        # First fullSync fires push (turn_key "" → "1:p2").
        assert len(push_cb.calls) == 1
        assert sess.last_push_key == ""
        push_cb.calls.clear()

        # Phase change does not push to spectator (push_key stays "").
        await _fire_delta_sync(
            ws,
            [{"path": "broadcast.phase", "value": "select", "type": "set"}],
        )
        assert push_cb.calls == []
        assert sess.last_push_key == ""
