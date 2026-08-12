"""规则策略单测：pendingAction / broadcastAction / 自由动作优先级。"""

from __future__ import annotations

from autonomous_driver.decide import GameAction, RuleDecider


def _view(energy: int = 100) -> dict:
    return {"agentView": {"self": {"energy": energy}}}


def _target(ttype: str, value: str) -> dict:
    return {"type": ttype, "value": value}


def test_pending_skip_option_preferred() -> None:
    aff = {
        "pendingAction": {
            "type": "strikeMove",
            "legalOptions": ["skip_move", "move"],
            "legalTargets": [],
        }
    }
    action = RuleDecider().decide(_view(), aff)
    assert action == GameAction("resolve_strike_action", {"option": "skip_move"})


def test_pending_move_builds_strike_args() -> None:
    aff = {
        "pendingAction": {
            "type": "strikeMove",
            "legalOptions": ["move"],
            "legalTargets": [
                _target("strikeUid", "strike-1"),
                _target("systemId", "7"),
            ],
        }
    }
    action = RuleDecider().decide(_view(), aff)
    assert action == GameAction(
        "resolve_strike_action",
        {"option": "move", "strike_uid": "strike-1", "target_system": 7},
    )


def test_pending_missed_discard() -> None:
    aff = {
        "pendingAction": {
            "type": "missedStrike",
            "legalOptions": ["discard_missed"],
            "legalTargets": [_target("strikeUid", "strike-9")],
        }
    }
    action = RuleDecider().decide(_view(), aff)
    assert action == GameAction("resolve_strike_action", {"option": "discard_missed"})


def test_broadcast_agree_with_card() -> None:
    aff = {
        "broadcastAction": {
            "type": "agreeOrRefuse",
            "legalTargets": [_target("cardUid", "card-3")],
        }
    }
    action = RuleDecider().decide(_view(), aff)
    assert action == GameAction("respond_broadcast", {"agreed": True, "card_uid": "card-3"})


def test_broadcast_refuse_without_card() -> None:
    aff = {"broadcastAction": {"type": "agreeOrRefuse", "legalTargets": []}}
    action = RuleDecider().decide(_view(), aff)
    assert action == GameAction("respond_broadcast", {"agreed": False})


def test_broadcast_select_responder() -> None:
    aff = {
        "broadcastAction": {
            "type": "selectResponder",
            "legalTargets": [_target("playerId", "p-42")],
        }
    }
    action = RuleDecider().decide(_view(), aff)
    assert action == GameAction("select_broadcast_responder", {"responder_player_id": "p-42"})


def test_broadcast_cancel() -> None:
    aff = {"broadcastAction": {"type": "cancel"}}
    action = RuleDecider().decide(_view(), aff)
    assert action == GameAction("cancel_broadcast")


def test_free_action_priority_strike_over_play() -> None:
    aff = {
        "legalActions": [
            {"action": "play_card", "cost": {"energy": 1}, "legalTargets": []},
            {"action": "strike", "cost": {"energy": 3}, "legalTargets": [
                _target("cardUid", "c-s"),
                _target("systemId", "5"),
            ]},
        ]
    }
    action = RuleDecider().decide(_view(energy=10), aff)
    assert action == GameAction("strike", {"card_uid": "c-s", "target_system": 5})


def test_free_action_cost_skipped_when_insufficient() -> None:
    aff = {
        "legalActions": [
            {"action": "strike", "cost": {"energy": 20}, "legalTargets": []},
            {"action": "play_card", "cost": {"energy": 1}, "legalTargets": [
                _target("cardUid", "c-p"),
            ]},
        ]
    }
    action = RuleDecider().decide(_view(energy=5), aff)
    assert action == GameAction("play_card", {"card_uid": "c-p"})


def test_free_action_end_turn_fallback() -> None:
    aff = {"legalActions": [{"action": "end_turn", "cost": {"energy": 0}}]}
    action = RuleDecider().decide(_view(), aff)
    assert action == GameAction("end_turn")


def test_pending_takes_precedence_over_free() -> None:
    aff = {
        "pendingAction": {"type": "strikeSelect", "legalOptions": ["skip_select"]},
        "legalActions": [{"action": "strike", "cost": {"energy": 1}}],
    }
    action = RuleDecider().decide(_view(), aff)
    assert action == GameAction("resolve_strike_action", {"option": "skip_select"})


def test_broadcast_takes_precedence_over_free() -> None:
    aff = {
        "broadcastAction": {"type": "cancel"},
        "legalActions": [{"action": "strike", "cost": {"energy": 1}}],
    }
    action = RuleDecider().decide(_view(), aff)
    assert action == GameAction("cancel_broadcast")
