"""SessionManager: per-QQ session state with asyncio-based concurrency control.

Each QQ account has exactly one Session. All mutations to a session MUST be
performed while holding that qq's lock via ``async with manager.acquire(qq)``.
The manager lazily creates one ``asyncio.Lock`` per qq; locks are never removed
to keep the implementation simple and avoid races during teardown.

The WSClient type is referenced only for typing (stored on Session.ws); the
real import is deferred via TYPE_CHECKING to break the backend <-> session
circular dependency.
"""

from __future__ import annotations

import asyncio
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import TYPE_CHECKING

from darkforest_bot.session.states import (
    IllegalTransitionError,
    SessionState,
    is_legal_transition,
)

if TYPE_CHECKING:
    from darkforest_bot.backend.client import WSClient


@dataclass(slots=True)
class Session:
    """Mutable per-QQ session state.

    Attributes are intentionally mutable (frozen=False) because the state
    machine transitions, room assignments, and WS handle change over the
    session lifetime. ``slots=True`` keeps memory tight and blocks accidental
    attribute creation.

    The ``ws`` field holds the WSClient handle; its type annotation is a
    string forward reference (via ``from __future__ import annotations``) so
    the real import only happens under TYPE_CHECKING, breaking the
    backend <-> session import cycle.
    """

    qq: int
    player_id: str = ""
    display_name: str = ""
    state: SessionState = SessionState.IDLE
    room_id: str | None = None
    ws: WSClient | None = None


class _QqLockContext(AbstractAsyncContextManager[None]):
    """Async context manager that acquires a specific qq's lock on enter.

    Created by SessionManager.acquire(). Holds a reference to the lock and
    releases it on exit, even if the body raises.
    """

    def __init__(self, lock: asyncio.Lock) -> None:
        self._lock = lock

    async def __aenter__(self) -> None:
        await self._lock.acquire()

    async def __aexit__(self, *_exc_info: object) -> None:
        self._lock.release()


class SessionManager:
    """Owns all per-QQ Session objects and their concurrency locks.

    Concurrency model:
        - One ``asyncio.Lock`` per qq, lazily created on first acquire.
        - All mutating methods (transition, set_player_info, set_ws, clear)
          MUST be called while holding ``async with manager.acquire(qq)``.
        - The manager does NOT re-acquire the lock internally (avoids
          deadlock). Callers are responsible for holding the lock.
        - get() and get_or_create() are safe to call without the lock for
          read-only access, but callers that intend to mutate should acquire
          the lock first.

    The lock-per-qq invariant ensures that two concurrent command handlers
    for the same qq serialize their state mutations.
    """

    def __init__(self) -> None:
        self._sessions: dict[int, Session] = {}
        self._locks: dict[int, asyncio.Lock] = {}

    def _get_lock(self, qq: int) -> asyncio.Lock:
        """Return the lock for ``qq``, creating it on first access."""
        lock = self._locks.get(qq)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[qq] = lock
        return lock

    def acquire(self, qq: int) -> _QqLockContext:
        """Return an async context manager that holds qq's lock.

        Usage::

            async with manager.acquire(qq):
                session = manager.get_or_create(qq)
                manager.transition(qq, SessionState.MATCHMAKING)
        """
        return _QqLockContext(self._get_lock(qq))

    def get(self, qq: int) -> Session | None:
        """Return the session for ``qq`` or None if none exists."""
        return self._sessions.get(qq)

    def get_or_create(self, qq: int) -> Session:
        """Return the session for ``qq``, creating an IDLE one if absent.

        Safe to call without the lock for read access; callers that intend
        to mutate should hold ``acquire(qq)`` first.
        """
        session = self._sessions.get(qq)
        if session is None:
            session = Session(qq=qq)
            self._sessions[qq] = session
        return session

    def transition(
        self,
        qq: int,
        new_state: SessionState,
        *,
        room_id: str | None = None,
    ) -> None:
        """Transition qq's session to ``new_state``.

        Validates the transition against LEGAL_TRANSITIONS and raises
        IllegalTransitionError if disallowed. Optionally records ``room_id``
        when provided (only meaningful for IN_ROOM transitions).

        Caller MUST hold ``acquire(qq)``.
        """
        session = self._sessions.get(qq)
        if session is None:
            # No session yet means IDLE implicitly; only IDLE->MATCHMAKING
            # is legal from IDLE, so create on demand.
            session = self.get_or_create(qq)

        if not is_legal_transition(session.state, new_state):
            raise IllegalTransitionError(session.state, new_state)

        session.state = new_state
        if room_id is not None:
            session.room_id = room_id

    def set_player_info(self, qq: int, player_id: str, display_name: str) -> None:
        """Record backend player_id and display_name on the session.

        Caller MUST hold ``acquire(qq)``.
        """
        session = self.get_or_create(qq)
        session.player_id = player_id
        session.display_name = display_name

    def set_ws(self, qq: int, ws: WSClient | None) -> None:
        """Attach the WSClient handle to the session.

        Caller MUST hold ``acquire(qq)``.
        """
        session = self.get_or_create(qq)
        session.ws = ws

    def clear(self, qq: int) -> None:
        """Reset the session to a clean IDLE state.

        Clears player_id, display_name, room_id, and ws. Used on disconnect
        / reconnect cleanup. Caller MUST hold ``acquire(qq)``.
        """
        session = self.get_or_create(qq)
        session.player_id = ""
        session.display_name = ""
        session.state = SessionState.IDLE
        session.room_id = None
        session.ws = None

    def all_qqs(self) -> list[int]:
        """Return a snapshot list of all known qq ids (for teardown)."""
        return list(self._sessions.keys())
