"""Per-QQ game session cache and event subscription manager.

A ``GameSessionStore`` owns one ``GameSession`` per QQ id. Each session
subscribes to ``game:fullSync`` / ``game:deltaSync`` / ``game:error`` on
the player's ``WSClient`` and maintains a typed ``ViewState`` cache.

Lifecycle::

    store = GameSessionStore()
    await store.start(
        qq=12345,
        ws=ws_client,
        push_callback=push_cb,
        on_game_over=over_cb,
        font_path="...",
        canvas_size=900,
    )
    # ... backend pushes game:fullSync / game:deltaSync ...
    await store.stop(qq)        # unsubscribe + clear cache
    await store.stop_all()      # stop every active session (process exit)

Push policy (P3 + P4):
- Auto-push on turn change (``turn_key`` changes: ``f"{total_turn}:{current_player_id}"``).
- Auto-push on game over (``winner`` becomes non-None).
- Auto-push on PendingAction change (``push_key`` changes) — only when the
  pending action belongs to the local player's own turn
  (``current_player_id == local_player_id``). Other players' pending
  actions do not push to this player.
- Auto-push on broadcast response needed (``push_key == "broadcast_response"``)
  — when ``broadcast.responses`` contains an entry for the local player
  with ``must_respond=True`` and ``responded=False``.
- Same-turn, same-pending deltas do NOT auto-push (avoids spamming the player
  mid-action).
- The player can always request the latest state with ``.state``.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from loguru import logger

from darkforest_bot.backend.delta import (
    Change,
    DeltaApplyError,
    apply_changes,
)
from darkforest_bot.backend.protocol import ClientEvent, ServerEvent
from darkforest_bot.backend.view_state import ViewState

if TYPE_CHECKING:
    from darkforest_bot.backend.client import WSClient

# Pushed to the bot when a turn changes or the game ends. The bot renders
# the ViewState to PNG + text and sends it via OneBot send_private_msg.
PushCallback = Callable[[int, ViewState], Awaitable[None]]

# Fired once when the game ends (winner is set). The bot transitions the
# session back to IDLE. Distinct from PushCallback so the bot can run
# session-state cleanup independent of image rendering.
OnGameOverCallback = Callable[[int], Awaitable[None]]


@dataclass(slots=True)
class GameSession:
    """Per-QQ game state cache and subscription lifecycle.

    Attributes:
        view_state: Latest typed ViewState cache, or None if no fullSync
            has been received yet (or the session has been stopped).
        last_turn_key: Last pushed turn key (``f"{total_turn}:{current_player_id}"``).
            Used to detect turn changes that should trigger a new push.
            Empty string means "no push yet sent".
        last_push_key: Last pushed pending/broadcast key (computed by
            ``GameSessionStore._compute_push_key``). Used to detect
            PendingAction or broadcast-response changes that should trigger
            a new push. Empty string means "no pending/broadcast push yet".
        unsubs: Unsubscribe callables returned by ``WSClient.subscribe``.
            Called in ``stop()`` to detach handlers from the WSClient.
        _lock: Per-session asyncio lock serializing cache mutations.
    """

    view_state: ViewState | None = None
    last_turn_key: str = ""
    last_push_key: str = ""
    unsubs: list[Callable[[], None]] = field(default_factory=list)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class GameSessionStore:
    """Owns one ``GameSession`` per QQ id. Singleton-scoped (one per process)."""

    def __init__(self) -> None:
        self._sessions: dict[int, GameSession] = {}
        self._logger = logger.bind(component="GameSessionStore")

    # ------------------------------------------------------------------
    # Lookup
    # ------------------------------------------------------------------

    def get(self, qq: int) -> GameSession | None:
        """Return the session for ``qq`` if it exists, else None."""
        return self._sessions.get(qq)

    def get_or_create(self, qq: int) -> GameSession:
        """Return the session for ``qq``, creating an empty one if missing."""
        sess = self._sessions.get(qq)
        if sess is None:
            sess = GameSession()
            self._sessions[qq] = sess
        return sess

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(
        self,
        qq: int,
        ws: WSClient,
        *,
        push_callback: PushCallback,
        on_game_over: OnGameOverCallback,
        font_path: str,
        canvas_size: int,
    ) -> None:
        """Create (or reset) a session for ``qq`` and subscribe to game events.

        Stores the unsubscribe callables inside the session so ``stop()`` can
        detach all handlers cleanly. If a session already exists for ``qq``,
        its existing subscriptions are stopped first (defensive — caller
        should normally call ``stop()`` before re-``start()``).

        Args:
            qq: Player's QQ id.
            ws: The player's connected WSClient.
            push_callback: Called with (qq, view_state) on turn change or
                game over. The callback is expected to close over its own
                render settings (font_path, canvas_size) at the call site
                (see ``commands/match.py`` push_cb construction).
            on_game_over: Called with qq once when winner becomes non-None.
            font_path: Reserved for future use. Currently only logged.
            canvas_size: Reserved for future use. Currently only logged.
        """
        # If a session exists, stop it first to drop old subscriptions.
        if qq in self._sessions:
            await self.stop(qq)

        session = self.get_or_create(qq)
        log = self._logger.bind(qq=qq)

        # Build handlers as closures bound to this qq + session.
        async def on_full_sync(payload: dict[str, Any]) -> None:
            await self._handle_full_sync(
                qq, session, ws, payload, push_callback, on_game_over
            )

        async def on_delta_sync(payload: dict[str, Any]) -> None:
            await self._handle_delta_sync(
                qq, session, ws, payload, push_callback, on_game_over
            )

        async def on_game_error(payload: dict[str, Any]) -> None:
            log.warning("game:error from backend", payload=payload)

        # Subscribe and retain the unsubscribe callables.
        session.unsubs.append(ws.subscribe(ServerEvent.GAME_FULL_SYNC, on_full_sync))
        session.unsubs.append(ws.subscribe(ServerEvent.GAME_DELTA_SYNC, on_delta_sync))
        session.unsubs.append(ws.subscribe(ServerEvent.GAME_ERROR, on_game_error))

        log.info(
            "GameSession started",
            font_path=font_path,
            canvas_size=canvas_size,
            subscriptions=len(session.unsubs),
        )

    async def stop(self, qq: int) -> None:
        """Stop the session for ``qq``: unsubscribe handlers, clear cache.

        Safe to call on a non-existent session (no-op).
        """
        session = self._sessions.pop(qq, None)
        if session is None:
            return
        log = self._logger.bind(qq=qq)

        # Unsubscribe every handler (best-effort — ignore errors).
        for unsub in session.unsubs:
            try:
                unsub()
            except Exception:  # noqa: BLE001
                log.exception("unsubscribe callback raised (ignored)")
        session.unsubs.clear()

        async with session._lock:
            session.view_state = None
            session.last_turn_key = ""
            session.last_push_key = ""

        log.info("GameSession stopped")

    async def stop_all(self) -> None:
        """Stop every active session. Used at process exit."""
        qqs = list(self._sessions.keys())
        for qq in qqs:
            await self.stop(qq)

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    async def _handle_full_sync(
        self,
        qq: int,
        session: GameSession,
        ws: WSClient,
        payload: dict[str, Any],
        push_callback: PushCallback,
        on_game_over: OnGameOverCallback,
    ) -> None:
        """Parse fullSync payload, replace cache, fire push/game-over hooks."""
        log = self._logger.bind(qq=qq)
        # payload shape: {"state": {...ViewState...}, "version": int, ...}
        state_data = payload.get("state")
        if not isinstance(state_data, dict):
            log.warning(
                "fullSync payload missing 'state' dict; ignored",
                payload_keys=list(payload.keys()),
            )
            return

        try:
            vs = ViewState.model_validate(state_data)
        except Exception:  # noqa: BLE001
            log.exception(
                "fullSync ViewState.model_validate failed; cache not updated. "
                "Payload head: {}",
                str(state_data)[:500],
            )
            return

        async with session._lock:
            session.view_state = vs

        await self._on_state_update(qq, session, vs, push_callback, on_game_over)

    async def _handle_delta_sync(
        self,
        qq: int,
        session: GameSession,
        ws: WSClient,
        payload: dict[str, Any],
        push_callback: PushCallback,
        on_game_over: OnGameOverCallback,
    ) -> None:
        """Apply deltaSync changes to the cache; fallback to requestSync on error."""
        log = self._logger.bind(qq=qq)
        # payload shape: {"changes": [...Change...], "version": int, ...}
        changes_raw = payload.get("changes")
        if not isinstance(changes_raw, list):
            log.warning(
                "deltaSync payload missing 'changes' list; ignored",
                payload_keys=list(payload.keys()),
            )
            return

        # Parse changes with the Change model (validates path/type/value).
        try:
            changes = [Change.model_validate(c) for c in changes_raw]
        except Exception:  # noqa: BLE001
            log.exception(
                "deltaSync Change.model_validate failed; requesting fullSync"
            )
            await self._safe_send(ws, ClientEvent.GAME_REQUEST_SYNC)
            return

        # Apply changes under the lock, but do NOT do I/O inside the lock.
        # We collect a "post-lock action" enum to execute after releasing.
        # Possible outcomes:
        #   - "request_sync": cache missing or apply failed → request fullSync
        #   - "updated": cache updated successfully → run _on_state_update
        #   - "no_op": nothing to do (defensive; not currently produced)
        post_action: str
        new_vs: ViewState | None = None

        async with session._lock:
            if session.view_state is None:
                log.warning("deltaSync received before fullSync; requesting fullSync")
                post_action = "request_sync"
            else:
                # Dump to dict by alias so Change.path segments (camelCase)
                # match the dict keys.
                data = session.view_state.model_dump(by_alias=True)
                try:
                    apply_changes(data, changes)
                except DeltaApplyError as exc:
                    log.warning(
                        "deltaSync apply failed ({}); requesting fullSync", exc
                    )
                    post_action = "request_sync"
                else:
                    # Re-validate the mutated dict back into a typed ViewState.
                    try:
                        new_vs = ViewState.model_validate(data)
                    except Exception:  # noqa: BLE001
                        log.exception(
                            "deltaSync re-validation failed after apply; "
                            "cache not updated, requesting fullSync"
                        )
                        post_action = "request_sync"
                    else:
                        session.view_state = new_vs
                        post_action = "updated"

        # Now do I/O outside the lock.
        if post_action == "request_sync":
            await self._safe_send(ws, ClientEvent.GAME_REQUEST_SYNC)
            return

        if post_action == "updated" and new_vs is not None:
            await self._on_state_update(qq, session, new_vs, push_callback, on_game_over)

    async def _on_state_update(
        self,
        qq: int,
        session: GameSession,
        vs: ViewState,
        push_callback: PushCallback,
        on_game_over: OnGameOverCallback,
    ) -> None:
        """Compute turn_key + push_key, push if either changed, fire on_game_over.

        Push triggers when any of:
        - ``vs.winner`` is set (game over)
        - ``turn_key`` (``total_turn:current_player_id``) changed since last push
        - ``push_key`` (pending-action or broadcast-response signature) changed
          since last push
        """
        log = self._logger.bind(qq=qq)
        turn_key = f"{vs.total_turn}:{vs.current_player_id}"
        push_key = self._compute_push_key(vs)

        async with session._lock:
            prev_turn_key = session.last_turn_key
            prev_push_key = session.last_push_key
            # Update keys only when we actually push (avoids skipping the
            # next push if this one failed).
            should_push = (
                vs.winner is not None
                or turn_key != prev_turn_key
                or push_key != prev_push_key
            )
            if should_push:
                session.last_turn_key = turn_key
                session.last_push_key = push_key

        if should_push:
            try:
                await push_callback(qq, vs)
            except Exception:  # noqa: BLE001
                log.exception("push_callback raised (ignored)")

        if vs.winner is not None:
            # Stop the session (drops subscriptions + clears cache) before
            # firing on_game_over so the bot can safely transition the
            # session manager state.
            await self.stop(qq)
            try:
                await on_game_over(qq)
            except Exception:  # noqa: BLE001
                log.exception("on_game_over raised (ignored)")

    @staticmethod
    def _compute_push_key(vs: ViewState) -> str:
        """Compute a push-key string summarizing pending-action / broadcast state.

        Returns a non-empty string when the local player has something to act
        on, so that changes in this state trigger a new push. Returns ``""``
        when there is nothing to push (no pending action on the local player's
        own turn, no broadcast response required of the local player).

        Rules:
        - If ``vs.pending_action`` is set AND ``current_player_id ==
          local_player_id`` (the local player's own turn): return
          ``f"pending:{type}:{strike_uid}:{card_uid}:{target_system}"``.
          Other players' pending actions return ``""`` (don't push someone
          else's pending to this player).
        - Else if ``vs.broadcast`` is set: scan ``broadcast.responses`` for
          the local player with ``must_respond=True`` and ``responded=False``;
          return ``"broadcast_response"`` if found, else ``""``.
        - Else return ``""``.
        """
        pa = vs.pending_action
        if pa is not None:
            if vs.current_player_id != vs.local_player_id:
                return ""
            return (
                f"pending:{pa.type}:{pa.strike_uid}:{pa.card_uid}:"
                f"{pa.target_system}"
            )
        broadcast = vs.broadcast
        if broadcast is not None:
            for r in broadcast.responses:
                if (
                    r.player_id == vs.local_player_id
                    and r.must_respond
                    and not r.responded
                ):
                    return "broadcast_response"
        return ""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _safe_send(self, ws: WSClient, event: ClientEvent) -> None:
        """Send an event on ws, swallowing errors (caller already holds lock)."""
        try:
            await ws.send(event)
        except Exception:  # noqa: BLE001
            self._logger.exception(
                "ws.send({}) failed (ignored)", event.value
            )
