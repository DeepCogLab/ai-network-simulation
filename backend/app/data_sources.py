"""实时数据接入：微博热搜、百度热搜、腾讯新闻热榜、中新网滚动新闻。

全部为公开榜单接口；带缓存（默认 120 秒）与离线降级，确保无网络时也能演示。
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import feedparser
import httpx

from .config import CACHE_DIR

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
_mem_cache: dict[str, tuple[float, Any]] = {}
TTL = 120


async def _cached(key: str, fetcher) -> dict:
    now = time.time()
    if key in _mem_cache and now - _mem_cache[key][0] < TTL:
        return {"source": key, "cached": True, "fetched_at": _mem_cache[key][0], "items": _mem_cache[key][1]}
    path = CACHE_DIR / f"{key}.json"
    try:
        items = await fetcher()
        if not items:
            raise RuntimeError("empty")
        _mem_cache[key] = (now, items)
        path.write_text(json.dumps({"t": now, "items": items}, ensure_ascii=False), encoding="utf-8")
        return {"source": key, "cached": False, "fetched_at": now, "items": items}
    except Exception as e:  # noqa: BLE001
        if path.exists():
            d = json.loads(path.read_text(encoding="utf-8"))
            return {"source": key, "cached": True, "offline": True, "error": str(e), "fetched_at": d["t"], "items": d["items"]}
        return {"source": key, "cached": False, "offline": True, "error": str(e), "fetched_at": now, "items": OFFLINE.get(key, [])}


async def fetch_weibo() -> list[dict]:
    async with httpx.AsyncClient(timeout=10, headers={"User-Agent": UA, "Referer": "https://weibo.com/", "X-Requested-With": "XMLHttpRequest"}) as c:
        r = await c.get("https://weibo.com/ajax/side/hotSearch")
        r.raise_for_status()
        data = r.json()["data"]
    items = []
    for g in (data.get("hotgovs") or [])[:2]:
        items.append({"rank": 0, "title": g.get("word", "").strip("#"), "hot": None, "label": "置顶", "category": "政务",
                      "url": "https://s.weibo.com/weibo?q=" + g.get("word", "")})
    for it in data.get("realtime", []):
        if it.get("is_ad"):
            continue
        word = it.get("word") or it.get("note")
        items.append({
            "rank": it.get("realpos") or it.get("rank", 0) + 1,
            "title": word,
            "hot": it.get("num"),
            "label": it.get("label_name") or it.get("icon_desc") or "",
            "category": it.get("category") or it.get("flag_desc") or "",
            "url": "https://s.weibo.com/weibo?q=%23" + word + "%23",
        })
    return items


async def fetch_baidu() -> list[dict]:
    async with httpx.AsyncClient(timeout=10, headers={"User-Agent": UA}) as c:
        r = await c.get("https://top.baidu.com/api/board?platform=wise&tab=realtime")
        data = r.json()["data"]["cards"][0]["content"]
    flat = []
    for blk in data:
        flat.extend(blk.get("content", []) if isinstance(blk.get("content"), list) else [blk])
    return [{"rank": i + 1, "title": it.get("word"), "hot": int(it.get("hotScore") or 0) or None, "desc": it.get("desc", ""),
             "label": "置顶" if it.get("isTop") else "", "url": it.get("url")} for i, it in enumerate(flat) if it.get("word")]


async def fetch_tencent() -> list[dict]:
    async with httpx.AsyncClient(timeout=10, headers={"User-Agent": UA}) as c:
        r = await c.get("https://i.news.qq.com/gw/event/pc_hot_ranking_list?ids_hash=&offset=0&page_size=30")
        lst = r.json()["idlist"][0]["newslist"]
    out = []
    for it in lst:
        he = it.get("hotEvent") or {}
        if not it.get("title") or not he:
            continue
        out.append({"rank": he.get("ranking"), "title": it["title"], "desc": it.get("abstract", ""), "source": it.get("source"),
                    "hot": he.get("hotScore"), "time": it.get("time"), "url": it.get("url")})
    return out


async def fetch_chinanews() -> list[dict]:
    async with httpx.AsyncClient(timeout=10, headers={"User-Agent": UA}) as c:
        r = await c.get("https://www.chinanews.com.cn/rss/scroll-news.xml")
    feed = feedparser.parse(r.content)
    return [{"rank": i + 1, "title": e.title, "desc": (e.get("description") or "")[:200], "time": e.get("published", ""),
             "url": e.link, "source": "中新网"} for i, e in enumerate(feed.entries[:40])]


SOURCES = {"weibo": fetch_weibo, "baidu": fetch_baidu, "tencent": fetch_tencent, "chinanews": fetch_chinanews}
SOURCE_NAMES = {"weibo": "微博热搜", "baidu": "百度热搜", "tencent": "腾讯新闻热榜", "chinanews": "中新网滚动"}


async def get_source(key: str) -> dict:
    res = await _cached(key, SOURCES[key])
    res["name"] = SOURCE_NAMES[key]
    return res


async def get_all() -> dict:
    keys = list(SOURCES)
    results = await asyncio.gather(*(get_source(k) for k in keys))
    return dict(zip(keys, results))


OFFLINE = {
    "weibo": [
        {"rank": 1, "title": "某地网红餐厅被曝使用过期食材", "hot": 1820000, "label": "爆", "category": "社会"},
        {"rank": 2, "title": "高校回应宿舍楼甲醛超标传闻", "hot": 1360000, "label": "热", "category": "教育"},
        {"rank": 3, "title": "新能源车电池起火事故调查", "hot": 980000, "label": "新", "category": "科技"},
        {"rank": 4, "title": "某景区门票上调引热议", "hot": 760000, "label": "", "category": "旅游"},
    ],
    "baidu": [], "tencent": [], "chinanews": [],
}
