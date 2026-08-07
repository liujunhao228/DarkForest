"""Tests for backend/delta.py — path-based deltaSync change applier."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from darkforest_bot.backend.delta import (
    Change,
    DeltaApplyError,
    apply_changes,
)


class TestChangeModel:
    """Change pydantic model: extra=forbid, alias 'type' → change_type."""

    def test_alias_type_to_change_type(self) -> None:
        c = Change.model_validate({"path": "totalTurn", "value": 2, "type": "set"})
        assert c.path == "totalTurn"
        assert c.value == 2
        assert c.change_type == "set"

    def test_delete_change_without_value(self) -> None:
        c = Change.model_validate({"path": "broadcast", "type": "delete"})
        assert c.change_type == "delete"
        assert c.value is None

    def test_extra_field_forbidden(self) -> None:
        with pytest.raises(ValidationError):
            Change.model_validate(
                {"path": "x", "value": 1, "type": "set", "extra": True}
            )


class TestSetScalar:
    def test_set_top_level_scalar(self) -> None:
        state: dict[str, object] = {"totalTurn": 1}
        apply_changes(state, [Change.model_validate(
            {"path": "totalTurn", "value": 2, "type": "set"}
        )])
        assert state["totalTurn"] == 2

    def test_set_creates_new_key_when_value_not_none(self) -> None:
        # Per spec case (7): nil → non-nil set creates the key.
        state: dict[str, object] = {}
        apply_changes(state, [Change.model_validate(
            {"path": "winner", "value": "p1", "type": "set"}
        )])
        assert state["winner"] == "p1"


class TestSetNested:
    def test_set_nested_dict_field(self) -> None:
        state: dict[str, object] = {"players": [{"energy": 3}]}
        apply_changes(state, [Change.model_validate(
            {"path": "players[0].energy", "value": 5, "type": "set"}
        )])
        assert state["players"][0]["energy"] == 5  # type: ignore[index]

    def test_set_array_element_field(self) -> None:
        state: dict[str, object] = {"flyingStrikes": [{"position": 1}]}
        apply_changes(state, [Change.model_validate(
            {"path": "flyingStrikes[0].position", "value": 3, "type": "set"}
        )])
        assert state["flyingStrikes"][0]["position"] == 3  # type: ignore[index]


class TestLogsAppend:
    def test_logs_append_via_index_equal_len(self) -> None:
        state: dict[str, object] = {"logs": [{"id": "a"}]}
        apply_changes(state, [Change.model_validate(
            {"path": "logs[1]", "value": {"id": "b"}, "type": "set"}
        )])
        assert len(state["logs"]) == 2  # type: ignore[arg-type]
        assert state["logs"][1]["id"] == "b"  # type: ignore[index]

    def test_logs_replace_existing_index(self) -> None:
        state: dict[str, object] = {"logs": [{"id": "a"}, {"id": "b"}]}
        apply_changes(state, [Change.model_validate(
            {"path": "logs[0]", "value": {"id": "a2"}, "type": "set"}
        )])
        assert state["logs"][0]["id"] == "a2"  # type: ignore[index]
        assert len(state["logs"]) == 2  # type: ignore[arg-type]


class TestDelete:
    def test_delete_dict_key(self) -> None:
        state: dict[str, object] = {"broadcast": {"phase": "reveal"}}
        apply_changes(state, [Change.model_validate(
            {"path": "broadcast", "type": "delete"}
        )])
        assert "broadcast" not in state

    def test_delete_array_element(self) -> None:
        state: dict[str, object] = {"players": [{}, {}, {}]}
        apply_changes(state, [Change.model_validate(
            {"path": "players[2]", "type": "delete"}
        )])
        assert len(state["players"]) == 2  # type: ignore[arg-type]

    def test_delete_missing_key_raises(self) -> None:
        state: dict[str, object] = {"a": 1}
        with pytest.raises(DeltaApplyError):
            apply_changes(state, [Change.model_validate(
                {"path": "b", "type": "delete"}
            )])


class TestErrorCases:
    def test_missing_intermediate_key_raises(self) -> None:
        # Per spec case (8): nonexistent nested path must raise.
        state: dict[str, object] = {"a": 1}
        with pytest.raises(DeltaApplyError):
            apply_changes(state, [Change.model_validate(
                {"path": "b.c", "value": 1, "type": "set"}
            )])

    def test_array_index_out_of_bounds_no_append_raises(self) -> None:
        # Per spec case (9): logs[5] with len=0 is out of bounds, NOT append.
        # Append only happens when idx == len.
        state: dict[str, object] = {"logs": []}
        with pytest.raises(DeltaApplyError):
            apply_changes(state, [Change.model_validate(
                {"path": "logs[5]", "value": {"id": "x"}, "type": "set"}
            )])

    def test_indexing_non_list_raises(self) -> None:
        state: dict[str, object] = {"a": {"b": 1}}
        with pytest.raises(DeltaApplyError):
            apply_changes(state, [Change.model_validate(
                {"path": "a[0]", "value": 2, "type": "set"}
            )])

    def test_unknown_change_type_raises(self) -> None:
        state: dict[str, object] = {"a": 1}
        with pytest.raises(DeltaApplyError):
            apply_changes(state, [Change.model_validate(
                {"path": "a", "value": 2, "type": "rename"}
            )])

    def test_walk_through_non_dict_raises(self) -> None:
        state: dict[str, object] = {"a": 5}  # a is int, not dict
        with pytest.raises(DeltaApplyError):
            apply_changes(state, [Change.model_validate(
                {"path": "a.b", "value": 1, "type": "set"}
            )])


class TestMultipleChanges:
    def test_multiple_changes_applied_in_order(self) -> None:
        state: dict[str, object] = {
            "totalTurn": 1,
            "players": [{"energy": 3}],
            "logs": [],
        }
        changes = [
            Change.model_validate({"path": "totalTurn", "value": 2, "type": "set"}),
            Change.model_validate(
                {"path": "players[0].energy", "value": 5, "type": "set"}
            ),
            Change.model_validate(
                {"path": "logs[0]", "value": {"id": "l1"}, "type": "set"}
            ),
        ]
        apply_changes(state, changes)
        assert state["totalTurn"] == 2
        assert state["players"][0]["energy"] == 5  # type: ignore[index]
        assert len(state["logs"]) == 1  # type: ignore[arg-type]


class TestDefensiveNoneSet:
    """A set with value=None is treated as delete (defensive)."""

    def test_none_set_on_existing_dict_key_deletes(self) -> None:
        state: dict[str, object] = {"winner": "p1", "a": 1}
        apply_changes(state, [Change.model_validate(
            {"path": "winner", "value": None, "type": "set"}
        )])
        assert "winner" not in state

    def test_none_set_on_missing_dict_key_noop(self) -> None:
        state: dict[str, object] = {"a": 1}
        apply_changes(state, [Change.model_validate(
            {"path": "b", "value": None, "type": "set"}
        )])
        assert "b" not in state
        assert state == {"a": 1}
