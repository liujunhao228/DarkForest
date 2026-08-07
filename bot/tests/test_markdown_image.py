"""Tests for render/markdown_image.py — Pillow Markdown → PNG renderer."""

from __future__ import annotations

import io

from PIL import Image

from darkforest_bot.render.markdown_image import render_markdown


class TestRenderMarkdownBasic:
    def test_returns_non_empty_bytes(self) -> None:
        png = render_markdown("# 标题\n\n正文内容。")
        assert isinstance(png, bytes)
        assert len(png) > 0

    def test_output_is_valid_png(self) -> None:
        png = render_markdown("# 标题\n\n正文内容。")
        Image.open(io.BytesIO(png)).verify()

    def test_output_has_requested_width(self) -> None:
        png = render_markdown("内容", width=400)
        with Image.open(io.BytesIO(png)) as img:
            assert img.format == "PNG"
            assert img.size[0] == 400

    def test_default_width_is_900(self) -> None:
        png = render_markdown("内容")
        with Image.open(io.BytesIO(png)) as img:
            assert img.size[0] == 900


class TestMarkdownSyntax:
    def test_headings_bullets_and_inline_code(self) -> None:
        md = (
            "# 命令总览\n"
            "\n"
            "## 当前可用\n"
            "\n"
            "- ` .match` — 加入匹配队列\n"
            "- 普通项\n"
            "\n"
            "**加粗** 与 `行内代码` 混排。\n"
        )
        png = render_markdown(md)
        Image.open(io.BytesIO(png)).verify()

    def test_fenced_code_block(self) -> None:
        md = "## 示例\n\n```\nfenced line one\nfenced line two\n```\n"
        png = render_markdown(md)
        Image.open(io.BytesIO(png)).verify()

    def test_unknown_markdown_renders_as_plain_text(self) -> None:
        # Links / tables are outside the subset; they must not crash.
        md = "[链接](https://example.com) 与 | 表格 | 内容 |\n"
        png = render_markdown(md)
        Image.open(io.BytesIO(png)).verify()


class TestRobustness:
    def test_nonexistent_font_does_not_raise(self) -> None:
        png = render_markdown("# 标题", font_path="/nonexistent/font.ttf")
        Image.open(io.BytesIO(png)).verify()

    def test_empty_text_does_not_raise(self) -> None:
        png = render_markdown("")
        Image.open(io.BytesIO(png)).verify()

    def test_whitespace_only_does_not_raise(self) -> None:
        png = render_markdown("   \n \n")
        Image.open(io.BytesIO(png)).verify()

    def test_long_text_wraps_and_grows(self) -> None:
        long_line = "这是一个非常长的中文句子，用来验证换行逻辑是否正常。" * 40
        png = render_markdown(long_line, width=400)
        with Image.open(io.BytesIO(png)) as img:
            assert img.size[0] == 400
            assert img.size[1] > 200

    def test_narrow_width_does_not_raise(self) -> None:
        png = render_markdown("# 标题\n\n很长的正文内容", width=64)
        Image.open(io.BytesIO(png)).verify()


class TestHelpMarkdown:
    """Renders the exact Markdown the help command builds without crashing."""

    def test_overview_markdown(self) -> None:
        from darkforest_bot.commands.help import _build_overview_markdown
        from darkforest_bot.session.states import SessionState

        md = _build_overview_markdown(SessionState.IN_GAME)
        png = render_markdown(md, width=760)
        Image.open(io.BytesIO(png)).verify()

    def test_detail_markdown(self) -> None:
        from darkforest_bot.commands.help import COMMAND_DETAILS, _build_detail_markdown

        md = _build_detail_markdown("strike", COMMAND_DETAILS["strike"])
        png = render_markdown(md, width=760)
        Image.open(io.BytesIO(png)).verify()
