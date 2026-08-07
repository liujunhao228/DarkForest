"""Tests for notifications/notify_config.py — NotifyConfigStore JSON persistence."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from darkforest_bot.notifications.notify_config import NotifyConfig, NotifyConfigStore


def test_missing_file_returns_default(tmp_path: Path) -> None:
    store = NotifyConfigStore(tmp_path / "missing.json")
    assert store.get(123) == NotifyConfig.default()


def test_set_creates_file_and_get_returns(tmp_path: Path) -> None:
    path = tmp_path / "notify.json"
    store = NotifyConfigStore(path)
    cfg = NotifyConfig(broadcast=False, strike=True, other=True)
    asyncio.run(store.set(123, cfg))
    assert store.get(123) == cfg
    assert path.exists()


def test_reset_returns_default(tmp_path: Path) -> None:
    path = tmp_path / "notify.json"
    store = NotifyConfigStore(path)
    asyncio.run(store.set(123, NotifyConfig(broadcast=False, other=True)))
    assert store.get(123) != NotifyConfig.default()
    asyncio.run(store.reset(123))
    assert store.get(123) == NotifyConfig.default()


def test_round_trip_across_store_recreation(tmp_path: Path) -> None:
    """进程模拟：销毁 store1 后同路径重建 store2，配置应保留。"""
    path = tmp_path / "notify.json"
    store1 = NotifyConfigStore(path)
    asyncio.run(store1.set(123, NotifyConfig(broadcast=False, other=True)))
    # 销毁 store1（重建 store2 前丢弃引用）
    del store1

    store2 = NotifyConfigStore(path)
    cfg = store2.get(123)
    assert cfg.broadcast is False
    assert cfg.strike is True
    assert cfg.other is True


def test_corrupt_json_falls_back_without_raising(tmp_path: Path) -> None:
    path = tmp_path / "notify.json"
    path.write_text("{ not valid json !!", encoding="utf-8")
    store = NotifyConfigStore(path)
    assert store.get(123) == NotifyConfig.default()


def test_from_dict_tolerates_extra_and_missing_fields(tmp_path: Path) -> None:
    path = tmp_path / "notify.json"
    path.write_text(
        json.dumps(
            {
                "qq_to_config": {
                    "1": {"broadcast": False, "extra": 1},
                    "2": {},
                }
            }
        ),
        encoding="utf-8",
    )
    store = NotifyConfigStore(path)
    assert store.get(1).broadcast is False
    assert store.get(1).strike is True
    assert store.get(2) == NotifyConfig.default()


def test_concurrent_sets_do_not_corrupt(tmp_path: Path) -> None:
    async def scenario() -> dict[int, NotifyConfig]:
        path = tmp_path / "notify.json"
        store = NotifyConfigStore(path)

        async def setter(qq: int) -> None:
            await store.set(qq, NotifyConfig(broadcast=False, other=True))

        await asyncio.gather(*(setter(qq) for qq in range(1, 21)))
        return {qq: store.get(qq) for qq in range(1, 21)}

    cfg_map = asyncio.run(scenario())
    assert all(c.broadcast is False and c.other is True for c in cfg_map.values())
    # 文件仍是合法 JSON
    raw = (tmp_path / "notify.json").read_text(encoding="utf-8")
    parsed = json.loads(raw)
    assert len(parsed["qq_to_config"]) == 20
