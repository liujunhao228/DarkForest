"""L1 离线校验门单测（Swarm Step 10）：validate_script 导入/结构 + 干跑断言。

好脚本（基于模板骨架）通过；坏脚本（导入失败/缺 decide/决策抛异常/非法动作名/
camelCase 参数键/返回非 GameAction）→ ok=False 且 reason 可读。CLI validate
子命令 exit 0/2 另测。
"""

from __future__ import annotations

import textwrap

from typer.testing import CliRunner

from autonomous_driver.cli import app
from autonomous_driver.validate_script import validate_script

runner = CliRunner()

# 基于 rules/templates/basic.py 骨架语义的最小好脚本
GOOD_SCRIPT = textwrap.dedent(
    """\
    from autonomous_driver.decide import GameAction

    class ScriptDecider:
        def __init__(self):
            self.state = {"turns": 0}

        def decide(self, view, affordance):
            self.state["turns"] += 1
            pending = affordance.get("pendingAction")
            if pending:
                return GameAction("resolve_strike_action", {"option": "skip_select"})
            broadcast = affordance.get("broadcastAction")
            if broadcast:
                return GameAction("respond_broadcast", {"agreed": False})
            for opt in (affordance.get("legalActions") or []):
                if opt.get("action") == "end_turn":
                    return GameAction("end_turn")
            return GameAction("end_turn")
    """
)


def _write(tmp_path, code: str, name: str = "v1.py") -> str:
    path = tmp_path / name
    path.write_text(textwrap.dedent(code), encoding="utf-8")
    return str(path)


def test_validate_good_script(tmp_path) -> None:
    path = _write(tmp_path, GOOD_SCRIPT)
    result = validate_script(path)
    assert result.ok is True
    assert result.steps == 50  # 干跑满上限（无死循环、无异常）


def test_validate_missing_file(tmp_path) -> None:
    result = validate_script(str(tmp_path / "nope.py"))
    assert result.ok is False
    assert "不存在" in result.reason


def test_validate_no_script_decider(tmp_path) -> None:
    path = _write(tmp_path, "x = 1\n")
    result = validate_script(path)
    assert result.ok is False
    assert "未定义 ScriptDecider" in result.reason


def test_validate_decide_raises(tmp_path) -> None:
    code = """\
        from autonomous_driver.decide import GameAction

        class ScriptDecider:
            def decide(self, view, affordance):
                raise RuntimeError("boom")
    """
    path = _write(tmp_path, code)
    result = validate_script(path)
    assert result.ok is False
    assert "决策抛异常" in result.reason
    assert "boom" in result.reason


def test_validate_unknown_action_name(tmp_path) -> None:
    code = """\
        from autonomous_driver.decide import GameAction

        class ScriptDecider:
            def decide(self, view, affordance):
                return GameAction("fly_to_moon")
    """
    path = _write(tmp_path, code)
    result = validate_script(path)
    assert result.ok is False
    assert "不在已知动作集" in result.reason


def test_validate_camelcase_args_rejected(tmp_path) -> None:
    code = """\
        from autonomous_driver.decide import GameAction

        class ScriptDecider:
            def decide(self, view, affordance):
                return GameAction("play_card", {"cardUid": "h1"})
    """
    path = _write(tmp_path, code)
    result = validate_script(path)
    assert result.ok is False
    assert "参数名错误" in result.reason
    assert "cardUid" in result.reason


def test_validate_unknown_arg_key(tmp_path) -> None:
    code = """\
        from autonomous_driver.decide import GameAction

        class ScriptDecider:
            def decide(self, view, affordance):
                return GameAction("end_turn", {"nonsense": 1})
    """
    path = _write(tmp_path, code)
    result = validate_script(path)
    assert result.ok is False
    assert "参数名错误" in result.reason


def test_validate_non_game_action_return(tmp_path) -> None:
    code = """\
        class ScriptDecider:
            def decide(self, view, affordance):
                return "end_turn"
    """
    path = _write(tmp_path, code)
    result = validate_script(path)
    assert result.ok is False
    assert "应为 GameAction" in result.reason


def test_validate_stateful_script_caught_late(tmp_path) -> None:
    """有状态脚本：第 3 次决策才抛异常（干跑循环覆盖状态累积）。"""
    code = """\
        from autonomous_driver.decide import GameAction

        class ScriptDecider:
            def __init__(self):
                self.n = 0

            def decide(self, view, affordance):
                self.n += 1
                if self.n >= 3:
                    raise ValueError("state blow up")
                return GameAction("end_turn")
    """
    path = _write(tmp_path, code)
    result = validate_script(path)
    assert result.ok is False
    assert "state blow up" in result.reason


# --- CLI validate 子命令 ---


def test_cli_validate_exit_0_on_good(tmp_path) -> None:
    path = _write(tmp_path, GOOD_SCRIPT)
    result = runner.invoke(app, ["validate", "--script", path])
    assert result.exit_code == 0
    assert "校验通过" in result.output


def test_cli_validate_exit_2_on_bad(tmp_path) -> None:
    path = _write(tmp_path, "x = 1\n")
    result = runner.invoke(app, ["validate", "--script", path])
    assert result.exit_code == 2
    assert "校验失败" in result.output
    assert "未定义 ScriptDecider" in result.output


def test_cli_validate_requires_script() -> None:
    result = runner.invoke(app, ["validate"])
    assert result.exit_code != 0
    assert "--script" in result.output
