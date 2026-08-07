"""Tests for render/broadcast_hint.py — render_broadcast_broadcaster_hint.

Covers the 4 broadcaster-side hint nodes (waiting/select/reveal/None) and
local-player-not-broadcaster early return.
"""

from __future__ import annotations

from darkforest_bot.backend.view_state import (
    BroadcastResponseView,
    BroadcastStateView,
    PlayerView,
    ViewMeta,
    ViewState,
)
from darkforest_bot.render.broadcast_hint import (
    render_broadcast_broadcaster_hint,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _player(pid: str, name: str) -> PlayerView:
    return PlayerView(
        id=pid,
        name=name,
        color="red",
        position=1,
        energy=5,
        handCount=0,
        hand=[],
        faceUpCards=[],
        eliminated=False,
    )


def _response(
    pid: str,
    name: str,
    *,
    can_respond: bool = True,
    must_respond: bool = True,
    responded: bool = False,
    agreed: bool = False,
) -> BroadcastResponseView:
    return BroadcastResponseView(
        playerId=pid,
        playerName=name,
        canRespond=can_respond,
        mustRespond=must_respond,
        responded=responded,
        agreed=agreed,
    )


def _broadcast(
    *,
    phase: str = "waiting",
    broadcaster_id: str = "p1",
    card_uid: str = "bc1",
    target_system: int = 3,
    responses: list[BroadcastResponseView] | None = None,
) -> BroadcastStateView:
    return BroadcastStateView(
        broadcasterId=broadcaster_id,
        cardUid=card_uid,
        card=None,
        targetSystem=target_system,
        range_=2,
        subtype=None,
        responses=responses if responses is not None else [],
        phase=phase,
        selectedResponderId=None,
        responseCard=None,
    )


def _state(
    *,
    broadcast: BroadcastStateView | None = None,
    local_player_id: str = "p1",
    extra_players: list[PlayerView] | None = None,
) -> ViewState:
    players = [_player("p1", "Alice"), _player("p2", "Bob")]
    if extra_players:
        players.extend(extra_players)
    return ViewState(
        phase="playing",
        totalTurn=1,
        playerCount=len(players),
        players=players,
        currentPlayerIndex=0,
        currentPlayerId="p1",
        localPlayerId=local_player_id,
        turnPhase="actionPhase",
        winner=None,
        isProcessing=False,
        **{"_viewMeta": ViewMeta(role="PLAYER", viewerId=local_player_id, timestamp=0)},
        broadcast=broadcast,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestRenderBroadcasterHint:
    def test_broadcast_none_returns_empty(self) -> None:
        vs = _state(broadcast=None)
        assert render_broadcast_broadcaster_hint(vs) == ""

    def test_local_not_broadcaster_returns_empty(self) -> None:
        vs = _state(
            broadcast=_broadcast(broadcaster_id="p2"),
            local_player_id="p1",
        )
        assert render_broadcast_broadcaster_hint(vs) == ""

    def test_waiting_phase_unresponded(self) -> None:
        vs = _state(
            broadcast=_broadcast(
                phase="waiting",
                broadcaster_id="p1",
                target_system=3,
                responses=[_response("p2", "Bob")],
            )
        )
        hint = render_broadcast_broadcaster_hint(vs)
        assert "广播进行中" in hint
        assert "星系 3" in hint
        assert "待响应 Bob" in hint
        assert "已同意 无" in hint
        assert "已拒绝 无" in hint
        assert ".bcancel" in hint

    def test_waiting_phase_partial_responded(self) -> None:
        vs = _state(
            broadcast=_broadcast(
                phase="waiting",
                responses=[
                    _response("p2", "Bob", responded=True, agreed=True),
                    _response("p3", "Charlie", responded=True, agreed=False),
                ],
            ),
            extra_players=[_player("p3", "Charlie")],
        )
        hint = render_broadcast_broadcaster_hint(vs)
        assert "已同意 Bob" in hint
        assert "已拒绝 Charlie" in hint
        assert "待响应 无" in hint

    def test_waiting_phase_no_pending(self) -> None:
        vs = _state(
            broadcast=_broadcast(
                phase="waiting",
                responses=[
                    _response("p2", "Bob", responded=True, agreed=True),
                ],
            )
        )
        hint = render_broadcast_broadcaster_hint(vs)
        assert "待响应 无" in hint
        assert "已同意 Bob" in hint

    def test_select_phase_with_agreed(self) -> None:
        vs = _state(
            broadcast=_broadcast(
                phase="select",
                responses=[
                    _response("p2", "Bob", responded=True, agreed=True),
                    _response("p3", "Charlie", responded=True, agreed=False),
                ],
            ),
            extra_players=[_player("p3", "Charlie")],
        )
        hint = render_broadcast_broadcaster_hint(vs)
        assert "全部响应完毕" in hint
        assert "同意者：Bob" in hint
        assert ".select <玩家名>" in hint
        assert ".bcancel" in hint

    def test_select_phase_no_agreed(self) -> None:
        vs = _state(
            broadcast=_broadcast(
                phase="select",
                responses=[
                    _response("p2", "Bob", responded=True, agreed=False),
                ],
            )
        )
        hint = render_broadcast_broadcaster_hint(vs)
        assert "同意者：无" in hint

    def test_reveal_phase_returns_empty(self) -> None:
        vs = _state(
            broadcast=_broadcast(
                phase="reveal",
                responses=[_response("p2", "Bob")],
            )
        )
        assert render_broadcast_broadcaster_hint(vs) == ""

    def test_unknown_phase_returns_empty(self) -> None:
        vs = _state(
            broadcast=_broadcast(
                phase="unknown_phase",
                responses=[_response("p2", "Bob")],
            )
        )
        assert render_broadcast_broadcaster_hint(vs) == ""
