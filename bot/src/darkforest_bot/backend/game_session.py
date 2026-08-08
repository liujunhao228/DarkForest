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
        notify_config_provider=provider,
        font_path="...",
        canvas_size=900,
    )
    # ... backend pushes game:fullSync / game:deltaSync ...
    await store.stop(qq)        # unsubscribe + clear cache
    await store.stop_all()      # stop every active session (process exit)

Push policy (事件类别 + 分类开关):
- 把旧的「turn_key + push_key 单一字符串联合去重」重构为「事件类别识别 +
  分类开关」。每次状态更新先用 ``classify(old, new)`` 得到本次更新的事件类别
  集合，再按 ``NotifyConfig`` 开关决定是否推送。
- 硬推类别（TURN_CHANGE / GAME_OVER / PENDING_ACTION）不可关闭：
    - 回合变化（``total_turn:current_player_id`` 变化）→ 必推。
    - 游戏结束（``winner`` 变为非 None）→ 必推 + ``on_game_over``。
    - 本地玩家自己的 pending 变化 → 必推。
- 可开关类别（BROADCAST / STRIKE / OTHER）按 ``NotifyConfig`` 各自开关决定，
  并用 ``last_event_keys[EventCategory]`` 做去重（同一事件键不重复推）。
- 每一类别维护独立的去重键，因此别人回合里发生的可见事件（broadcast /
  strike）不再被 turn_key 的「不变化」误判为无需推送——这是本重构的核心修复。
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
from darkforest_bot.backend.event_classifier import EventCategory, classify
from darkforest_bot.backend.protocol import ClientEvent, ServerEvent
from darkforest_bot.backend.view_state import ViewState
from darkforest_bot.notifications.notify_config import NotifyConfig

if TYPE_CHECKING:
    from darkforest_bot.backend.client import WSClient

# Pushed to the bot when a push-worthy state change is detected. The bot
# renders the ViewState to PNG + text and sends it via OneBot send_private_msg.
PushCallback = Callable[[int, ViewState], Awaitable[None]]

# Pushed to the group when a game settles. The bot renders the final starmap
# PNG + settlement text and sends it via OneBot send_group_msg. Signature
# (group_id, view_state). Default None in start() disables group push for
# private-chat matches.
SettleCallback = Callable[[int, ViewState], Awaitable[None]]

# Fired once when the game ends (winner is set). The bot transitions the
# session back to IDLE. Distinct from PushCallback so the bot can run
# session-state cleanup independent of image rendering.
OnGameOverCallback = Callable[[int], Awaitable[None]]

# Returns the current push config for a QQ id.
NotifyConfigProvider = Callable[[int], NotifyConfig]


@dataclass(slots=True)
class GameSession:
    """Per-QQ game state cache and subscription lifecycle.

    Attributes:
        view_state: Latest typed ViewState cache, or None if no fullSync
            has been received yet (or the session has been stopped).
        last_event_keys: 各事件类别最近一次已推送（去重）的键。
            ``_should_push`` 用它对每个类别独立判重：仅当类别出现且新键不同
            才推送，从而能在别人回合里推送可见事件。
        notify_config_provider: 该 session 用于查询每 QQ 的 NotifyConfig。
        unsubs: Unsubscribe callables returned by ``WSClient.subscribe``.
            Called in ``stop()`` to detach handlers from the WSClient.
        _lock: Per-session asyncio lock serializing cache mutations.
    """

    view_state: ViewState | None = None
    group_id: int | None = None
    last_event_keys: dict[EventCategory, str] = field(default_factory=dict)
    notify_config_provider: NotifyConfigProvider | None = None
    unsubs: list[Callable[[], None]] = field(default_factory=list)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class GameSessionStore:
    """Owns one ``GameSession`` per QQ id. Singleton-scoped (one per process)."""

    def __init__(self) -> None:
        self._sessions: dict[int, GameSession] = {}
        # 已结算的对局回放 ID 去重集合：同一局仅推送一次结算消息。
        self._settled_replay_ids: set[str] = set()
        self._settle_lock = asyncio.Lock()
        # 每 QQ 最近一场已结算对局的回放 ID（.analyse 无参数时使用）。
        self._last_replay_ids: dict[int, str] = {}
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

    def record_replay_settled(self, qq: int, replay_id: str) -> None:
        """记录 ``qq`` 最近一场已结算对局的回放 ID（.analyse 无参数时使用）。

        对局终局（gameOver / winner 已设）时由 ``_on_state_update`` 调用；
        测试也可直接调用构造"有最近对局"场景。
        """
        self._last_replay_ids[qq] = replay_id

    def last_replay_id(self, qq: int) -> str | None:
        """返回 ``qq`` 最近一场已结算对局的回放 ID；无记录返回 None。"""
        return self._last_replay_ids.get(qq)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(
        self,
        qq: int,
        ws: WSClient,
        *,
        group_id: int | None = None,
        push_callback: PushCallback,
        on_game_over: OnGameOverCallback,
        notify_config_provider: NotifyConfigProvider,
        font_path: str,
        canvas_size: int,
        push_settlement: SettleCallback | None = None,
    ) -> None:
        """Create (or reset) a session for ``qq`` and subscribe to game events.

        Stores the unsubscribe callables inside the session so ``stop()`` can
        detach all handlers cleanly. If a session already exists for ``qq``,
        its existing subscriptions are stopped first (defensive — caller
        should normally call ``stop()`` before re-``start()``).

        Args:
            qq: Player's QQ id.
            ws: The player's connected WSClient.
            group_id: 发起匹配的群聊 ID；None 表示私聊（不推送群结算消息）。
            push_callback: Called with (qq, view_state) when a push-worthy
                event occurs. The callback is expected to close over its own
                render settings (font_path, canvas_size) at the call site.
            on_game_over: Called with qq once when winner becomes non-None.
            notify_config_provider: Returns the NotifyConfig for a given qq,
                used to decide which toggleable event categories push.
            font_path: Reserved for future use. Currently only logged.
            canvas_size: Reserved for future use. Currently only logged.
            push_settlement: 对局结算时往群聊推送结算消息的回调；None 时跳过。
        """
        # If a session exists, stop it first to drop old subscriptions.
        if qq in self._sessions:
            await self.stop(qq)

        session = self.get_or_create(qq)
        log = self._logger.bind(qq=qq)
        session.notify_config_provider = notify_config_provider
        session.group_id = group_id

        # Build handlers as closures bound to this qq + session.
        async def on_full_sync(payload: dict[str, Any]) -> None:
            await self._handle_full_sync(
                qq, session, ws, payload, push_callback, on_game_over,
                push_settlement,
            )

        async def on_delta_sync(payload: dict[str, Any]) -> None:
            await self._handle_delta_sync(
                qq, session, ws, payload, push_callback, on_game_over,
                push_settlement,
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
            session.last_event_keys.clear()
            session.notify_config_provider = None
            session.group_id = None

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
        push_settlement: SettleCallback | None = None,
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
            old_vs = session.view_state
            session.view_state = vs

        if old_vs is None:
            # 首次 fullSync：session.view_state 此前为空。old_vs=None →
            # classify 返回全部类别，强制全推一次。但需用真实旧状态对比时，
            # 传入 None 表示首推。
            pass
        await self._on_state_update(
            qq, session, old_vs, vs, push_callback, on_game_over, push_settlement
        )

    async def _handle_delta_sync(
        self,
        qq: int,
        session: GameSession,
        ws: WSClient,
        payload: dict[str, Any],
        push_callback: PushCallback,
        on_game_over: OnGameOverCallback,
        push_settlement: SettleCallback | None = None,
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
        # Possible outcomes:
        #   - "request_sync": cache missing or apply failed → request fullSync
        #   - "updated": cache updated successfully → run _on_state_update
        #   - "no_op": nothing to do (defensive; not currently produced)
        post_action: str
        old_vs: ViewState | None = None
        new_vs: ViewState | None = None

        async with session._lock:
            if session.view_state is None:
                log.warning("deltaSync received before fullSync; requesting fullSync")
                post_action = "request_sync"
            else:
                old_vs = session.view_state
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
            await self._on_state_update(
                qq, session, old_vs, new_vs, push_callback, on_game_over,
                push_settlement,
            )

    async def _on_state_update(
        self,
        qq: int,
        session: GameSession,
        old_vs: ViewState | None,
        vs: ViewState,
        push_callback: PushCallback,
        on_game_over: OnGameOverCallback,
        push_settlement: SettleCallback | None = None,
    ) -> None:
        """Classify the update, apply per-category push policy, fire on_game_over.

        Logic:
            1. ``classify(old_vs, vs)`` → 本次更新的事件类别集合。
            2. ``_should_push(...)`` 按 NotifyConfig 开关 + 各类别去重键决定
               是否推送。
            3. 若推送，先更新 ``last_event_keys``，再调 ``push_callback``。
            4. 若 ``vs.winner`` 已设，停掉 session 并触发 ``on_game_over``。
        """
        log = self._logger.bind(qq=qq)
        events = classify(old_vs, vs)
        provider = session.notify_config_provider
        cfg = provider(qq) if provider is not None else NotifyConfig.default()

        async with session._lock:
            should_push = self._should_push(events, cfg, session.last_event_keys, vs)
            if should_push:
                new_keys = self._compute_event_keys(vs, events)
                session.last_event_keys.update(new_keys)

        if should_push:
            try:
                await push_callback(qq, vs)
            except Exception:  # noqa: BLE001
                log.exception("push_callback raised (ignored)")

        # 记录该 QQ 最近结算的对局回放 ID（.analyse 无参数时使用）。即使
        # 之后 stop(qq) 清空 session，store 级记录仍保留，供复盘分析引用。
        if vs.replay_id is not None and (
            vs.phase == "gameOver" or vs.winner is not None
        ):
            self.record_replay_settled(qq, vs.replay_id)

        # 群聊结算推送：仅群发起对局且未推送过该回放 ID 时推送一次。
        if (
            vs.phase == "gameOver"
            and vs.replay_id is not None
            and session.group_id is not None
            and push_settlement is not None
        ):
            async with self._settle_lock:
                if vs.replay_id in self._settled_replay_ids:
                    already_settled = True
                else:
                    already_settled = False
                    self._settled_replay_ids.add(vs.replay_id)
            if not already_settled:
                try:
                    await push_settlement(session.group_id, vs)
                except Exception:  # noqa: BLE001
                    log.exception("push_settlement raised (ignored)")

        if vs.winner is not None:
            # Stop the session (drops subscriptions + clears cache) before
            # firing on_game_over so the bot can safely transition the
            # session manager state.
            await self.stop(qq)
            try:
                await on_game_over(qq)
            except Exception:  # noqa: BLE001
                log.exception("on_game_over raised (ignored)")

    # ------------------------------------------------------------------
    # Push policy helpers
    # ------------------------------------------------------------------

    def _should_push(
        self,
        events: set[EventCategory],
        cfg: NotifyConfig,
        last_keys: dict[EventCategory, str],
        vs: ViewState,
    ) -> bool:
        """Decide whether this update should trigger a push.

        硬推类别（turn_change / game_over / pending_action）不可关闭。可关闭
        类别（broadcast / strike / other）按各自开关 + 去重键判断。
        """
        if EventCategory.TURN_CHANGE in events:
            return True
        if EventCategory.GAME_OVER in events:
            return True
        if EventCategory.PENDING_ACTION in events:
            return True
        if EventCategory.BROADCAST in events and cfg.broadcast:
            if self._broadcast_key(vs) != last_keys.get(EventCategory.BROADCAST):
                return True
        if EventCategory.STRIKE in events and cfg.strike:
            if self._strike_key(vs) != last_keys.get(EventCategory.STRIKE):
                return True
        if EventCategory.OTHER in events and cfg.other:
            if self._other_key(vs) != last_keys.get(EventCategory.OTHER):
                return True
        return False

    def _compute_event_keys(
        self, vs: ViewState, events: set[EventCategory]
    ) -> dict[EventCategory, str]:
        """Compute the per-category deduplication keys present in ``events``."""
        keys: dict[EventCategory, str] = {}
        if EventCategory.TURN_CHANGE in events:
            keys[EventCategory.TURN_CHANGE] = f"{vs.total_turn}:{vs.current_player_id}"
        if EventCategory.GAME_OVER in events:
            keys[EventCategory.GAME_OVER] = f"winner:{vs.winner}"
        if EventCategory.PENDING_ACTION in events:
            pa = vs.pending_action
            if pa is None:
                keys[EventCategory.PENDING_ACTION] = "none"
            else:
                keys[EventCategory.PENDING_ACTION] = (
                    f"pending:{pa.type}:{pa.strike_uid}:{pa.card_uid}:{pa.target_system}"
                )
        if EventCategory.BROADCAST in events:
            keys[EventCategory.BROADCAST] = self._broadcast_key(vs)
        if EventCategory.STRIKE in events:
            keys[EventCategory.STRIKE] = self._strike_key(vs)
        if EventCategory.OTHER in events:
            keys[EventCategory.OTHER] = self._other_key(vs)
        return keys

    @staticmethod
    def _broadcast_key(vs: ViewState) -> str:
        """Broadcast 类别去重键。若无广播返回 "none"，否则含本地卷入/已回应位。"""
        broadcast = vs.broadcast
        if broadcast is None:
            return "none"
        local = vs.local_player_id
        local_involved = any(
            r.player_id == local for r in broadcast.responses
        ) or broadcast.broadcaster_id == local
        local_responded = any(
            r.player_id == local and r.responded for r in broadcast.responses
        )
        return f"{broadcast.phase}:{broadcast.card_uid}:{local_responded}:{local_involved}"

    @staticmethod
    def _strike_key(vs: ViewState) -> str:
        """Strike 类别去重键：飞击 / 已毁灭恒星 / 恒星效果汇总。

        飞击键包含 uid + remaining_moves + arrived + delayed，使「移动 / 抵达 /
        被延时」等状态变化也能触发推送（而不仅是增删）。
        """
        strike_detail = sorted(
            (s.uid, s.remaining_moves, s.arrived, s.delayed) for s in vs.flying_strikes
        )
        return (
            f"{len(vs.flying_strikes)}:"
            f"{strike_detail}:"
            f"{sorted(vs.destroyed_stars)}:"
            f"{sorted((e.system_id, e.type) for e in vs.star_effects)}"
        )

    @staticmethod
    def _other_key(vs: ViewState) -> str:
        """Other 类别去重键：粗粒度（version + is_processing），避免每次都推。"""
        return f"v{vs.version or 0}:proc{int(vs.is_processing)}"

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
