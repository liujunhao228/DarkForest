"""Pydantic mirror of backend ViewState and sub-structures.

权威源（authoritative source）:
    e:\\DarkForest\\backend\\internal\\game\\view_state.go
    e:\\DarkForest\\backend\\internal\\game\\types.go

When backend view_state.go or types.go change field names/JSON tags, update
this file in lockstep. ``extra="forbid"`` on every model (except ModeRules)
ensures backend/bot drift is caught at parse time rather than silently dropped.

ModeRules is intentionally permissive (``extra="allow"``) because the bot never
reads its fields — it only forwards the opaque blob through to the renderer,
which also ignores it. This avoids breaking fullSync parsing whenever backend
adds a new ModeRules field the bot does not care about.

``Any`` does not appear in this module's public signatures; the JSON-boundary
``Any`` lives in protocol.py (payload) and delta.py (Change.value).
"""

from __future__ import annotations

from typing import Annotated, TypeVar

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from darkforest_bot.backend.protocol import _StrictModel


def _coerce_none_to_list(v: object) -> object:
    """Coerce JSON ``null`` to empty list (Go nil-slice compatibility).

    Go slices without ``omitempty`` serialize a nil slice as ``null`` rather
    than ``[]``. Several backend ViewState / PlayerView / BroadcastStateView /
    MapLayoutSnapshot list fields lack ``omitempty``, so the bot must accept
    ``null`` and treat it as an empty list. Applied via ``BeforeValidator`` so
    the parsed field is always a proper list downstream.
    """
    return [] if v is None else v


_T = TypeVar("_T")

# Reusable annotated list type: accepts JSON null, defaults handled by Field.
# NullableList[StarNode] → Annotated[list[StarNode], BeforeValidator(...)].
NullableList = Annotated[list[_T], BeforeValidator(_coerce_none_to_list)]


class _PermissiveModel(BaseModel):
    """Base for opaque forward-only models: allow extras, freeze, honor aliases.

    Used by ModeRules — the bot treats it as an opaque blob and never reads
    individual fields, so permissive extra handling is correct here.
    """

    model_config = ConfigDict(extra="allow", frozen=True, populate_by_name=True)


class StarNode(_StrictModel):
    """A star system node in the map layout. Mirrors backend game.StarNode."""

    id: int
    x: float
    y: float
    name: str
    size: str  # "sm" | "md" | "lg"
    tint: str  # hex color, e.g. "#6366f1"


class StarEdge(_StrictModel):
    """An edge between two star systems. Mirrors backend game.StarEdge."""

    from_: int = Field(alias="from")
    to: int


class MapLayoutSnapshot(_StrictModel):
    """Serializable map layout (nodes + edges only). Mirrors backend MapLayoutSnapshot."""

    nodes: NullableList[StarNode] = Field(default_factory=list)
    edges: NullableList[StarEdge] = Field(default_factory=list)


class Card(_StrictModel):
    """A card instance. Mirrors backend game.Card.

    Optional fields (range/level/speed/effect/...) are None unless the card
    type populates them (e.g. strike cards have level/speed, broadcast cards
    have range/subtype).
    """

    uid: str
    def_id: str = Field(alias="defId")
    name: str
    type: str  # "broadcast" | "strike" | "defense" | "facility"
    energy: int
    description: str
    image: str
    subtype: str | None = None
    # ``range`` shadows Python builtin range → use range_ with alias.
    range_: int | None = Field(default=None, alias="range")
    level: int | None = None
    speed: int | None = None
    effect: str | None = None
    protection_level: int | None = Field(default=None, alias="protectionLevel")
    energy_per_turn: int | None = Field(default=None, alias="energyPerTurn")
    ability: str | None = None


class PlayerView(_StrictModel):
    """Desensitized player view. Mirrors backend game.PlayerView.

    Opponents' ``position`` is -1 (hidden in stealth mode); only the local
    player (or REPLAY role) sees real positions. ``hand`` is populated only
    for the local player; opponents have an empty list.
    """

    id: str
    name: str
    color: str  # "red" | "blue" | "green" | "amber" | "purple"
    position: int  # -1 when hidden
    energy: int
    hand_count: int = Field(alias="handCount")
    hand: list[Card] = Field(default_factory=list)
    face_up_cards: NullableList[Card] = Field(default_factory=list, alias="faceUpCards")
    eliminated: bool
    # 玩家被淘汰时的回合数（0 = 未淘汰）；用于结算排行榜按淘汰顺序排序。
    # 镜像 backend PlayerView.EliminatedTurn。
    eliminated_turn: int = Field(default=0, alias="eliminatedTurn")
    broadcast_history: NullableList[dict[str, int]] = Field(
        default_factory=list, alias="broadcastHistory"
    )
    penalty_turn: bool = Field(default=False, alias="penaltyTurn")
    destroyed_star_count: int = Field(default=0, alias="destroyedStarCount")
    strike_count: int = Field(default=0, alias="strikeCount")
    broadcast_success_count: int = Field(default=0, alias="broadcastSuccessCount")


class FlyingStrikeView(_StrictModel):
    """Desensitized flying strike view. Mirrors backend game.FlyingStrikeView.

    In stealth-strike mode, non-owner viewers see position=-1 and a ``distance``
    hint instead of the real position.
    """

    uid: str
    def_id: str = Field(alias="defId")
    owner_id: str = Field(alias="ownerId")
    position: int
    target_system: int = Field(alias="targetSystem")
    level: int
    speed: int
    remaining_moves: int = Field(alias="remainingMoves")
    effect: str | None = None
    strike_name: str = Field(alias="strikeName")
    arrived: bool
    delayed: bool
    distance: int | None = None


class BroadcastResponseView(_StrictModel):
    """One responder's view of a broadcast response. Mirrors backend BroadcastResponseView."""

    player_id: str = Field(alias="playerId")
    player_name: str = Field(alias="playerName")
    can_respond: bool = Field(alias="canRespond")
    must_respond: bool = Field(alias="mustRespond")
    responded: bool
    agreed: bool
    response_card: Card | None = Field(default=None, alias="responseCard")


class BroadcastStateView(_StrictModel):
    """Desensitized broadcast state. Mirrors backend BroadcastStateView.

    Card/subtype/responseCard visibility is gated by reveal phase and
    broadcaster/responder identity (see backend filterBroadcastForView).
    """

    broadcaster_id: str = Field(alias="broadcasterId")
    card_uid: str = Field(alias="cardUid")
    card: Card | None = None
    target_system: int = Field(alias="targetSystem")
    range_: int = Field(alias="range")
    subtype: str | None = None
    responses: NullableList[BroadcastResponseView] = Field(default_factory=list)
    phase: str  # "waiting" | "select" | "reveal"
    selected_responder_id: str | None = Field(default=None, alias="selectedResponderId")
    response_card: Card | None = Field(default=None, alias="responseCard")


class LogEntry(_StrictModel):
    """A game log entry. Mirrors backend game.LogEntry.

    system_id/message may be redacted for non-position-owner viewers
    (see backend redactPositionInMessage).
    """

    id: str
    turn: int
    phase: str
    message: str
    type: str  # "info" | "action" | "combat" | "system" | "broadcast"
    strike_uid: str | None = Field(default=None, alias="strikeUid")
    system_id: int | None = Field(default=None, alias="systemId")
    card_def_id: str | None = Field(default=None, alias="cardDefId")
    player_ids: list[str] = Field(default_factory=list, alias="playerIds")
    broadcast_id: str | None = Field(default=None, alias="broadcastId")
    position_owner_id: str | None = Field(default=None, alias="positionOwnerId")


class StarEffect(_StrictModel):
    """A persistent star-system effect. Mirrors backend game.StarEffect."""

    system_id: int = Field(alias="systemId")
    type: str  # "annihilationStun" | "dimensionalLock"
    applied_at_turn: int = Field(alias="appliedAtTurn")
    duration: int  # -1 = permanent
    source_strike_uid: str | None = Field(default=None, alias="sourceStrikeUid")


class PendingAction(_StrictModel):
    """A pending action requiring player input. Mirrors backend game.PendingAction."""

    type: str
    strike_uid: str = Field(default="", alias="strikeUid")
    strike_uids: list[str] = Field(default_factory=list, alias="strikeUids")
    valid_moves: list[int] = Field(default_factory=list, alias="validMoves")
    responders: list[str] = Field(default_factory=list)
    target_system: int = Field(default=0, alias="targetSystem")
    target_player_ids: list[str] = Field(default_factory=list, alias="targetPlayerIds")
    player_id: str = Field(default="", alias="playerId")
    card_uid: str = Field(default="", alias="cardUid")
    valid_targets: list[int] = Field(default_factory=list, alias="validTargets")
    refund_energy: int = Field(default=0, alias="refundEnergy")
    broadcast_on_inherit: bool | None = Field(default=None, alias="broadcastOnInherit")


class ViewMeta(_StrictModel):
    """View metadata. Mirrors backend game.ViewMeta."""

    role: str  # "PLAYER" | "SPECTATOR" | "REPLAY"
    viewer_id: str = Field(default="", alias="viewerId")
    timestamp: int


class RelicDiscovery(_StrictModel):
    """Private relic/leftover reveal. Mirrors backend game.RelicDiscovery.

    Only populated when viewerID == state.LastRelicDiscovery.PlayerID.
    """

    player_id: str = Field(default="", alias="playerId")
    system_id: int = Field(alias="systemId")
    is_relic: bool = Field(default=False, alias="isRelic")
    name: str = Field(default="", alias="name")
    lore: str = Field(default="", alias="lore")
    message: str = Field(default="", alias="message")
    energy: int
    facility_names: list[str] = Field(default_factory=list, alias="facilityNames")


class ModeRules(_PermissiveModel):
    """Opaque mode-rules blob. Mirrors backend game.ModeRules.

    Permissive (extra=allow) on purpose: the bot never reads ModeRules fields,
    only forwards the blob. This avoids breaking fullSync parsing when backend
    adds new rule fields. See module docstring for rationale.
    """


class ViewState(_StrictModel):
    """Desensitized game state view. Mirrors backend game.ViewState.

    This is the authoritative type for the bot's local cache and the renderers.
    Note: does NOT contain DrawPile/DiscardPile (sensitive, never sent).
    """

    phase: str  # "setup" | "playing" | "gameOver"
    game_mode: str = Field(default="", alias="gameMode")
    mode_rules: ModeRules | None = Field(default=None, alias="modeRules")
    total_turn: int = Field(alias="totalTurn")
    player_count: int = Field(alias="playerCount")
    players: NullableList[PlayerView] = Field(default_factory=list)
    current_player_index: int = Field(alias="currentPlayerIndex")
    current_player_id: str = Field(alias="currentPlayerId")
    local_player_id: str = Field(alias="localPlayerId")
    flying_strikes: NullableList[FlyingStrikeView] = Field(
        default_factory=list, alias="flyingStrikes"
    )
    broadcast: BroadcastStateView | None = None
    turn_phase: str = Field(alias="turnPhase")
    pending_action: PendingAction | None = Field(default=None, alias="pendingAction")
    logs: NullableList[LogEntry] = Field(default_factory=list)
    destroyed_stars: NullableList[int] = Field(default_factory=list, alias="destroyedStars")
    star_effects: NullableList[StarEffect] = Field(default_factory=list, alias="starEffects")
    winner: str | None = None
    replay_id: str | None = Field(default=None, alias="replayId")
    is_processing: bool = Field(default=False, alias="isProcessing")
    version: int | None = None
    last_relic_discovery: RelicDiscovery | None = Field(default=None, alias="lastRelicDiscovery")
    map_snapshot: MapLayoutSnapshot | None = Field(default=None, alias="mapSnapshot")
    # Backend JSON tag is "_viewMeta" (with leading underscore).
    view_meta: ViewMeta = Field(alias="_viewMeta")
