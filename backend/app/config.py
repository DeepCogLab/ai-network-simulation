"""全局配置：从 backend/.env 读取大模型接口配置。"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen3.5-122b-a10b")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_CONCURRENCY = int(os.getenv("LLM_CONCURRENCY", "8"))
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "40"))

CACHE_DIR = BASE_DIR / "app" / "data" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
RUNS_DIR = BASE_DIR / "runs"
RUNS_DIR.mkdir(parents=True, exist_ok=True)
