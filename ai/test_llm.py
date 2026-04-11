"""
LLM 兼容性测试脚本（适配 nanobot）
==================================
验证 nanobot 是否能返回结构化 JSON 输出

用法：
  uv run test_llm.py
"""

import json
import os
import re
import time

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://127.0.0.1:8900/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "dummy")
LLM_MODEL = os.getenv("LLM_MODEL", "")
SESSION_ID = os.getenv("SESSION_ID", "test-session")


def test_llm():
    print("=" * 60)
    print("LLM 兼容性测试（nanobot）")
    print("=" * 60)
    print(f"LLM_BASE_URL: {LLM_BASE_URL}")
    print()

    client = OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL)

    # 自动发现模型
    model_name = LLM_MODEL
    if not model_name:
        try:
            models = client.models.list()
            if models.data:
                model_name = models.data[0].id
                print(f"📦 可用模型: {model_name}")
            else:
                print("❌ 未找到可用模型")
                return False
        except Exception as e:
            print(f"❌ 查询模型失败: {e}")
            return False

    # 测试 Prompt：要求返回 JSON
    test_prompt = """你是一个游戏助手。请根据以下手牌信息返回一个 JSON 格式的出牌建议。

手牌: [br_001(宇宙广播), st_005(等级2打击), df_002(3级防御)]

请返回如下格式的 JSON：
{"recommended_card": "牌UID", "reason": "推荐理由"}

只返回 JSON，不要返回其他内容。"""

    print(f"\n📤 发送测试请求...")
    print(f"   Prompt: {test_prompt[:80]}...")

    start_time = time.time()

    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": test_prompt}],
            extra_body={"session_id": SESSION_ID},
            max_tokens=500,
        )

        elapsed = time.time() - start_time
        print(f"⏱️  响应时间: {elapsed:.2f}秒")

        content = response.choices[0].message.content
        if not content:
            print("❌ LLM 返回空内容")
            return False

        print(f"\n📝 LLM 原始回复:")
        print(f"   {content[:300]}")

        # 尝试解析 JSON
        result = parse_json(content)
        if result:
            print(f"\n✅ JSON 解析成功!")
            print(f"   {json.dumps(result, ensure_ascii=False, indent=2)}")
        else:
            print(f"\n⚠️  JSON 解析失败")
            print(f"   AI 可能没有严格遵循 JSON 格式")
            return False

        # 响应速度评估
        if elapsed < 3:
            print(f"\n✅ 响应速度优秀 ({elapsed:.2f}s)")
        elif elapsed < 5:
            print(f"\n✅ 响应速度可接受 ({elapsed:.2f}s)")
        elif elapsed < 30:
            print(f"\n⚠️  响应较慢 ({elapsed:.2f}s)，游戏倒计时需相应延长")
        else:
            print(f"\n❌ 响应过慢 ({elapsed:.2f}s)，不适合实时游戏")

        return True

    except Exception as e:
        elapsed = time.time() - start_time
        print(f"\n❌ 请求失败 ({elapsed:.2f}s)")
        print(f"错误信息: {e}")
        return False


def parse_json(content: str):
    """从 AI 回复中提取并解析 JSON"""
    # 尝试直接解析
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # 尝试提取 JSON 代码块
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 尝试找到第一个 { 到最后一个 }
    start = content.find("{")
    end = content.rfind("}")
    if start != -1 and end != -1:
        try:
            return json.loads(content[start:end+1])
        except json.JSONDecodeError:
            pass

    return None


if __name__ == "__main__":
    success = test_llm()
    print()
    print("=" * 60)
    if success:
        print("✅ 测试通过! 可以接入 AI Agent")
    else:
        print("❌ 测试失败! 请检查 nanobot 是否正常运行")
    print("=" * 60)
