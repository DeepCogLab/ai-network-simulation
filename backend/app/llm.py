"""大模型调用层：OpenAI 兼容接口 + 并发控制 + JSON 解析 + 用量统计 + 失败降级。"""
from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any

from openai import AsyncOpenAI

from . import config


@dataclass
class LLMStats:
    calls: int = 0
    failures: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_latency: float = 0.0
    recent: list = field(default_factory=list)  # 最近调用日志，用于前端“智能体思维”面板

    def to_dict(self) -> dict:
        return {
            "calls": self.calls,
            "failures": self.failures,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "avg_latency": round(self.total_latency / self.calls, 2) if self.calls else 0,
        }


class LLMClient:
    def __init__(self) -> None:
        self.enabled = bool(config.LLM_API_KEY and config.LLM_BASE_URL)
        self.model = config.LLM_MODEL
        self.stats = LLMStats()
        self._sem = asyncio.Semaphore(config.LLM_CONCURRENCY)
        self._client = (
            AsyncOpenAI(base_url=config.LLM_BASE_URL, api_key=config.LLM_API_KEY, timeout=config.LLM_TIMEOUT)
            if self.enabled
            else None
        )

    def info(self) -> dict:
        return {"enabled": self.enabled, "model": self.model, "base_url": config.LLM_BASE_URL.split("/compatible")[0], **self.stats.to_dict()}

    async def chat_json(self, system: str, user: str, *, temperature: float = 0.8, max_tokens: int = 600, tag: str = "") -> dict | None:
        """调用模型并返回 JSON 对象；失败时返回 None，由调用方走规则降级。"""
        if not self.enabled:
            return None
        async with self._sem:
            t0 = time.time()
            try:
                resp = await self._client.chat.completions.create(
                    model=self.model,
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                    temperature=temperature,
                    max_tokens=max_tokens,
                    response_format={"type": "json_object"},
                    extra_body={"enable_thinking": False},
                )
                dt = time.time() - t0
                text = resp.choices[0].message.content or ""
                self.stats.calls += 1
                self.stats.total_latency += dt
                if resp.usage:
                    self.stats.prompt_tokens += resp.usage.prompt_tokens or 0
                    self.stats.completion_tokens += resp.usage.completion_tokens or 0
                data = parse_json(text)
                self.stats.recent.append({"tag": tag, "latency": round(dt, 2), "ok": data is not None, "out": text[:400]})
                self.stats.recent = self.stats.recent[-60:]
                return data
            except Exception as e:  # noqa: BLE001
                self.stats.failures += 1
                self.stats.recent.append({"tag": tag, "latency": round(time.time() - t0, 2), "ok": False, "out": f"ERROR: {e}"[:300]})
                self.stats.recent = self.stats.recent[-60:]
                return None


def parse_json(text: str) -> Any:
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        m = re.search(r"\{.*\}", text, flags=re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:  # noqa: BLE001
                return None
    return None


llm = LLMClient()
