"""复盘流程单测：review_cycle（拉取回放/构造摘要/连接关闭）+ publish_version（版本链）。

review_cycle 用 FakeClient 注入替换 DarkForestMCPClient，断言工具调用序列、
紧凑摘要结构、单局失败兜底与连接正确关闭；publish_version 用 tmp_path 替换
rules 目录，断言首次 v1、递增 v2、manifest 版本链与胜率记录。
"""

from __future__ import annotations

import json
from typing import Any

import pytest

import darkforest


def _semantic_out(*, turn: int = 0, winner: str = "ai1") -> dict[str, Any]:
    """构造 get_replay_semantic_view 输出（found=true 全知视角）。"""
    return {
        "found": True,
        "error": "",
        "omniscientView": {
            "players": [
                {
                    "id": "p1",
                    "name": "ai1",
                    "color": "#f00",
                    "energy": 12,
                    "position": 3,
                    "eliminated": False,
                    "hand": [{"uid": "u1", "name": "光粒"}, {"uid": "u2", "name": "二向箔"}],
                    "faceUpCards": [
                        {
                            "defId": "d1",
                            "name": "量子幽灵",
                            "role": "defense",
                            "output": "保护等级3",
                        }
                    ],
                    "broadcastHistory": [],
                },
                {
                    "id": "p2",
                    "name": "ai2",
                    "color": "#0f0",
                    "energy": 5,
                    "position": 7,
                    "eliminated": True,
                    "eliminationReason": "strike",
                    "hand": [],
                    "faceUpCards": [],
                    "broadcastHistory": [],
                },
            ],
            "drawPile": {"count": 10, "cardNames": ["黑暗森林威慑", "光粒"]},
            "discardPile": ["曲率驱动"],
            "flyingStrikes": [
                {
                    "uid": "s1",
                    "strikeName": "光粒打击",
                    "defId": "x",
                    "level": 2,
                    "ownerId": "p1",
                    "ownerName": "ai1",
                    "position": 3,
                    "targetSystem": 7,
                    "arrived": False,
                    "etaTurns": 1,
                    "threatLevel": "critical",
                    "explain": "命中无防御目标，毁星",
                    "targetPlayerIds": ["p2"],
                }
            ],
            "destroyedStars": [7],
            "starEffects": [
                {"systemId": 7, "type": "destroyed", "appliedAtTurn": 6, "duration": 99}
            ],
            "turn": turn,
            "phase": "gameOver",
            "turnPhase": "gameOver",
            "currentPlayerId": "",
            "gameMode": "classic",
            "winner": winner,
            "currentPlayerName": "",
        },
    }


class FakeClient:
    """DarkForestMCPClient stub：记录调用，按工具名返回预设输出。"""

    def __init__(self, url: str, agent_name: str) -> None:
        self.url = url
        self.agent_name = agent_name
        self.calls: list[tuple[str, dict[str, Any] | None]] = []
        self.connected = False
        self.closed = False
        # 本地未命中开关：True 时第一次 get_replay_semantic_view 返回 found=false
        self.local_miss = False
        # fetch_shared_replay 失败开关：True 时返回 saved=false（触发 matchId 兜底）
        self.shared_fetch_fail = False
        self.ensure_fail = False

    async def connect(self) -> None:
        self.connected = True

    async def close(self) -> None:
        self.closed = True

    async def call_tool(
        self, name: str, arguments: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        self.calls.append((name, arguments))
        args = arguments or {}
        if name == "ensure_connected":
            if self.ensure_fail:
                raise RuntimeError("账户不可用")
            return {"connected": True, "accountId": "a1", "displayName": "ai1", "playerId": "p1"}
        if name == "get_replay_semantic_view":
            if self.local_miss:
                self.local_miss = False  # 只 miss 一次（模拟拉取后重试命中）
                return {
                    "found": False,
                    "error": (
                        "未在本地找到该回放。请先调用 fetch_shared_replay "
                        "从官方服务拉取或检查 replayId 是否正确"
                    ),
                }
            turn = int(args.get("turn", 0))
            return _semantic_out(turn=turn)
        if name == "get_replay_deltas":
            return {
                "replayId": args.get("replayId", ""),
                "totalTurns": 8,
                "fromTurn": 1,
                "toTurn": 8,
                "deltas": [
                    {
                        "turn": 1,
                        "playerId": "p1",
                        "playerName": "ai1",
                        "actions": [
                            {
                                "playerId": "p1",
                                "action": "play_card",
                                "data": {"cardUid": "u1"},
                                "turn": 1,
                                "timestamp": 1,
                            }
                        ],
                        "changes": {},
                    },
                    {
                        "turn": 2,
                        "playerId": "p2",
                        "playerName": "ai2",
                        "actions": [
                            {
                                "playerId": "p2",
                                "action": "end_turn",
                                "data": {},
                                "turn": 2,
                                "timestamp": 2,
                            }
                        ],
                        "changes": {},
                    },
                ],
            }
        if name == "fetch_shared_replay":
            if self.shared_fetch_fail:
                return {"saved": False, "message": "无法按能力令牌拉取"}
            return {
                "saved": True,
                "replayId": "r-fetched",
                "matchId": "m1",
                "playerNames": ["ai1", "ai2"],
                "totalTurns": 8,
                "winner": "ai1",
                "message": "",
            }
        if name == "fetch_and_save_replay":
            return {"saved": True, "replayId": "r-fallback", "matchId": "m1", "message": ""}
        return {}


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch) -> FakeClient:
    fake = FakeClient("http://localhost:9090/mcp", "reviewer")

    def _factory(url: str, agent_name: str) -> FakeClient:
        fake.url = url
        fake.agent_name = agent_name
        return fake

    monkeypatch.setattr(darkforest, "DarkForestMCPClient", _factory)
    return fake


@pytest.mark.asyncio
async def test_review_cycle_local_hit_builds_summary(fake_client: FakeClient) -> None:
    out = await darkforest.review_cycle("s1", ["m1", "m2"])

    assert out["script_name"] == "s1"
    assert out["match_ids"] == ["m1", "m2"]
    assert out["connected"] is True
    assert len(out["replay_summaries"]) == 2

    s = out["replay_summaries"][0]
    assert s["error"] == ""
    assert s["match_id"] == "m1"
    assert s["replay_id"] == "m1"
    assert s["game_mode"] == "classic"
    assert s["total_turns"] == 8
    assert s["winner"] == "ai1"
    # players 摘要：手牌只留卡名、淘汰原因透传
    assert len(s["players"]) == 2
    assert s["players"][0]["hand"] == ["光粒", "二向箔"]
    assert s["players"][0]["face_up"] == ["量子幽灵"]
    assert s["players"][1]["eliminated"] is True
    assert s["players"][1]["elimination_reason"] == "strike"
    # turns 动作流：动作转紧凑描述
    assert len(s["turns"]) == 2
    assert s["turns"][0]["player"] == "ai1"
    assert s["turns"][0]["actions"] == ['play_card({"cardUid":"u1"})']
    assert s["turns"][1]["actions"] == ["end_turn"]
    # final_state 补充
    assert s["final_state"]["destroyed_stars"] == [7]
    assert s["final_state"]["flying_strikes"][0]["strike_name"] == "光粒打击"
    assert s["final_state"]["star_effects"][0]["system_id"] == 7
    # 工具调用序列：每局 semantic(0) → deltas → semantic(totalTurns)
    names = [c[0] for c in fake_client.calls]
    assert names == [
        "ensure_connected",
        "get_replay_semantic_view",
        "get_replay_deltas",
        "get_replay_semantic_view",
        "get_replay_semantic_view",
        "get_replay_deltas",
        "get_replay_semantic_view",
    ]
    # 连接正确关闭
    assert fake_client.closed is True


@pytest.mark.asyncio
async def test_review_cycle_fetches_when_local_miss(fake_client: FakeClient) -> None:
    fake_client.local_miss = True  # 第一次 semantic 未命中 → 拉取落库后重试
    out = await darkforest.review_cycle("s1", ["m1"])

    s = out["replay_summaries"][0]
    assert s["error"] == ""
    assert s["replay_id"] == "r-fetched"  # fetch_shared_replay 返回的 replayId
    assert fake_client.closed is True
    # 调用序列含 fetch_shared_replay
    names = [c[0] for c in fake_client.calls]
    assert "fetch_shared_replay" in names
    assert names[0] == "ensure_connected"


@pytest.mark.asyncio
async def test_review_cycle_falls_back_to_match_id_fetch(fake_client: FakeClient) -> None:
    fake_client.local_miss = True
    fake_client.shared_fetch_fail = True  # replayId 拉取失败 → matchId 兜底
    out = await darkforest.review_cycle("s1", ["m1"])

    s = out["replay_summaries"][0]
    assert s["error"] == ""
    assert s["replay_id"] == "r-fallback"
    names = [c[0] for c in fake_client.calls]
    assert names.count("fetch_shared_replay") == 1
    assert "fetch_and_save_replay" in names


@pytest.mark.asyncio
async def test_review_cycle_single_game_error_does_not_raise(
    fake_client: FakeClient,
) -> None:
    fake_client.local_miss = True
    fake_client.shared_fetch_fail = True

    def _fetch_fallback_fail(name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        fake_client.calls.append((name, arguments))
        return {"saved": False, "message": "按对局 ID 也拉不到"}

    # 让 fetch_and_save_replay 也失败 → 该局摘要带 error，不抛异常
    fake_client.call_tool = _fetch_fallback_fail  # type: ignore[method-assign]
    out = await darkforest.review_cycle("s1", ["m1"])

    s = out["replay_summaries"][0]
    assert s["error"] != ""
    assert s["players"] == []
    assert fake_client.closed is True


@pytest.mark.asyncio
async def test_review_cycle_ensure_connected_failure_not_fatal(
    fake_client: FakeClient,
) -> None:
    fake_client.ensure_fail = True  # 账户不可用：本地回放仍可读
    out = await darkforest.review_cycle("s1", ["m1"])

    assert out["connected"] is False
    assert out["replay_summaries"][0]["error"] == ""
    assert fake_client.closed is True


@pytest.mark.asyncio
async def test_review_cycle_close_error_swallowed(fake_client: FakeClient) -> None:
    async def _boom_close() -> None:
        raise RuntimeError("服务器已关流")  # 断开异常必须被吞

    fake_client.close = _boom_close  # type: ignore[method-assign]
    out = await darkforest.review_cycle("s1", ["m1"])  # 不抛
    assert out["replay_summaries"][0]["error"] == ""


def test_publish_version_first_and_next(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(darkforest, "_rules_dir", lambda: tmp_path)

    out1 = darkforest.publish_version(
        "s1", "code-v1", stats={"games": 10, "wins": 6, "losses": 4, "draws": 0}
    )
    assert out1["ok"] is True
    assert out1["version"] == "v1"

    manifest = json.loads((tmp_path / "s1" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["name"] == "s1"
    assert manifest["current"] == "v1"
    assert manifest["versions"] == ["v1"]
    assert manifest["history"]["v1"]["stats"]["wins"] == 6
    assert "created_at" in manifest["history"]["v1"]

    out2 = darkforest.publish_version(
        "s1",
        "code-v2",
        stats={"games": 10, "wins": 7, "losses": 3, "draws": 0},
        notes="调整早期打击",
    )
    assert out2["version"] == "v2"
    assert (tmp_path / "s1" / "v1.py").read_text(encoding="utf-8") == "code-v1"
    assert (tmp_path / "s1" / "v2.py").read_text(encoding="utf-8") == "code-v2"

    manifest = json.loads((tmp_path / "s1" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["versions"] == ["v1", "v2"]
    assert manifest["current"] == "v2"
    assert manifest["history"]["v2"]["stats"]["wins"] == 7
    assert manifest["history"]["v2"]["notes"] == "调整早期打击"
    # 旧版本历史不被破坏
    assert manifest["history"]["v1"]["stats"]["wins"] == 6


def test_publish_version_recovers_bad_manifest(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    monkeypatch.setattr(darkforest, "_rules_dir", lambda: tmp_path)
    (tmp_path / "s1").mkdir(parents=True, exist_ok=True)
    (tmp_path / "s1" / "manifest.json").write_text("{ 坏 JSON", encoding="utf-8")

    out = darkforest.publish_version("s1", "code")
    assert out["version"] == "v1"  # 坏 manifest 回退重建
    manifest = json.loads((tmp_path / "s1" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["current"] == "v1"


def test_next_version() -> None:
    assert darkforest._next_version("") == "v1"  # noqa: SLF001
    assert darkforest._next_version("v1") == "v2"
    assert darkforest._next_version("v9") == "v10"
    assert darkforest._next_version("x1") == "v1"
