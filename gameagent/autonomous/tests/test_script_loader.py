"""脚本加载单测：load_script_decider 从文件实例化 ScriptDecider。"""

from __future__ import annotations

import textwrap

import pytest

from autonomous_driver.decide import GameAction, ScriptLoadError, load_script_decider

GOOD_SCRIPT = textwrap.dedent(
    """\
    from autonomous_driver.decide import GameAction

    class ScriptDecider:
        def __init__(self):
            self.state = {"turns": 0}

        def decide(self, view, affordance):
            self.state["turns"] += 1
            return GameAction("end_turn")

        def on_game_end(self, match_id, result):
            self.state["last"] = result
    """
)


def test_load_good_script(tmp_path) -> None:
    path = tmp_path / "v1.py"
    path.write_text(GOOD_SCRIPT, encoding="utf-8")

    decider = load_script_decider(str(path))

    assert decider.state == {"turns": 0}
    action = decider.decide({}, {})
    assert action == GameAction("end_turn")
    assert decider.state["turns"] == 1
    decider.on_game_end("m1", "win")
    assert decider.state["last"] == "win"


def test_load_missing_file_raises(tmp_path) -> None:
    with pytest.raises(ScriptLoadError, match="不存在"):
        load_script_decider(str(tmp_path / "nope.py"))


def test_load_no_script_decider_class_raises(tmp_path) -> None:
    path = tmp_path / "bad.py"
    path.write_text("x = 1\n", encoding="utf-8")
    with pytest.raises(ScriptLoadError, match="未定义 ScriptDecider"):
        load_script_decider(str(path))


def test_load_syntax_error_raises(tmp_path) -> None:
    path = tmp_path / "syntax.py"
    path.write_text("def (:\n", encoding="utf-8")
    with pytest.raises(ScriptLoadError, match="导入失败"):
        load_script_decider(str(path))


def test_load_decider_without_decide_raises(tmp_path) -> None:
    path = tmp_path / "nodecide.py"
    path.write_text(
        textwrap.dedent(
            """\
            class ScriptDecider:
                pass
            """
        ),
        encoding="utf-8",
    )
    with pytest.raises(ScriptLoadError, match="未实现 decide"):
        load_script_decider(str(path))


def test_load_constructor_raises(tmp_path) -> None:
    path = tmp_path / "ctor.py"
    path.write_text(
        textwrap.dedent(
            """\
            from autonomous_driver.decide import GameAction

            class ScriptDecider:
                def __init__(self):
                    raise RuntimeError("boom")

                def decide(self, view, affordance):
                    return GameAction("end_turn")
            """
        ),
        encoding="utf-8",
    )
    with pytest.raises(ScriptLoadError, match="实例化失败"):
        load_script_decider(str(path))
