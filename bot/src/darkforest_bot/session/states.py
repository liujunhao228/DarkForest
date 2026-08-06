"""Session state machine: states, legal transitions, and helpers."""

from __future__ import annotations

from enum import StrEnum


class SessionState(StrEnum):
    """Lifecycle states for a single QQ's bot session.

    The state machine governs one QQ account's progress through matchmaking
    and a single game room. Transitions are constrained by LEGAL_TRANSITIONS
    to prevent illegal jumps (e.g. IDLE -> IN_GAME).
    """

    IDLE = "idle"
    MATCHMAKING = "matchmaking"
    IN_ROOM = "in-room"
    IN_GAME = "in-game"


# Legal forward/backward transitions. Each state maps to the set of states it
# may transition to. Anything not listed here is rejected by SessionManager.
LEGAL_TRANSITIONS: dict[SessionState, frozenset[SessionState]] = {
    SessionState.IDLE: frozenset({SessionState.MATCHMAKING}),
    SessionState.MATCHMAKING: frozenset({SessionState.IN_ROOM, SessionState.IDLE}),
    SessionState.IN_ROOM: frozenset({SessionState.IN_GAME, SessionState.IDLE}),
    SessionState.IN_GAME: frozenset({SessionState.IDLE}),
}


class IllegalTransitionError(Exception):
    """Raised when a state transition is not permitted by LEGAL_TRANSITIONS."""

    def __init__(self, from_state: SessionState, to_state: SessionState) -> None:
        self.from_state = from_state
        self.to_state = to_state
        super().__init__(f"Illegal session transition: {from_state.value} -> {to_state.value}")


def is_legal_transition(from_state: SessionState, to_state: SessionState) -> bool:
    """Return True if transitioning from_state -> to_state is permitted."""
    return to_state in LEGAL_TRANSITIONS.get(from_state, frozenset())
