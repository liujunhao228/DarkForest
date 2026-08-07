"""事件类别识别：对比新旧 ViewState，把更新归类为可开关的推送事件类别。

与后端推送策略配套：将旧的「turn_key + push_key 单一字符串联合去重」重构为
「事件类别识别 + 分类开关」。硬推类别（TURN_CHANGE / GAME_OVER /
PENDING_ACTION）由 ``game_session`` 决定，不受 NotifyConfig 开关影响。
"""

from __future__ import annotations

from enum import Enum, auto

from darkforest_bot.backend.view_state import ViewState


class EventCategory(Enum):
    TURN_CHANGE = auto()      # turn_key 变化（total_turn:current_player_id）
    GAME_OVER = auto()        # winner 从 None 变非 None
    PENDING_ACTION = auto()   # pending_action 变化（且轮到本地）
    BROADCAST = auto()        # broadcast 字段变化（phase/responses/card_uid/存在性）
    STRIKE = auto()           # flyingStrikes / destroyedStars / starEffects 变化
    OTHER = auto()            # 其他字段变化（玩家能量、手牌数、faceUpCards 等）


# OTHER 类别需要逐字段对比的字段（均为 ViewState 上的属性名）。
_OTHER_FIELDS = (
    "phase",
    "game_mode",
    "mode_rules",
    "player_count",
    "players",
    "current_player_index",
    "local_player_id",
    "turn_phase",
    "logs",
    "is_processing",
    "version",
    "last_relic_discovery",
    "map_snapshot",
    "view_meta",
)


def classify(old: ViewState | None, new: ViewState) -> set[EventCategory]:
    """对比新旧 ViewState，返回本次更新包含的事件类别集合。

    old=None（首次 fullSync）→ 返回所有类别（强制全推一次，保证初始状态送达）。
    """
    if old is None:
        return set(EventCategory)

    events: set[EventCategory] = set()

    # TURN_CHANGE：谁在回合变化
    if f"{old.total_turn}:{old.current_player_id}" != f"{new.total_turn}:{new.current_player_id}":
        events.add(EventCategory.TURN_CHANGE)

    # GAME_OVER：winner 从无到有
    if old.winner is None and new.winner is not None:
        events.add(EventCategory.GAME_OVER)

    # PENDING_ACTION：pending 变化且轮到本地玩家；否则归 OTHER（别人回合的
    # pending 不应触发本地硬推）。
    if old.pending_action != new.pending_action:
        if new.current_player_id == new.local_player_id:
            events.add(EventCategory.PENDING_ACTION)
        else:
            events.add(EventCategory.OTHER)

    # BROADCAST：广播字段变化（pydantic __eq__ 比较，含 None↔非 None）
    if old.broadcast != new.broadcast:
        events.add(EventCategory.BROADCAST)

    # STRIKE：飞击 / 已毁灭恒星 / 恒星效果变化
    if (
        old.flying_strikes != new.flying_strikes
        or old.destroyed_stars != new.destroyed_stars
        or old.star_effects != new.star_effects
    ):
        events.add(EventCategory.STRIKE)

    # OTHER：其余字段变化
    for field in _OTHER_FIELDS:
        if getattr(old, field) != getattr(new, field):
            events.add(EventCategory.OTHER)
            break

    return events
