"""Tests for notifications/match_found.py.

Uses unittest.mock.AsyncMock to mock the nonebot Bot.call_api interface.
Tests cover:
- First call: group message (1x) + private message (1x)
- Same room_code second call: no group message + private message (1x)
- Different room_code: group message again + private message
- Group message failure does not block private message
- reset_announced() clears dedup state
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from darkforest_bot.backend.protocol import MatchPlayerInfo
from darkforest_bot.notifications.match_found import (
    notify_match_found,
    reset_announced,
)


def _make_player(
    display_name: str,
    player_id: str = "p1",
    is_host: bool = False,
    player_number: int = 1,
    position: int = 0,
) -> MatchPlayerInfo:
    """Helper to create a MatchPlayerInfo with sensible defaults."""
    return MatchPlayerInfo(
        playerId=player_id,
        displayName=display_name,
        isHost=is_host,
        playerNumber=player_number,
        position=position,
    )


@pytest.fixture(autouse=True)
def _reset_announced() -> None:
    """Clear announced-rooms state before each test."""
    reset_announced()


class TestNotifyMatchFoundFirstCall:
    async def test_first_call_sends_group_and_private(self) -> None:
        bot = AsyncMock()
        players = [
            _make_player("Alice", player_id="p1", is_host=True, player_number=1),
            _make_player("Bob", player_id="p2", player_number=2),
        ]

        await notify_match_found(
            bot=bot,  # type: ignore[arg-type]
            group_id=10001,
            current_qq=12345,
            players=players,
            room_code="ROOM-A",
        )

        # Group message sent once.
        group_calls = [
            c for c in bot.call_api.call_args_list if c.kwargs.get("group_id") is not None
        ]
        assert len(group_calls) == 1
        group_msg = group_calls[0].kwargs["message"]
        assert "ROOM-A" in group_msg
        assert "Alice" in group_msg
        assert "Bob" in group_msg
        assert "匹配成功" in group_msg

        # Private message sent once to current_qq.
        private_calls = [
            c for c in bot.call_api.call_args_list if c.kwargs.get("user_id") is not None
        ]
        assert len(private_calls) == 1
        assert private_calls[0].kwargs["user_id"] == 12345
        assert "ROOM-A" in private_calls[0].kwargs["message"]


class TestNotifyMatchFoundDedup:
    async def test_same_room_second_call_skips_group_message(self) -> None:
        bot = AsyncMock()
        players = [_make_player("Alice"), _make_player("Bob")]

        # First call — group + private.
        await notify_match_found(
            bot=bot,  # type: ignore[arg-type]
            group_id=10001,
            current_qq=11111,
            players=players,
            room_code="ROOM-D",
        )

        # Second call (different QQ, same room) — private only, no group.
        await notify_match_found(
            bot=bot,  # type: ignore[arg-type]
            group_id=10001,
            current_qq=22222,
            players=players,
            room_code="ROOM-D",
        )

        # Group message sent only once.
        group_calls = [
            c for c in bot.call_api.call_args_list if c.kwargs.get("group_id") is not None
        ]
        assert len(group_calls) == 1

        # Private messages sent to both QQs.
        private_calls = [
            c for c in bot.call_api.call_args_list if c.kwargs.get("user_id") is not None
        ]
        assert len(private_calls) == 2
        assert private_calls[0].kwargs["user_id"] == 11111
        assert private_calls[1].kwargs["user_id"] == 22222

    async def test_different_room_sends_group_again(self) -> None:
        bot = AsyncMock()
        players = [_make_player("Alice")]

        # First room.
        await notify_match_found(
            bot=bot,  # type: ignore[arg-type]
            group_id=10001,
            current_qq=11111,
            players=players,
            room_code="ROOM-1",
        )

        # Different room — group message sent again.
        await notify_match_found(
            bot=bot,  # type: ignore[arg-type]
            group_id=10001,
            current_qq=22222,
            players=players,
            room_code="ROOM-2",
        )

        group_calls = [
            c for c in bot.call_api.call_args_list if c.kwargs.get("group_id") is not None
        ]
        assert len(group_calls) == 2


class TestNotifyMatchFoundResilience:
    async def test_group_failure_does_not_block_private(self) -> None:
        bot = AsyncMock()

        # Make group messages fail but private messages succeed.
        async def call_api(api: str, **kwargs: Any) -> None:
            if api == "send_group_msg":
                raise RuntimeError("group send failed")
            # send_private_msg succeeds (no raise)

        bot.call_api.side_effect = call_api

        await notify_match_found(
            bot=bot,  # type: ignore[arg-type]
            group_id=10001,
            current_qq=12345,
            players=[_make_player("Alice")],
            room_code="ROOM-F",
        )

        # Despite group failure, private message was still sent.
        # call_api was called with both group and private args.
        api_calls = [c.args[0] for c in bot.call_api.call_args_list]
        assert "send_group_msg" in api_calls
        assert "send_private_msg" in api_calls

    async def test_private_failure_does_not_block_group(self) -> None:
        bot = AsyncMock()

        call_count: dict[str, int] = {"group": 0, "private": 0}

        async def call_api(api: str, **kwargs: Any) -> None:
            if api == "send_private_msg":
                call_count["private"] += 1
                raise RuntimeError("private send failed")
            call_count["group"] += 1

        bot.call_api.side_effect = call_api

        await notify_match_found(
            bot=bot,  # type: ignore[arg-type]
            group_id=10001,
            current_qq=12345,
            players=[_make_player("Alice")],
            room_code="ROOM-P",
        )

        # Group was attempted despite private failure.
        assert call_count["group"] == 1
        assert call_count["private"] == 1


class TestResetAnnounced:
    async def test_reset_allows_group_message_again(self) -> None:
        bot = AsyncMock()
        players = [_make_player("Alice")]

        # First call — group message sent.
        await notify_match_found(
            bot=bot,  # type: ignore[arg-type]
            group_id=10001,
            current_qq=11111,
            players=players,
            room_code="ROOM-R",
        )

        # Second call — group message deduplicated (not sent).
        await notify_match_found(
            bot=bot,  # type: ignore[arg-type]
            group_id=10001,
            current_qq=22222,
            players=players,
            room_code="ROOM-R",
        )

        # Reset and call again — group message sent again.
        reset_announced()
        await notify_match_found(
            bot=bot,  # type: ignore[arg-type]
            group_id=10001,
            current_qq=33333,
            players=players,
            room_code="ROOM-R",
        )

        group_calls = [
            c for c in bot.call_api.call_args_list if c.kwargs.get("group_id") is not None
        ]
        assert len(group_calls) == 2  # first call + post-reset call


class TestNotifyMatchFoundMessageContent:
    async def test_group_message_contains_all_player_names(self) -> None:
        bot = AsyncMock()
        players = [
            _make_player("张三", player_id="p1", is_host=True, player_number=1),
            _make_player("李四", player_id="p2", player_number=2),
            _make_player("王五", player_id="p3", player_number=3),
            _make_player("赵六", player_id="p4", player_number=4),
        ]

        await notify_match_found(
            bot=bot,  # type: ignore[arg-type]
            group_id=10001,
            current_qq=12345,
            players=players,
            room_code="ABCD",
        )

        group_calls = [
            c for c in bot.call_api.call_args_list if c.kwargs.get("group_id") is not None
        ]
        msg = group_calls[0].kwargs["message"]
        assert "张三" in msg
        assert "李四" in msg
        assert "王五" in msg
        assert "赵六" in msg
        assert "ABCD" in msg
        # Names should be joined with 、
        assert "张三、李四、王五、赵六" in msg

    async def test_private_message_contains_room_code(self) -> None:
        bot = AsyncMock()

        await notify_match_found(
            bot=bot,  # type: ignore[arg-type]
            group_id=10001,
            current_qq=99999,
            players=[_make_player("Alice")],
            room_code="XYZ123",
        )

        private_calls = [
            c for c in bot.call_api.call_args_list if c.kwargs.get("user_id") is not None
        ]
        msg = private_calls[0].kwargs["message"]
        assert "XYZ123" in msg
        assert "对局开始" in msg
