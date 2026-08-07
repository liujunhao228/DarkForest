"""E2E：确定性复现——同 E2E_RAND_SEED 下两局开局渲染完全一致。

利用 backend 的 e2e_rng（E2E_RAND_SEED=42 每次 NewGame 重播种）：
两局各自在独立 backend+bot 栈上开局后立即 .state，对比私发的星图 PNG
base64 是否逐字节一致（跨进程、跨后端实例）。
"""

from __future__ import annotations

from . import _helpers as h
from ._stack import isolated_stack


def _first_state_b64(backend_port: int, bot_port: int, name: str) -> str:
    """独立栈起一局，.state 取初始星图 PNG 的 base64。"""
    with isolated_stack(backend_port, bot_port, name) as client:
        try:
            h.start_match(client)
            client.send_private_message(h.USER_A, ".state", timeout=5.0)
            frame = client.wait_for("send_private_msg", has_image=True, timeout=h.MATCH_TIMEOUT)
            b64 = client.extract_image_b64(frame)
            assert b64 is not None
            return b64
        finally:
            h.end_match(client)


def test_same_seed_renders_identical_initial_state() -> None:
    first = _first_state_b64(18120, 18121, "determinism-1")
    second = _first_state_b64(18122, 18123, "determinism-2")
    assert first == second, "同 E2E_RAND_SEED 下两局初始星图不一致"
