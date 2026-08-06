"""Tests for session/states.py and session/manager.py.

Covers:
- Legal state transitions (all 6 legal paths)
- Illegal transitions raise IllegalTransitionError
- get_or_create idempotency
- set_player_info / set_ws / transition(room_id=...) field updates
- clear() resets session to IDLE with empty fields
- Concurrent transitions on the same qq serialize correctly via acquire()
"""

from __future__ import annotations

import asyncio

import pytest

from darkforest_bot.session.manager import Session, SessionManager
from darkforest_bot.session.states import (
    LEGAL_TRANSITIONS,
    IllegalTransitionError,
    SessionState,
    is_legal_transition,
)

# ---------------------------------------------------------------------------
# States + transition table
# ---------------------------------------------------------------------------


class TestSessionStateEnum:
    def test_state_values(self) -> None:
        assert SessionState.IDLE.value == "idle"
        assert SessionState.MATCHMAKING.value == "matchmaking"
        assert SessionState.IN_ROOM.value == "in-room"
        assert SessionState.IN_GAME.value == "in-game"

    def test_str_coercion(self) -> None:
        # StrEnum subclasses str, so str(state) returns the value.
        assert str(SessionState.IDLE) == "idle"


class TestLegalTransitions:
    def test_idle_to_matchmaking(self) -> None:
        assert is_legal_transition(SessionState.IDLE, SessionState.MATCHMAKING)

    def test_matchmaking_to_in_room(self) -> None:
        assert is_legal_transition(SessionState.MATCHMAKING, SessionState.IN_ROOM)

    def test_matchmaking_to_idle(self) -> None:
        assert is_legal_transition(SessionState.MATCHMAKING, SessionState.IDLE)

    def test_in_room_to_in_game(self) -> None:
        assert is_legal_transition(SessionState.IN_ROOM, SessionState.IN_GAME)

    def test_in_room_to_idle(self) -> None:
        assert is_legal_transition(SessionState.IN_ROOM, SessionState.IDLE)

    def test_in_game_to_idle(self) -> None:
        assert is_legal_transition(SessionState.IN_GAME, SessionState.IDLE)

    def test_all_legal_paths_covered(self) -> None:
        """Ensure the 6 legal paths enumerated above match the table exactly."""
        all_legal: set[tuple[SessionState, SessionState]] = set()
        for src, dsts in LEGAL_TRANSITIONS.items():
            for dst in dsts:
                all_legal.add((src, dst))
        expected = {
            (SessionState.IDLE, SessionState.MATCHMAKING),
            (SessionState.MATCHMAKING, SessionState.IN_ROOM),
            (SessionState.MATCHMAKING, SessionState.IDLE),
            (SessionState.IN_ROOM, SessionState.IN_GAME),
            (SessionState.IN_ROOM, SessionState.IDLE),
            (SessionState.IN_GAME, SessionState.IDLE),
        }
        assert all_legal == expected


class TestIllegalTransitions:
    @pytest.mark.parametrize(
        ("from_state", "to_state"),
        [
            (SessionState.IDLE, SessionState.IN_ROOM),
            (SessionState.IDLE, SessionState.IN_GAME),
            (SessionState.MATCHMAKING, SessionState.IN_GAME),
            (SessionState.IN_GAME, SessionState.MATCHMAKING),
            (SessionState.IN_GAME, SessionState.IN_ROOM),
            (SessionState.IN_ROOM, SessionState.MATCHMAKING),
        ],
    )
    def test_illegal_returns_false(self, from_state: SessionState, to_state: SessionState) -> None:
        assert not is_legal_transition(from_state, to_state)

    def test_illegal_transition_error_message(self) -> None:
        err = IllegalTransitionError(SessionState.IDLE, SessionState.IN_GAME)
        assert err.from_state is SessionState.IDLE
        assert err.to_state is SessionState.IN_GAME
        assert "idle" in str(err)
        assert "in-game" in str(err)


# ---------------------------------------------------------------------------
# Session dataclass
# ---------------------------------------------------------------------------


class TestSessionDataclass:
    def test_defaults(self) -> None:
        s = Session(qq=12345)
        assert s.qq == 12345
        assert s.player_id == ""
        assert s.display_name == ""
        assert s.state is SessionState.IDLE
        assert s.room_id is None
        assert s.ws is None

    def test_mutable(self) -> None:
        """Session is intentionally not frozen (frozen=False)."""
        s = Session(qq=1)
        s.state = SessionState.MATCHMAKING
        s.room_id = "room-abc"
        assert s.state is SessionState.MATCHMAKING
        assert s.room_id == "room-abc"

    def test_slots_blocks_unknown_attrs(self) -> None:
        s = Session(qq=1)
        with pytest.raises(AttributeError):
            s.unknown_attr = "x"  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# SessionManager: basic operations
# ---------------------------------------------------------------------------


class TestSessionManagerBasic:
    async def test_get_returns_none_for_unknown(self) -> None:
        mgr = SessionManager()
        assert mgr.get(999) is None

    async def test_get_or_create_creates_idle_session(self) -> None:
        mgr = SessionManager()
        session = mgr.get_or_create(100)
        assert session.qq == 100
        assert session.state is SessionState.IDLE

    async def test_get_or_create_idempotent_returns_same_object(self) -> None:
        mgr = SessionManager()
        s1 = mgr.get_or_create(100)
        s2 = mgr.get_or_create(100)
        assert s1 is s2

    async def test_get_after_create(self) -> None:
        mgr = SessionManager()
        mgr.get_or_create(100)
        assert mgr.get(100) is not None
        assert mgr.get(100).qq == 100  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# SessionManager: transitions
# ---------------------------------------------------------------------------


class TestSessionManagerTransitions:
    async def test_legal_transition_idle_to_matchmaking(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            mgr.transition(1, SessionState.MATCHMAKING)
            assert mgr.get(1).state is SessionState.MATCHMAKING  # type: ignore[union-attr]

    async def test_legal_transition_matchmaking_to_in_room_with_room_id(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            mgr.transition(1, SessionState.MATCHMAKING)
            mgr.transition(1, SessionState.IN_ROOM, room_id="room-xyz")
            session = mgr.get(1)
            assert session.state is SessionState.IN_ROOM  # type: ignore[union-attr]
            assert session.room_id == "room-xyz"  # type: ignore[union-attr]

    async def test_legal_transition_matchmaking_to_idle(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            mgr.transition(1, SessionState.MATCHMAKING)
            mgr.transition(1, SessionState.IDLE)
            assert mgr.get(1).state is SessionState.IDLE  # type: ignore[union-attr]

    async def test_legal_transition_in_room_to_in_game(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            mgr.transition(1, SessionState.MATCHMAKING)
            mgr.transition(1, SessionState.IN_ROOM, room_id="r1")
            mgr.transition(1, SessionState.IN_GAME)
            assert mgr.get(1).state is SessionState.IN_GAME  # type: ignore[union-attr]

    async def test_legal_transition_in_room_to_idle(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            mgr.transition(1, SessionState.MATCHMAKING)
            mgr.transition(1, SessionState.IN_ROOM, room_id="r1")
            mgr.transition(1, SessionState.IDLE)
            assert mgr.get(1).state is SessionState.IDLE  # type: ignore[union-attr]

    async def test_legal_transition_in_game_to_idle(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            mgr.transition(1, SessionState.MATCHMAKING)
            mgr.transition(1, SessionState.IN_ROOM, room_id="r1")
            mgr.transition(1, SessionState.IN_GAME)
            mgr.transition(1, SessionState.IDLE)
            assert mgr.get(1).state is SessionState.IDLE  # type: ignore[union-attr]

    async def test_illegal_transition_idle_to_in_room_raises(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            with pytest.raises(IllegalTransitionError):
                mgr.transition(1, SessionState.IN_ROOM)

    async def test_illegal_transition_idle_to_in_game_raises(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            with pytest.raises(IllegalTransitionError):
                mgr.transition(1, SessionState.IN_GAME)

    async def test_illegal_transition_matchmaking_to_in_game_raises(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            mgr.transition(1, SessionState.MATCHMAKING)
            with pytest.raises(IllegalTransitionError):
                mgr.transition(1, SessionState.IN_GAME)

    async def test_illegal_transition_in_game_to_matchmaking_raises(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            mgr.transition(1, SessionState.MATCHMAKING)
            mgr.transition(1, SessionState.IN_ROOM, room_id="r1")
            mgr.transition(1, SessionState.IN_GAME)
            with pytest.raises(IllegalTransitionError):
                mgr.transition(1, SessionState.MATCHMAKING)

    async def test_transition_room_id_not_overwritten_when_omitted(self) -> None:
        """transition() should NOT clobber room_id when room_id=None is omitted."""
        mgr = SessionManager()
        async with mgr.acquire(1):
            mgr.transition(1, SessionState.MATCHMAKING)
            mgr.transition(1, SessionState.IN_ROOM, room_id="room-keep")
            # Subsequent transition without room_id should preserve existing.
            mgr.transition(1, SessionState.IN_GAME)
            assert mgr.get(1).room_id == "room-keep"  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# SessionManager: set_player_info / set_ws / clear
# ---------------------------------------------------------------------------


class TestSessionManagerFields:
    async def test_set_player_info(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            mgr.set_player_info(1, "player-uuid-123", "Alice")
            session = mgr.get(1)
            assert session.player_id == "player-uuid-123"  # type: ignore[union-attr]
            assert session.display_name == "Alice"  # type: ignore[union-attr]

    async def test_set_ws(self) -> None:
        mgr = SessionManager()
        fake_ws = object()  # stand-in for WSClient
        async with mgr.acquire(1):
            mgr.set_ws(1, fake_ws)  # type: ignore[arg-type]
            assert mgr.get(1).ws is fake_ws  # type: ignore[union-attr]

    async def test_clear_resets_all_fields(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            mgr.set_player_info(1, "pid", "Bob")
            mgr.set_ws(1, object())  # type: ignore[arg-type]
            mgr.transition(1, SessionState.MATCHMAKING)
            mgr.transition(1, SessionState.IN_ROOM, room_id="r2")
            session_before = mgr.get(1)
            assert session_before.state is SessionState.IN_ROOM  # type: ignore[union-attr]
            assert session_before.room_id == "r2"  # type: ignore[union-attr]

            mgr.clear(1)
            session_after = mgr.get(1)
            assert session_after.state is SessionState.IDLE  # type: ignore[union-attr]
            assert session_after.player_id == ""  # type: ignore[union-attr]
            assert session_after.display_name == ""  # type: ignore[union-attr]
            assert session_after.room_id is None  # type: ignore[union-attr]
            assert session_after.ws is None  # type: ignore[union-attr]

    async def test_clear_on_nonexistent_session_creates_idle(self) -> None:
        mgr = SessionManager()
        async with mgr.acquire(1):
            mgr.clear(1)
            session = mgr.get(1)
            assert session is not None
            assert session.state is SessionState.IDLE


# ---------------------------------------------------------------------------
# SessionManager: concurrency
# ---------------------------------------------------------------------------


class TestSessionManagerConcurrency:
    async def test_concurrent_transitions_serialize_correctly(self) -> None:
        """Two tasks transitioning the same qq must not corrupt state.

        Each task acquires the qq's lock, transitions IDLE->MATCHMAKING->IDLE.
        Without serialization, the second task might see MATCHMAKING (set by
        the first) and fail to transition back to IDLE before the first tries
        IDLE->MATCHMAKING again. With proper locking, each task sees a clean
        IDLE->MATCHMAKING->IDLE cycle.
        """
        mgr = SessionManager()
        qq = 42
        errors: list[str] = []

        async def worker() -> None:
            try:
                async with mgr.acquire(qq):
                    mgr.transition(qq, SessionState.MATCHMAKING)
                    mgr.transition(qq, SessionState.IDLE)
            except IllegalTransitionError as e:
                errors.append(str(e))

        # Run 10 concurrent workers, each doing 5 cycles.
        async def run_cycles(n: int) -> None:
            for _ in range(n):
                await worker()

        await asyncio.gather(*[run_cycles(5) for _ in range(10)])

        assert errors == [], f"Concurrent transition errors: {errors}"
        assert mgr.get(qq).state is SessionState.IDLE  # type: ignore[union-attr]

    async def test_concurrent_get_or_create_returns_same_object(self) -> None:
        """get_or_create called concurrently must not create duplicates."""
        mgr = SessionManager()
        qq = 777

        results: list[Session] = []

        async def getter() -> None:
            results.append(mgr.get_or_create(qq))

        await asyncio.gather(*[getter() for _ in range(20)])

        # All results should be the same object.
        first = results[0]
        assert all(r is first for r in results)

    async def test_locks_are_per_qq(self) -> None:
        """Different qqs should have independent locks (no cross-blocking)."""
        mgr = SessionManager()

        # Acquire lock for qq=1; qq=2 should still be acquirable.
        async with mgr.acquire(1):
            async with mgr.acquire(2):
                # Both locks held simultaneously — no deadlock.
                mgr.get_or_create(1)
                mgr.get_or_create(2)

    async def test_acquire_releases_on_exception(self) -> None:
        """Lock must be released even if the body raises."""
        mgr = SessionManager()
        qq = 99

        with pytest.raises(RuntimeError, match="boom"):
            async with mgr.acquire(qq):
                raise RuntimeError("boom")

        # Should be able to re-acquire immediately (lock was released).
        async with mgr.acquire(qq):
            mgr.get_or_create(qq)


# ---------------------------------------------------------------------------
# SessionManager: all_qqs helper
# ---------------------------------------------------------------------------


class TestSessionManagerAllQqs:
    async def test_all_qqs_empty(self) -> None:
        mgr = SessionManager()
        assert mgr.all_qqs() == []

    async def test_all_qqs_after_creates(self) -> None:
        mgr = SessionManager()
        mgr.get_or_create(1)
        mgr.get_or_create(2)
        mgr.get_or_create(3)
        assert sorted(mgr.all_qqs()) == [1, 2, 3]
