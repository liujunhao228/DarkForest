"""Tests for backend/resolve.py — command parameter resolvers.

Covers:
- resolve_hand_card: 1-based hand index → Card (in-range, out-of-range, no local player)
- resolve_strike: 1-based strike index → FlyingStrikeView (in-range, out-of-range, owner filter)
- resolve_player_by_name: exact match, prefix match, not found, ambiguous
- resolve_responder: no broadcast, exact match, not found
"""

from __future__ import annotations

from typing import Any

import pytest

from darkforest_bot.backend.resolve import (
    ResolveError,
    assert_card_type,
    resolve_faceup_card,
    resolve_hand_card,
    resolve_player_by_name,
    resolve_responder,
    resolve_strike,
)
from darkforest_bot.backend.view_state import ViewState

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _card_dict(uid: str, name: str, ctype: str = "broadcast") -> dict[str, Any]:
    """Build a minimal Card dict using backend JSON aliases."""
    return {
        "uid": uid,
        "defId": f"def_{uid}",
        "name": name,
        "type": ctype,
        "energy": 2,
        "description": "",
        "image": "",
    }


def _player_dict(
    pid: str,
    name: str,
    hand: list[dict[str, Any]] | None = None,
    energy: int = 3,
    position: int = 1,
    face_up: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build a minimal PlayerView dict using backend JSON aliases."""
    return {
        "id": pid,
        "name": name,
        "color": "red",
        "position": position,
        "energy": energy,
        "handCount": len(hand or []),
        "hand": hand or [],
        "faceUpCards": face_up or [],
        "eliminated": False,
    }


def _strike_dict(uid: str, owner_id: str = "p1") -> dict[str, Any]:
    """Build a minimal FlyingStrikeView dict owned by owner_id."""
    return {
        "uid": uid,
        "defId": f"def_{uid}",
        "ownerId": owner_id,
        "position": 1,
        "targetSystem": 2,
        "level": 1,
        "speed": 1,
        "remainingMoves": 1,
        "strikeName": "x",
        "arrived": False,
        "delayed": False,
    }


def _response_dict(
    pid: str, name: str, must_respond: bool = True
) -> dict[str, Any]:
    return {
        "playerId": pid,
        "playerName": name,
        "canRespond": True,
        "mustRespond": must_respond,
        "responded": False,
        "agreed": False,
    }


def _broadcast_dict(
    responses: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "broadcasterId": "p2",
        "cardUid": "bc",
        "targetSystem": 1,
        "range": 1,
        "responses": responses or [],
        "phase": "waiting",
    }


def make_state(
    players: list[dict[str, Any]] | None = None,
    local_id: str = "p1",
    current_id: str | None = None,
    flying_strikes: list[dict[str, Any]] | None = None,
    broadcast: dict[str, Any] | None = None,
) -> ViewState:
    """Build a minimal ViewState for resolve tests.

    Uses dict + model_validate so the leading-underscore alias ``_viewMeta``
    is handled correctly (pydantic treats underscore-prefixed aliases specially
    and ``populate_by_name`` does not always round-trip them through kwargs).
    """
    if players is None:
        players = [
            _player_dict(
                "p1",
                "Alice",
                hand=[
                    _card_dict("c1_0_1", "卡1", "broadcast"),
                    _card_dict("c2_0_2", "卡2", "strike"),
                ],
                energy=3,
                position=1,
            ),
            _player_dict("p2", "Bob", hand=[], energy=2, position=-1),
        ]
    payload: dict[str, Any] = {
        "phase": "playing",
        "totalTurn": 1,
        "playerCount": len(players),
        "players": players,
        "currentPlayerIndex": 0,
        "currentPlayerId": current_id or local_id,
        "localPlayerId": local_id,
        "flyingStrikes": flying_strikes or [],
        "turnPhase": "actionPhase",
        "logs": [],
        "destroyedStars": [],
        "starEffects": [],
        "winner": None,
        "isProcessing": False,
        "_viewMeta": {"role": "PLAYER", "viewerId": local_id, "timestamp": 0},
    }
    if broadcast is not None:
        payload["broadcast"] = broadcast
    return ViewState.model_validate(payload)


# ---------------------------------------------------------------------------
# resolve_hand_card
# ---------------------------------------------------------------------------


def test_resolve_hand_card_index_1() -> None:
    state = make_state()
    card = resolve_hand_card(state, 1)
    assert card.uid == "c1_0_1"


def test_resolve_hand_card_index_2() -> None:
    state = make_state()
    card = resolve_hand_card(state, 2)
    assert card.uid == "c2_0_2"


def test_resolve_hand_card_index_out_of_range_high() -> None:
    state = make_state()
    with pytest.raises(ResolveError) as exc_info:
        resolve_hand_card(state, 3)
    msg = str(exc_info.value)
    assert "越界" in msg
    assert "当前手牌 2 张" in msg


def test_resolve_hand_card_index_zero() -> None:
    state = make_state()
    with pytest.raises(ResolveError):
        resolve_hand_card(state, 0)


# ---------------------------------------------------------------------------
# resolve_player_by_name
# ---------------------------------------------------------------------------


def test_resolve_player_by_name_exact() -> None:
    state = make_state()
    p = resolve_player_by_name(state, "Alice")
    assert p.id == "p1"


def test_resolve_player_by_name_prefix() -> None:
    state = make_state()
    p = resolve_player_by_name(state, "ali")  # case-insensitive prefix
    assert p.id == "p1"


def test_resolve_player_by_name_not_found() -> None:
    state = make_state()
    with pytest.raises(ResolveError) as exc_info:
        resolve_player_by_name(state, "z")
    assert "未找到" in str(exc_info.value)


def test_resolve_player_by_name_ambiguous() -> None:
    players = [
        _player_dict("p1", "Alice", hand=[_card_dict("c1", "卡1")]),
        _player_dict("p2", "Bob", hand=[]),
        _player_dict("p3", "Alicia", hand=[]),
    ]
    state = make_state(players=players)
    with pytest.raises(ResolveError) as exc_info:
        resolve_player_by_name(state, "Ali")
    msg = str(exc_info.value)
    assert "歧义" in msg
    assert "Alice" in msg
    assert "Alicia" in msg


# ---------------------------------------------------------------------------
# resolve_strike
# ---------------------------------------------------------------------------


def test_resolve_strike_no_strikes_raises() -> None:
    state = make_state(flying_strikes=[])
    with pytest.raises(ResolveError) as exc_info:
        resolve_strike(state, 1)
    assert "打击序号 1 越界" in str(exc_info.value)


def test_resolve_strike_in_range() -> None:
    state = make_state(flying_strikes=[_strike_dict("s1", "p1")])
    strike = resolve_strike(state, 1)
    assert strike.uid == "s1"


def test_resolve_strike_out_of_range() -> None:
    state = make_state(flying_strikes=[_strike_dict("s1", "p1")])
    with pytest.raises(ResolveError):
        resolve_strike(state, 2)


def test_resolve_strike_filters_by_owner() -> None:
    """Strikes owned by other players should not be visible to local player."""
    state = make_state(
        local_id="p1",
        flying_strikes=[_strike_dict("s_other", "p2")],
    )
    with pytest.raises(ResolveError) as exc_info:
        resolve_strike(state, 1)
    assert "打击序号 1 越界" in str(exc_info.value)


# ---------------------------------------------------------------------------
# resolve_responder
# ---------------------------------------------------------------------------


def test_resolve_responder_no_broadcast_raises() -> None:
    state = make_state(broadcast=None)
    with pytest.raises(ResolveError) as exc_info:
        resolve_responder(state, "x")
    assert "无广播" in str(exc_info.value)


def test_resolve_responder_exact_match() -> None:
    state = make_state(
        broadcast=_broadcast_dict(responses=[_response_dict("p1", "Alice")])
    )
    assert resolve_responder(state, "Alice") == "p1"


def test_resolve_responder_prefix_match() -> None:
    state = make_state(
        broadcast=_broadcast_dict(responses=[_response_dict("p1", "Alice")])
    )
    assert resolve_responder(state, "ali") == "p1"


def test_resolve_responder_not_found() -> None:
    state = make_state(
        broadcast=_broadcast_dict(responses=[_response_dict("p1", "Alice")])
    )
    with pytest.raises(ResolveError) as exc_info:
        resolve_responder(state, "Bo")
    assert "未找到响应者" in str(exc_info.value)


# ---------------------------------------------------------------------------
# resolve_faceup_card
# ---------------------------------------------------------------------------


def test_resolve_faceup_card_valid() -> None:
    """1-based index into face_up_cards returns the correct card."""
    players = [
        _player_dict(
            "p1",
            "Alice",
            hand=[],
            face_up=[
                _card_dict("f1_0_1", "设施1", "facility"),
                _card_dict("f2_0_2", "防御1", "defense"),
            ],
        ),
        _player_dict("p2", "Bob", hand=[]),
    ]
    state = make_state(players=players)
    card = resolve_faceup_card(state, 2)
    assert card.uid == "f2_0_2"
    assert card.type == "defense"


def test_resolve_faceup_card_out_of_range() -> None:
    """Out-of-range index raises ResolveError with 场上牌序号 wording."""
    players = [
        _player_dict(
            "p1",
            "Alice",
            hand=[],
            face_up=[_card_dict("f1_0_1", "设施1", "facility")],
        ),
        _player_dict("p2", "Bob", hand=[]),
    ]
    state = make_state(players=players)
    with pytest.raises(ResolveError) as exc_info:
        resolve_faceup_card(state, 2)
    msg = str(exc_info.value)
    assert "场上牌序号" in msg
    assert "当前场上牌 1 张" in msg


def test_resolve_faceup_card_empty() -> None:
    """Empty face_up_cards raises with 0 count."""
    state = make_state()  # default _player_dict has faceUpCards=[]
    with pytest.raises(ResolveError) as exc_info:
        resolve_faceup_card(state, 1)
    assert "当前场上牌 0 张" in str(exc_info.value)


# ---------------------------------------------------------------------------
# assert_card_type
# ---------------------------------------------------------------------------


def test_assert_card_type_allowed() -> None:
    """Type in allowed_types does not raise."""
    state = make_state()
    card = resolve_hand_card(state, 1)  # broadcast card
    # broadcast 卡用 ("broadcast",) 校验应通过
    assert_card_type(card, ("broadcast",), ".broadcast")


def test_assert_card_type_rejected() -> None:
    """Type not in allowed_types raises ResolveError with friendly message."""
    state = make_state()
    card = resolve_hand_card(state, 1)  # broadcast card
    with pytest.raises(ResolveError) as exc_info:
        assert_card_type(card, ("facility", "defense"), ".deploy")
    msg = str(exc_info.value)
    assert "是 broadcast 卡" in msg
    assert "不能用于 .deploy" in msg


def test_assert_card_type_strike_rejected_for_play() -> None:
    """Strike card rejected for play action."""
    state = make_state()
    card = resolve_hand_card(state, 2)  # strike card
    with pytest.raises(ResolveError) as exc_info:
        assert_card_type(card, ("facility", "defense"), ".play")
    assert "是 strike 卡" in str(exc_info.value)
    assert ".play" in str(exc_info.value)
