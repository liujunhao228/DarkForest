"""Tests for notifications/notify_config.py — NotifyConfig data class."""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from darkforest_bot.notifications.notify_config import NotifyConfig


def test_default_values() -> None:
    cfg = NotifyConfig.default()
    assert cfg.broadcast is True
    assert cfg.strike is True
    assert cfg.other is False


def test_round_trip() -> None:
    cfg = NotifyConfig(broadcast=False, strike=True, other=True)
    assert NotifyConfig.from_dict(cfg.to_dict()) == cfg


def test_from_dict_missing_fields_use_defaults() -> None:
    cfg = NotifyConfig.from_dict({})
    assert cfg.broadcast is True
    assert cfg.strike is True
    assert cfg.other is False


def test_from_dict_ignores_extra_keys() -> None:
    cfg = NotifyConfig.from_dict(
        {"broadcast": False, "strike": False, "other": True, "nonsense": 42}
    )
    assert cfg.broadcast is False
    assert cfg.strike is False
    assert cfg.other is True


def test_from_dict_partial_overrides() -> None:
    cfg = NotifyConfig.from_dict({"broadcast": False})
    assert cfg.broadcast is False
    assert cfg.strike is True
    assert cfg.other is False


def test_frozen_immutable() -> None:
    cfg = NotifyConfig.default()
    with pytest.raises(FrozenInstanceError):
        cfg.broadcast = False  # type: ignore[misc]
