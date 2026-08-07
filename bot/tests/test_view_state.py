"""Tests for backend/view_state.py — pydantic mirror of backend ViewState.

Covers parsing of a sample fullSync payload, optional field handling, strict
``extra="forbid"`` semantics, hidden opponent position (-1), and the
intentional permissiveness of ModeRules.
"""

from __future__ import annotations

import copy

import pytest
from pydantic import ValidationError

from darkforest_bot.backend.view_state import (
    Card,
    LogEntry,
    MapLayoutSnapshot,
    ModeRules,
    StarEdge,
    StarNode,
    ViewState,
)


def _make_card(uid: str, name: str, card_type: str, *, energy: int = 2) -> dict[str, object]:
    """Build a minimal backend Card dict (uses backend JSON tags / aliases)."""
    return {
        "uid": uid,
        "defId": f"def:{uid}",
        "name": name,
        "type": card_type,
        "energy": energy,
        "description": f"{name} 描述",
        "image": f"/img/{uid}.png",
    }


def _make_log(log_id: str, turn: int, *, msg: str, log_type: str = "info") -> dict[str, object]:
    return {
        "id": log_id,
        "turn": turn,
        "phase": "actionPhase",
        "message": msg,
        "type": log_type,
    }


def _make_node(node_id: int, *, name: str, tint: str, size: str = "md") -> dict[str, object]:
    return {
        "id": node_id,
        "x": float(node_id * 10),
        "y": float(node_id * 5),
        "name": name,
        "size": size,
        "tint": tint,
    }


def _make_edge(from_id: int, to_id: int) -> dict[str, object]:
    return {"from": from_id, "to": to_id}


def _make_sample_full_sync() -> dict[str, object]:
    """Build a representative fullSync ``state`` payload for two players.

    Mirrors what backend would emit for a 2-player game in playing phase.
    All field names use backend JSON tags (camelCase) — pydantic aliases
    in view_state.py handle the snake_case mapping.
    """
    p1_card_a = _make_card("c1_0_abc", "广播卡A", "broadcast", energy=3)
    p1_card_b = _make_card("c2_1_def", "打击卡B", "strike", energy=2)

    nodes = [_make_node(i, name=f"星系{i}", tint="#6366f1") for i in range(9)]
    edges = [
        _make_edge(0, 1), _make_edge(0, 2), _make_edge(1, 2),
        _make_edge(1, 3), _make_edge(2, 4), _make_edge(3, 4),
        _make_edge(3, 5), _make_edge(4, 6), _make_edge(5, 6),
        _make_edge(5, 7), _make_edge(6, 8), _make_edge(7, 8),
        _make_edge(0, 7), _make_edge(2, 8),
    ]

    return {
        "phase": "playing",
        "gameMode": "classic",
        "totalTurn": 3,
        "playerCount": 2,
        "players": [
            {
                "id": "p1",
                "name": "Alice",
                "color": "red",
                "position": 1,
                "energy": 5,
                "handCount": 2,
                "hand": [p1_card_a, p1_card_b],
                "faceUpCards": [],
                "eliminated": False,
            },
            {
                "id": "p2",
                "name": "Bob",
                "color": "blue",
                "position": -1,  # hidden
                "energy": 4,
                "handCount": 0,
                "hand": [],
                "faceUpCards": [],
                "eliminated": False,
            },
        ],
        "currentPlayerIndex": 0,
        "currentPlayerId": "p1",
        "localPlayerId": "p1",
        "flyingStrikes": [],
        "turnPhase": "actionPhase",
        "logs": [
            _make_log("l1", 1, msg="对局开始", log_type="system"),
            _make_log("l2", 2, msg="Alice 部署打击卡", log_type="action"),
        ],
        "destroyedStars": [5],
        "starEffects": [],
        "winner": None,
        "isProcessing": False,
        "mapSnapshot": {"nodes": nodes, "edges": edges},
        "_viewMeta": {"role": "PLAYER", "viewerId": "p1", "timestamp": 123},
    }


class TestViewStateParsing:
    """Verify ViewState.model_validate parses a realistic fullSync payload."""

    def test_parse_succeeds_and_fields_match(self) -> None:
        sample = _make_sample_full_sync()
        vs = ViewState.model_validate(sample)

        assert vs.phase == "playing"
        assert vs.game_mode == "classic"
        assert vs.total_turn == 3
        assert vs.player_count == 2
        assert vs.current_player_index == 0
        assert vs.current_player_id == "p1"
        assert vs.local_player_id == "p1"
        assert vs.turn_phase == "actionPhase"
        assert vs.winner is None
        assert vs.is_processing is False
        assert vs.destroyed_stars == [5]
        assert vs.view_meta.role == "PLAYER"
        assert vs.view_meta.viewer_id == "p1"
        assert vs.view_meta.timestamp == 123

    def test_local_player_has_two_cards_opponent_hand_empty(self) -> None:
        sample = _make_sample_full_sync()
        vs = ViewState.model_validate(sample)

        assert len(vs.players) == 2
        local = next(p for p in vs.players if p.id == "p1")
        opponent = next(p for p in vs.players if p.id == "p2")

        assert len(local.hand) == 2
        assert local.hand_count == 2
        assert all(isinstance(c, Card) for c in local.hand)
        assert local.hand[0].name == "广播卡A"
        assert local.hand[1].name == "打击卡B"
        assert local.energy == 5
        assert local.position == 1
        assert local.eliminated is False

        assert opponent.hand == []
        assert opponent.hand_count == 0
        assert opponent.energy == 4

    def test_map_snapshot_has_nine_nodes(self) -> None:
        sample = _make_sample_full_sync()
        vs = ViewState.model_validate(sample)

        assert vs.map_snapshot is not None
        assert isinstance(vs.map_snapshot, MapLayoutSnapshot)
        assert len(vs.map_snapshot.nodes) == 9
        assert len(vs.map_snapshot.edges) == 14
        assert all(isinstance(n, StarNode) for n in vs.map_snapshot.nodes)
        assert all(isinstance(e, StarEdge) for e in vs.map_snapshot.edges)
        # alias "from" → from_
        assert vs.map_snapshot.edges[0].from_ == 0
        assert vs.map_snapshot.edges[0].to == 1

    def test_opponent_hidden_position_minus_one(self) -> None:
        sample = _make_sample_full_sync()
        vs = ViewState.model_validate(sample)
        opponent = next(p for p in vs.players if p.id == "p2")
        assert opponent.position == -1

    def test_card_optional_fields_default_to_none(self) -> None:
        sample = _make_sample_full_sync()
        vs = ViewState.model_validate(sample)
        local = next(p for p in vs.players if p.id == "p1")
        for card in local.hand:
            assert card.range_ is None
            assert card.level is None
            assert card.speed is None
            assert card.effect is None
            assert card.protection_level is None
            assert card.energy_per_turn is None
            assert card.ability is None
            assert card.subtype is None

    def test_logs_parsed_as_logentry_list(self) -> None:
        sample = _make_sample_full_sync()
        vs = ViewState.model_validate(sample)
        assert len(vs.logs) == 2
        assert all(isinstance(log, LogEntry) for log in vs.logs)
        assert vs.logs[0].turn == 1
        assert vs.logs[0].type == "system"
        assert vs.logs[1].message == "Alice 部署打击卡"


class TestStrictForbid:
    """extra='forbid' on _StrictModel must reject unknown top-level fields."""

    def test_unknown_top_level_field_raises(self) -> None:
        sample = _make_sample_full_sync()
        sample["unknownField"] = 123  # type: ignore[assignment]
        with pytest.raises(ValidationError):
            ViewState.model_validate(sample)

    def test_unknown_card_field_raises(self) -> None:
        sample = _make_sample_full_sync()
        sample["players"][0]["hand"][0]["bogusField"] = "x"  # type: ignore[assignment]
        with pytest.raises(ValidationError):
            ViewState.model_validate(sample)


class TestModeRulesPermissive:
    """ModeRules intentionally allows extras (opaque forward-only blob)."""

    def test_mode_rules_unknown_fields_allowed(self) -> None:
        sample = _make_sample_full_sync()
        sample["modeRules"] = {
            "anyUnknownField": 123,
            "anotherOne": ["a", "b"],
            "nested": {"deep": True},
        }
        vs = ViewState.model_validate(sample)
        assert vs.mode_rules is not None
        assert isinstance(vs.mode_rules, ModeRules)
        # Permissive model retains the extras (extra="allow")
        assert vs.mode_rules.model_dump().get("anyUnknownField") == 123

    def test_mode_rules_none_allowed(self) -> None:
        sample = _make_sample_full_sync()
        # modeRules is Optional — backend may omit it
        vs = ViewState.model_validate(sample)
        assert vs.mode_rules is None


class TestFrozenSemantics:
    """``frozen=True`` on _StrictModel prevents post-construction mutation."""

    def test_view_state_frozen(self) -> None:
        vs = ViewState.model_validate(_make_sample_full_sync())
        with pytest.raises(ValidationError):
            vs.total_turn = 999  # type: ignore[misc]

    def test_card_frozen(self) -> None:
        vs = ViewState.model_validate(_make_sample_full_sync())
        card = vs.players[0].hand[0]
        with pytest.raises(ValidationError):
            card.energy = 99  # type: ignore[misc]


class TestFieldAliasesRoundtrip:
    """model_dump(by_alias=True) should produce backend-compatible JSON keys.

    This is critical for delta.py — applying changes to a model_dump'd dict
    requires keys to match backend Change.path segments (which use camelCase).
    """

    def test_dump_by_alias_keeps_camelcase_keys(self) -> None:
        vs = ViewState.model_validate(_make_sample_full_sync())
        dumped = vs.model_dump(by_alias=True)
        assert "totalTurn" in dumped
        assert "currentPlayerId" in dumped
        assert "localPlayerId" in dumped
        assert "flyingStrikes" in dumped
        assert "turnPhase" in dumped
        assert "destroyedStars" in dumped
        assert "isProcessing" in dumped
        assert "mapSnapshot" in dumped
        assert "_viewMeta" in dumped
        # Ensure re-validation from dumped dict succeeds (delta path uses this)
        vs2 = ViewState.model_validate(copy.deepcopy(dumped))
        assert vs2.total_turn == vs.total_turn
        assert vs2.local_player_id == vs.local_player_id


class TestGoNilSliceNullCoercion:
    """Go slices without ``omitempty`` serialize nil as JSON ``null``.

    Backend ViewState/PlayerView/BroadcastStateView/MapLayoutSnapshot have
    several slice fields without omitempty (players, flyingStrikes, logs,
    destroyedStars, starEffects, faceUpCards, broadcastHistory, responses,
    nodes, edges). The bot must coerce ``null`` → ``[]`` to avoid
    ValidationError. See view_state.py ``_coerce_none_to_list``.
    """

    def _make_null_payload(self) -> dict[str, object]:
        """Minimal payload with all nullable list fields set to None."""
        return {
            "phase": "playing",
            "totalTurn": 1,
            "playerCount": 2,
            "players": None,
            "currentPlayerIndex": 0,
            "currentPlayerId": "p1",
            "localPlayerId": "p1",
            "flyingStrikes": None,
            "turnPhase": "actionPhase",
            "logs": None,
            "destroyedStars": None,
            "starEffects": None,
            "_viewMeta": {"role": "PLAYER", "viewerId": "p1", "timestamp": 0},
        }

    def test_top_level_null_lists_coerced_to_empty(self) -> None:
        vs = ViewState.model_validate(self._make_null_payload())
        assert vs.players == []
        assert vs.flying_strikes == []
        assert vs.logs == []
        assert vs.destroyed_stars == []
        assert vs.star_effects == []

    def test_player_face_up_cards_null_coerced(self) -> None:
        payload = _make_sample_full_sync()
        # Override both players' faceUpCards to null (Go nil slice).
        payload["players"][0]["faceUpCards"] = None  # type: ignore[assignment]
        payload["players"][1]["faceUpCards"] = None  # type: ignore[assignment]
        # broadcastHistory also lacks omitempty in backend.
        payload["players"][0]["broadcastHistory"] = None  # type: ignore[assignment]
        payload["players"][1]["broadcastHistory"] = None  # type: ignore[assignment]
        vs = ViewState.model_validate(payload)
        assert vs.players[0].face_up_cards == []
        assert vs.players[1].face_up_cards == []
        assert vs.players[0].broadcast_history == []
        assert vs.players[1].broadcast_history == []

    def test_map_snapshot_null_nodes_edges_coerced(self) -> None:
        payload = _make_sample_full_sync()
        payload["mapSnapshot"] = {"nodes": None, "edges": None}  # type: ignore[assignment]
        vs = ViewState.model_validate(payload)
        assert vs.map_snapshot is not None
        assert vs.map_snapshot.nodes == []
        assert vs.map_snapshot.edges == []

    def test_broadcast_responses_null_coerced(self) -> None:
        payload = _make_sample_full_sync()
        payload["broadcast"] = {
            "broadcasterId": "p2",
            "cardUid": "bc",
            "targetSystem": 1,
            "range": 1,
            "responses": None,
            "phase": "waiting",
        }
        vs = ViewState.model_validate(payload)
        assert vs.broadcast is not None
        assert vs.broadcast.responses == []
