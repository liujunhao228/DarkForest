"""deltaSync change applier — applies path-based changes to a state dict.

Backend emits ``game:deltaSync`` with a ``changes`` list. Each Change has a
``path`` (dotted, with optional ``[index]`` segments) and an operation
(``type: "set"`` or ``type: "delete"``). This module applies those changes
in place to a plain dict produced by ``ViewState.model_dump(by_alias=True)``.

Authoritative source:
    e:\\DarkForest\\backend\\internal\\game\\delta_sync.go (path grammar)
    e:\\DarkForest\\backend\\internal\\game\\view_state.go (field names)

When backend delta_sync.go changes path grammar or change types, update this
file in lockstep.

Design notes:
- ``state`` and ``value`` use ``Any`` because they sit on the JSON boundary
  (backend ``json.RawMessage`` / ``interface{}``). This matches the ``Any``
  usage in protocol.py. ``Any`` does not appear in any other public
  signature in this module.
- We do NOT auto-create intermediate dicts. Backend diff produces paths that
  already exist; a missing path indicates backend/bot drift and should raise
  ``DeltaApplyError`` rather than silently invent structure.
- ``logs`` is append-only: a ``set`` to ``logs[len]`` is treated as append.
  A ``set`` to ``logs[i]`` where ``i < len`` replaces element i.
  A ``set`` to ``logs[i]`` where ``i > len`` raises (gap detected).
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import Field

from darkforest_bot.backend.protocol import _StrictModel

_SEGMENT_RE = re.compile(r"^(\w+)(?:\[(\d+)\])?$")


class DeltaApplyError(Exception):
    """Raised when a Change path cannot be applied to the state dict.

    Catchers should fall back to ``game:requestSync`` to resync fully.
    """


class Change(_StrictModel):
    """One deltaSync change. Mirrors backend delta_sync.Change.

    Wire JSON example::

        {"path": "players[0].energy", "value": 5, "type": "set"}
        {"path": "broadcast", "type": "delete"}

    ``type`` uses an alias because ``type`` shadows Python builtin ``type``
    in some contexts; we keep the field name readable and let the alias
    handle the wire tag.
    """

    path: str
    value: Any | None = None
    change_type: str = Field(alias="type")


def _parse_segment(segment: str) -> tuple[str, int | None]:
    """Parse 'fieldName' or 'fieldName[index]' into (name, index_or_None)."""
    match = _SEGMENT_RE.match(segment)
    if not match:
        raise DeltaApplyError(f"invalid path segment: {segment!r}")
    name = match.group(1)
    idx_str = match.group(2)
    return name, (int(idx_str) if idx_str is not None else None)


def apply_changes(state: dict[str, Any], changes: list[Change]) -> None:
    """Apply each Change in order, mutating ``state`` in place.

    Raises ``DeltaApplyError`` on any structural mismatch (missing key,
    out-of-bounds index, type mismatch). The state dict may be left
    partially mutated when an error occurs mid-list — callers should
    fall back to ``game:requestSync`` on error and discard the partial
    state.
    """
    for change in changes:
        _apply_one(state, change)


def _apply_one(state: dict[str, Any], change: Change) -> None:
    """Apply a single Change. Mutates state in place."""
    if not change.path:
        raise DeltaApplyError("empty path")

    segments = change.path.split(".")
    if not segments:
        raise DeltaApplyError(f"empty path: {change.path!r}")

    # Walk all but the last segment.
    current: Any = state
    for seg in segments[:-1]:
        try:
            name, idx = _parse_segment(seg)
            current = _walk_one(current, name, idx)
        except DeltaApplyError:
            raise
        except (KeyError, IndexError, TypeError) as exc:
            raise DeltaApplyError(f"path '{change.path}' apply failed: {exc}") from exc

    # Apply the operation at the last segment.
    last_seg = segments[-1]
    try:
        name, idx = _parse_segment(last_seg)
        _apply_terminal(current, name, idx, change)
    except DeltaApplyError:
        raise
    except (KeyError, IndexError, TypeError) as exc:
        raise DeltaApplyError(f"path '{change.path}' apply failed: {exc}") from exc


def _walk_one(current: Any, name: str, idx: int | None) -> Any:
    """Walk one non-terminal segment: descend into dict (and list if indexed)."""
    if not isinstance(current, dict):
        raise DeltaApplyError(
            f"cannot descend into {type(current).__name__} at segment {name!r}"
        )
    if name not in current:
        raise DeltaApplyError(f"missing key {name!r} (path does not exist)")
    nxt: Any = current[name]
    if idx is None:
        return nxt
    if not isinstance(nxt, list):
        raise DeltaApplyError(
            f"cannot index into {type(nxt).__name__} at segment {name!r}[{idx}]"
        )
    if idx >= len(nxt):
        raise DeltaApplyError(f"index {idx} out of bounds for {name!r} (len={len(nxt)})")
    return nxt[idx]


def _apply_terminal(
    current: Any, name: str, idx: int | None, change: Change
) -> None:
    """Apply the final operation (set/delete) at the last path segment."""
    op = change.change_type
    if op == "set":
        _apply_set(current, name, idx, change.value)
    elif op == "delete":
        _apply_delete(current, name, idx)
    else:
        raise DeltaApplyError(f"unknown change type: {op!r}")


def _apply_set(
    current: Any, name: str, idx: int | None, value: Any
) -> None:
    """Set operation: assign value at dict key or list index.

    Special cases:
    - ``value is None`` → treated as delete (defensive; backend uses
      ``type:"delete"`` explicitly, but None set should not leave a null).
    - List index == len(list) → append (handles logs append-only tail set).
    - List index > len(list) → raise (gap detected; backend never emits
      such paths for set-on-absent).
    """
    if idx is None:
        # Pure dict-key set.
        if not isinstance(current, dict):
            raise DeltaApplyError(
                f"cannot set key {name!r} on {type(current).__name__}"
            )
        if value is None:
            current.pop(name, None)
        else:
            current[name] = value
        return

    # Indexed set: current[name] must be a list.
    if not isinstance(current, dict):
        raise DeltaApplyError(
            f"cannot set indexed key {name!r} on {type(current).__name__}"
        )
    if name not in current:
        raise DeltaApplyError(f"missing key {name!r} (path does not exist)")
    lst = current[name]
    if not isinstance(lst, list):
        raise DeltaApplyError(
            f"cannot index into {type(lst).__name__} at {name!r}[{idx}]"
        )
    if idx < len(lst):
        if value is None:
            # Defensive: None set on existing index deletes that element.
            del lst[idx]
        else:
            lst[idx] = value
    elif idx == len(lst):
        # Append-only tail set (e.g. logs[len]).
        if value is None:
            # Appending None is meaningless; treat as no-op rather than
            # pollute the list. Backend should use delete for removal.
            return
        lst.append(value)
    else:
        raise DeltaApplyError(
            f"index {idx} out of bounds for {name!r} (len={len(lst)}); "
            "gap detected — backend should never emit such a path"
        )


def _apply_delete(current: Any, name: str, idx: int | None) -> None:
    """Delete operation: remove dict key or list element."""
    if idx is None:
        if not isinstance(current, dict):
            raise DeltaApplyError(
                f"cannot delete key {name!r} on {type(current).__name__}"
            )
        if name not in current:
            raise DeltaApplyError(f"cannot delete missing key {name!r}")
        del current[name]
        return

    if not isinstance(current, dict):
        raise DeltaApplyError(
            f"cannot delete indexed key {name!r} on {type(current).__name__}"
        )
    if name not in current:
        raise DeltaApplyError(f"missing key {name!r} (path does not exist)")
    lst = current[name]
    if not isinstance(lst, list):
        raise DeltaApplyError(
            f"cannot index into {type(lst).__name__} at {name!r}[{idx}]"
        )
    if idx >= len(lst):
        raise DeltaApplyError(
            f"index {idx} out of bounds for {name!r} (len={len(lst)})"
        )
    del lst[idx]
