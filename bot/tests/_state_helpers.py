"""Shared test fakes + state-dict helpers (test-internal module).

被 conftest.py 与各 game_session / classifier / strike 测试共用。带下划线前缀，
明确是测试内部模块，不会被当作测试收集。
"""

from __future__ import annotations

from typing import Any

from darkforest_bot.backend.protocol import ClientEvent, ServerEvent
from darkforest_bot.backend.view_state import ViewState
from darkforest_bot.notifications.notify_config import NotifyConfig


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
    return {
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


def _pending_dict(
    ptype: str,
    *,
    strike_uid: str = "",
    target_system: int = 0,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"type": ptype}
    if strike_uid:
        payload["strikeUid"] = strike_uid
    if target_system:
        payload["targetSystem"] = target_system
    return payload


def _flying_strike_dict(uid: str, *, arrived: bool = False) -> dict[str, Any]:
    return {
        "uid": uid,
        "defId": "def-strike",
        "ownerId": "p1",
        "position": 1,
        "targetSystem": 3,
        "level": 1,
        "speed": 1,
        "remainingMoves": 2,
        "effect": None,
        "strikeName": "飞击",
        "arrived": arrived,
        "delayed": False,
    }


def _star_effect_dict(system_id: int, etype: str = "annihilationStun") -> dict[str, Any]:
    return {
        "systemId": system_id,
        "type": etype,
        "appliedAtTurn": 1,
        "duration": -1,
        "sourceStrikeUid": None,
    }


def make_state_dict(
    *,
    total_turn: int = 1,
    current_player_id: str = "p1",
    local_player_id: str = "p1",
    players: list[dict[str, Any]] | None = None,
    pending: dict[str, Any] | None = None,
    broadcast: dict[str, Any] | None = None,
    winner: str | None = None,
    destroyed_stars: list[int] | None = None,
    flying_strikes: list[dict[str, Any]] | None = None,
    star_effects: list[dict[str, Any]] | None = None,
    extra_players: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a minimal ViewState dict with sane defaults + arbitrary overrides."""
    plist = players if players is not None else [
        _player_dict("p1", "Alice"),
        _player_dict("p2", "Bob"),
    ]
    if extra_players:
        plist = plist + extra_players
    payload: dict[str, Any] = {
        "phase": "playing",
        "totalTurn": total_turn,
        "playerCount": len(plist),
        "players": plist,
        "currentPlayerIndex": 0,
        "currentPlayerId": current_player_id,
        "localPlayerId": local_player_id,
        "flyingStrikes": flying_strikes or [],
        "turnPhase": "actionPhase",
        "logs": [],
        "destroyedStars": destroyed_stars or [],
        "starEffects": star_effects or [],
        "winner": winner,
        "isProcessing": False,
        "_viewMeta": {"role": "PLAYER", "viewerId": local_player_id, "timestamp": 1},
    }
    if pending is not None:
        payload["pendingAction"] = pending
    if broadcast is not None:
        payload["broadcast"] = broadcast
    return payload


async def _start_session(
    store: Any,
    ws: Any,
    push_cb: FakePushCallback,
    over_cb: FakeOnGameOver,
    qq: int = 12345,
    notify_config_provider=None,
) -> Any:
    """Helper: start a session and return the GameSession object.

    notify_config_provider 在 Step 8 之前 store.start 尚无该参数，仅当显式传入
    时才作为关键字传递。
    """
    if notify_config_provider is None:
        notify_config_provider = lambda qq_arg: NotifyConfig.default()  # noqa: E731
    kwargs = {
        "qq": qq,
        "ws": ws,
        "push_callback": push_cb,
        "on_game_over": over_cb,
        "font_path": "/fake/font.ttf",
        "canvas_size": 400,
    }
    try:
        await store.start(**kwargs)
    except TypeError:
        kwargs["notify_config_provider"] = notify_config_provider
        await store.start(**kwargs)
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


async def _fire_game_error(ws: FakeWS, payload: dict[str, Any]) -> None:
    handlers = ws.handlers_for(ServerEvent.GAME_ERROR)
    assert handlers, "no game:error handler registered"
    for h in handlers:
        await h(payload)
