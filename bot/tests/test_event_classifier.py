"""Tests for backend/event_classifier.py — EventCategory + classify()."""

from __future__ import annotations

from typing import Any

from darkforest_bot.backend.event_classifier import EventCategory, classify
from darkforest_bot.backend.view_state import ViewState

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _player(pid: str, *, energy: int = 5) -> dict[str, Any]:
    return {
        "id": pid,
        "name": f"Player{pid}",
        "color": "red",
        "position": 1,
        "energy": energy,
        "handCount": 0,
        "hand": [],
        "faceUpCards": [],
        "eliminated": False,
    }


def _response(
    pid: str, *, must_respond: bool = True, responded: bool = False
) -> dict[str, Any]:
    return {
        "playerId": pid,
        "playerName": f"Player{pid}",
        "canRespond": True,
        "mustRespond": must_respond,
        "responded": responded,
        "agreed": False,
    }


def _broadcast(
    *,
    broadcaster_id: str = "p1",
    card_uid: str = "bc1",
    phase: str = "waiting",
    responses: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "broadcasterId": broadcaster_id,
        "cardUid": card_uid,
        "card": None,
        "targetSystem": 3,
        "range": 2,
        "subtype": None,
        "responses": responses if responses is not None else [],
        "phase": phase,
        "selectedResponderId": None,
        "responseCard": None,
    }


def _flying_strike(uid: str, *, arrived: bool = False) -> dict[str, Any]:
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


def _star_effect(system_id: int, etype: str = "annihilationStun") -> dict[str, Any]:
    return {
        "systemId": system_id,
        "type": etype,
        "appliedAtTurn": 1,
        "duration": -1,
        "sourceStrikeUid": None,
    }


def _state(
    *,
    total_turn: int = 1,
    current_player_id: str = "p1",
    local_player_id: str = "p1",
    players: list[dict[str, Any]] | None = None,
    pending: dict[str, Any] | None = None,
    broadcast: dict[str, Any] | None = None,
    winner: str | None = None,
    flying_strikes: list[dict[str, Any]] | None = None,
    destroyed_stars: list[int] | None = None,
    star_effects: list[dict[str, Any]] | None = None,
    energy: int | None = None,
    **overrides: Any,
) -> ViewState:
    """Build a ViewState with sane defaults; pass overrides for the delta."""
    plist = players if players is not None else [_player("p1"), _player("p2")]
    if energy is not None and players is None:
        plist = [_player("p1", energy=energy), _player("p2")]
    payload: dict[str, Any] = {
        "phase": "playing",
        "gameMode": "classic",
        "modeRules": None,
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
        "version": 1,
        "lastRelicDiscovery": None,
        "mapSnapshot": None,
        "_viewMeta": {"role": "PLAYER", "viewerId": local_player_id, "timestamp": 1},
    }
    if pending is not None:
        payload["pendingAction"] = pending
    if broadcast is not None:
        payload["broadcast"] = broadcast
    payload.update(overrides)
    return ViewState.model_validate(payload)


def _pending(ptype: str = "strikeMove") -> dict[str, Any]:
    return {"type": ptype, "strikeUid": "s1", "targetSystem": 0}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_old_none_returns_all_categories() -> None:
    new = _state()
    assert classify(None, new) == set(EventCategory)


def test_total_turn_change_is_turn_change() -> None:
    old = _state(total_turn=1, current_player_id="p1")
    new = _state(total_turn=2, current_player_id="p1")
    events = classify(old, new)
    assert EventCategory.TURN_CHANGE in events
    assert EventCategory.GAME_OVER not in events


def test_current_player_change_is_turn_change() -> None:
    old = _state(total_turn=1, current_player_id="p1")
    new = _state(total_turn=1, current_player_id="p2")
    events = classify(old, new)
    assert EventCategory.TURN_CHANGE in events


def test_winner_becomes_set_is_game_over() -> None:
    old = _state(winner=None)
    new = _state(winner="p1")
    events = classify(old, new)
    assert EventCategory.GAME_OVER in events


def test_winner_already_set_is_not_game_over() -> None:
    old = _state(winner="p1")
    new = _state(winner="p1")
    events = classify(old, new)
    assert EventCategory.GAME_OVER not in events


def test_pending_change_on_own_turn_is_pending_action() -> None:
    old = _state(current_player_id="p1", local_player_id="p1", pending=None)
    new = _state(current_player_id="p1", local_player_id="p1", pending=_pending())
    events = classify(old, new)
    assert EventCategory.PENDING_ACTION in events


def test_pending_change_on_other_turn_is_other_only() -> None:
    old = _state(current_player_id="p2", local_player_id="p1", pending=None)
    new = _state(current_player_id="p2", local_player_id="p1", pending=_pending())
    events = classify(old, new)
    assert EventCategory.PENDING_ACTION not in events
    assert EventCategory.OTHER in events


def test_broadcast_none_to_state_is_broadcast() -> None:
    old = _state(broadcast=None)
    new = _state(broadcast=_broadcast())
    events = classify(old, new)
    assert EventCategory.BROADCAST in events


def test_broadcast_phase_change_is_broadcast() -> None:
    old = _state(broadcast=_broadcast(phase="waiting"))
    new = _state(broadcast=_broadcast(phase="select"))
    events = classify(old, new)
    assert EventCategory.BROADCAST in events


def test_broadcast_state_to_none_is_broadcast() -> None:
    old = _state(broadcast=_broadcast())
    new = _state(broadcast=None)
    events = classify(old, new)
    assert EventCategory.BROADCAST in events


def test_flying_strikes_length_change_is_strike() -> None:
    old = _state(flying_strikes=[])
    new = _state(flying_strikes=[_flying_strike("s1")])
    events = classify(old, new)
    assert EventCategory.STRIKE in events


def test_destroyed_stars_change_is_strike() -> None:
    old = _state(destroyed_stars=[])
    new = _state(destroyed_stars=[1])
    events = classify(old, new)
    assert EventCategory.STRIKE in events


def test_star_effects_change_is_strike() -> None:
    old = _state(star_effects=[])
    new = _state(star_effects=[_star_effect(1)])
    events = classify(old, new)
    assert EventCategory.STRIKE in events


def test_energy_change_is_other_only() -> None:
    old = _state(energy=5)
    new = _state(energy=99)
    events = classify(old, new)
    assert EventCategory.OTHER in events
    assert events == {EventCategory.OTHER}


def test_turn_change_plus_strike_both_present() -> None:
    old = _state(total_turn=1, current_player_id="p1", flying_strikes=[])
    new = _state(
        total_turn=2,
        current_player_id="p1",
        flying_strikes=[_flying_strike("s1")],
    )
    events = classify(old, new)
    assert EventCategory.TURN_CHANGE in events
    assert EventCategory.STRIKE in events


def test_no_change_returns_empty_set() -> None:
    old = _state()
    new = _state()
    assert classify(old, new) == set()
