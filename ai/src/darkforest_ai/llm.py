"""
LLM 推理引擎
============
与 nanobot 交互，通过 JSON 格式约定获取决策。
"""

import json
import logging
import re
import time
from typing import Optional

from openai import OpenAI

logger = logging.getLogger("darkforest-ai")


class LLMEngine:
    """与 nanobot 交互，通过 JSON 格式约定获取决策"""

    def __init__(self, base_url: str, api_key: str, model: str, session_id: str = "darkforest-ai"):
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        self.model = model
        self.session_id = session_id
        self._auto_discover_model()

    def _auto_discover_model(self):
        """自动查询可用模型（如果未指定）"""
        if self.model:
            return

        try:
            models = self.client.models.list()
            if models.data:
                self.model = models.data[0].id
                logger.info(f"自动选择模型: {self.model}")
            else:
                logger.error("未找到可用模型，请手动配置 LLM_MODEL")
        except Exception as e:
            logger.error(f"查询模型失败: {e}")

    def think(
        self,
        prompt: str,
        max_retries: int = 3,
    ) -> Optional[dict]:
        """
        向 nanobot 请求决策，解析返回的 JSON。
        如果格式错误，自动重试。
        """
        messages = [{"role": "user", "content": prompt}]

        for attempt in range(max_retries):
            try:
                start_time = time.time()
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    extra_body={"session_id": self.session_id},
                    max_tokens=1000,
                )
                elapsed = time.time() - start_time
                logger.info(f"LLM 响应时间: {elapsed:.2f}秒")

                content = response.choices[0].message.content
                if not content:
                    logger.warning(f"LLM 返回空内容 (尝试 {attempt + 1}/{max_retries})")
                    continue

                logger.debug(f"LLM 原始回复: {content[:200]}")

                # 尝试解析 JSON
                result = self._parse_json(content)
                if result:
                    return result

                # 解析失败 → 提示重试
                logger.warning(f"JSON 解析失败 (尝试 {attempt + 1}/{max_retries})")
                messages.append({"role": "user", "content": "你返回的内容不是有效的 JSON。请只返回 JSON 格式，不要返回其他内容。"})

            except Exception as e:
                logger.error(f"LLM 请求失败 (尝试 {attempt + 1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(1)

        return None

    @staticmethod
    def _parse_json(content: str) -> Optional[dict]:
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
