"""可开关的推送配置（每 QQ 一份）。

硬推类别（turn_change / game_over / pending_action）不可关闭，因此不在此
暴露字段。
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class NotifyConfig:
    broadcast: bool = True
    strike: bool = True
    other: bool = False

    @classmethod
    def default(cls) -> NotifyConfig:
        return cls()

    def to_dict(self) -> dict[str, bool]:
        return {"broadcast": self.broadcast, "strike": self.strike, "other": self.other}

    @classmethod
    def from_dict(cls, d: dict[str, bool]) -> NotifyConfig:
        # 仅取已知字段，忽略多余键；缺失字段用默认值
        return cls(
            broadcast=d.get("broadcast", True),
            strike=d.get("strike", True),
            other=d.get("other", False),
        )


class NotifyConfigStore:
    """每 QQ 的推送配置 JSON 持久化存储（进程内缓存 + 原子写）。"""

    def __init__(self, file_path: Path) -> None:
        self._path = file_path
        self._configs: dict[int, NotifyConfig] = {}
        self._lock = asyncio.Lock()
        self._load_sync()

    def get(self, qq: int) -> NotifyConfig:
        return self._configs.get(qq, NotifyConfig.default())

    async def set(self, qq: int, cfg: NotifyConfig) -> None:
        async with self._lock:
            self._configs[qq] = cfg
            await self._save_locked()

    async def reset(self, qq: int) -> None:
        async with self._lock:
            self._configs.pop(qq, None)
            await self._save_locked()

    async def _save_locked(self) -> None:
        # 原子写：写 .tmp → rename
        data = {"qq_to_config": {str(q): c.to_dict() for q, c in self._configs.items()}}
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self._path)

    def _load_sync(self) -> None:
        if not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            raw = data.get("qq_to_config", {})
            for k, v in raw.items():
                if k.isdigit() and isinstance(v, dict):
                    self._configs[int(k)] = NotifyConfig.from_dict(v)
        except (json.JSONDecodeError, OSError):
            # 容错：损坏文件回退空配置 + 警告日志（loguru）
            from loguru import logger

            logger.warning("notify_settings.json 解析失败，回退默认配置 path={}", self._path)
