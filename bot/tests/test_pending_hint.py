"""Tests for render/text.py: render_pending_hint.

Covers:
- Each PendingAction type yields the expected command hint.
- Broadcast-response hint fires only when local player must respond and
  has not yet responded.
- Empty case returns "" (no pending, no broadcast).
- Unknown PendingAction type falls back to "待处理操作：<type>".
"""

from __future__ import annotations

from typing import Any

from darkforest_bot.backend.view_state import ViewState
from darkforest_bot.render.text import render_pending_hint

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _player_dict(pid: str, name: str) -> dict[str, Any]:
    return {
        "id": pid,
        "name": name,
        "color": "red",
        "position": 1,
        "energy": 3,
        "handCount": 0,
        "hand": [],
        "faceUpCards": [],
        "eliminated": False,
    }


def _response_dict(
    pid: str,
    name: str,
    *,
    must_respond: bool = True,
    responded: bool = False,
) -> dict[str, Any]:
    return {
        "playerId": pid,
        "playerName": name,
        "canRespond": True,
        "mustRespond": must_respond,
        "responded": responded,
        "agreed": False,
    }


def _broadcast_dict(responses: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "broadcasterId": "p2",
        "cardUid": "bc",
        "targetSystem": 1,
        "range": 1,
        "responses": responses,
        "phase": "waiting",
    }


def make_state(
    pending: dict[str, Any] | None = None,
    broadcast: dict[str, Any] | None = None,
    local_id: str = "p1",
) -> ViewState:
    """Build a minimal ViewState for pending-hint tests."""
    payload: dict[str, Any] = {
        "phase": "playing",
        "totalTurn": 1,
        "playerCount": 2,
        "players": [_player_dict("p1", "Alice"), _player_dict("p2", "Bob")],
        "currentPlayerIndex": 0,
        "currentPlayerId": local_id,
        "localPlayerId": local_id,
        "flyingStrikes": [],
        "turnPhase": "actionPhase",
        "logs": [],
        "destroyedStars": [],
        "starEffects": [],
        "winner": None,
        "isProcessing": False,
        "_viewMeta": {"role": "PLAYER", "viewerId": local_id, "timestamp": 0},
    }
    if pending is not None:
        payload["pendingAction"] = pending
    if broadcast is not None:
        payload["broadcast"] = broadcast
    return ViewState.model_validate(payload)


def _pending(
    ptype: str,
    *,
    strike_uid: str = "",
    strike_uids: list[str] | None = None,
    target_system: int = 0,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"type": ptype}
    if strike_uid:
        payload["strikeUid"] = strike_uid
    if strike_uids is not None:
        payload["strikeUids"] = strike_uids
    if target_system:
        payload["targetSystem"] = target_system
    return payload


# ---------------------------------------------------------------------------
# PendingAction branches
# ---------------------------------------------------------------------------


def test_pending_none_broadcast_none_returns_empty() -> None:
    state = make_state(pending=None, broadcast=None)
    assert render_pending_hint(state, "p1") == ""


def test_pending_strike_select_hint() -> None:
    state = make_state(
        pending=_pending("strikeSelect", strike_uids=["s1", "s2"])
    )
    hint = render_pending_hint(state, "p1")
    assert "2 个打击" in hint
    assert ".pick" in hint


def test_pending_strike_move_hint() -> None:
    state = make_state(pending=_pending("strikeMove", strike_uid="s1"))
    hint = render_pending_hint(state, "p1")
    assert ".move" in hint
    assert ".skip" in hint


def test_pending_announce_strike_hint() -> None:
    state = make_state(
        pending=_pending("announceStrike", strike_uid="s1", target_system=5)
    )
    hint = render_pending_hint(state, "p1")
    assert "星系 5" in hint
    assert ".announce" in hint


def test_pending_strike_missed_free_hint() -> None:
    state = make_state(
        pending=_pending("strikeMissedFree", strike_uid="s1")
    )
    hint = render_pending_hint(state, "p1")
    assert ".retarget" in hint
    assert ".discard" in hint


def test_pending_strike_missed_require_target_hint() -> None:
    state = make_state(
        pending=_pending("strikeMissedRequireTarget", strike_uid="s1")
    )
    hint = render_pending_hint(state, "p1")
    assert "必须重定向" in hint


def test_pending_unknown_type_fallback() -> None:
    state = make_state(pending=_pending("unknownType"))
    hint = render_pending_hint(state, "p1")
    assert "unknownType" in hint


# ---------------------------------------------------------------------------
# Broadcast-response branches
# ---------------------------------------------------------------------------


def test_broadcast_must_respond_hint() -> None:
    """Local player must respond, has not responded → hint fires."""
    state = make_state(
        broadcast=_broadcast_dict(
            responses=[_response_dict("p1", "Alice", must_respond=True, responded=False)]
        )
    )
    hint = render_pending_hint(state, "p1")
    assert ".agree" in hint
    assert ".refuse" in hint


def test_broadcast_already_responded_returns_empty() -> None:
    """Local player already responded → no hint (already acted)."""
    state = make_state(
        broadcast=_broadcast_dict(
            responses=[_response_dict("p1", "Alice", must_respond=True, responded=True)]
        )
    )
    assert render_pending_hint(state, "p1") == ""


def test_broadcast_must_respond_false_returns_empty() -> None:
    """must_respond=False → no hint (response is optional)."""
    state = make_state(
        broadcast=_broadcast_dict(
            responses=[_response_dict("p1", "Alice", must_respond=False, responded=False)]
        )
    )
    assert render_pending_hint(state, "p1") == ""


def test_broadcast_other_player_must_respond_returns_empty() -> None:
    """Another player is the one who must respond → no hint for local."""
    state = make_state(
        broadcast=_broadcast_dict(
            responses=[_response_dict("p2", "Bob", must_respond=True, responded=False)]
        )
    )
    assert render_pending_hint(state, "p1") == ""
