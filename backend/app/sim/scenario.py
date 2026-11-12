"""事件情景构建：把一条真实热搜/新闻转换为可仿真的“事件卡”。

事件卡定义了舆论立场轴、争议点(待证实说法)、话题标签、责任主体等，
是所有智能体共享的“世界设定”。
"""
from __future__ import annotations

import random

from ..llm import llm
from .personas import CITIES

SYSTEM = "你是资深舆情分析师与社会仿真设计师，擅长把新闻事件抽象为可计算的舆论议题。只输出 JSON。"

PROMPT = """请基于以下真实热点，设计一个社交平台舆情仿真的“事件卡”。
热点标题：{title}
补充信息：{desc}

要求：
1. 立场轴 stance_axis：neg 端与 pos 端分别代表什么态度（如 neg=质疑/批评当事方，pos=理解/支持当事方）。
2. claim：该事件中最可能在网络上流传的一条“待证实说法/传言”（可以是夸大的细节），用于谣言传播与辟谣仿真。
3. party：事件当事方（机构/企业/个人，可泛化为虚构名称，不要使用真实个人姓名），并给出其人设。
4. gov_dept：最相关的职能部门简称（如 市场监管局/教育局/应急管理局/文旅局 等）。
5. hashtags：4-6 个可能出现的微博话题词（不含#号），其中第一个为主话题。
6. seed_posts：3 条事件引爆阶段的初始帖子（author_role 取 netizen/media/kol），包含 content、stance(-1~1)、belief(对claim的支持度0~1)。
7. controversy(0~1 争议度)、sensitivity(0~1 敏感度)、negativity(0~1 负面程度)、category(社会/娱乐/科技/财经/教育/政务/国际/体育等)。

输出 JSON 格式：
{{"title":"","summary":"80字内事件概要","background":"150字内背景","category":"","stance_axis":{{"neg":"","pos":""}},
"claim":"","party":{{"name":"","persona":""}},"gov_dept":"","hashtags":[],"keywords":[],
"seed_posts":[{{"author_role":"","content":"","stance":0,"belief":0.5}}],
"controversy":0.5,"sensitivity":0.5,"negativity":0.5}}"""


def fallback_card(title: str, desc: str = "") -> dict:
    kw = title[:12]
    return {
        "title": title,
        "summary": desc or f"网络热议事件：{title}",
        "background": desc or f"围绕“{title}”的讨论在社交平台迅速发酵，网友观点分化。",
        "category": "社会",
        "stance_axis": {"neg": "质疑/批评当事方", "pos": "理解/支持当事方"},
        "claim": f"网传{kw}背后另有隐情且已造成严重后果",
        "party": {"name": f"{kw}相关方", "persona": "事件当事机构，希望尽快平息舆论，回应偏保守。"},
        "gov_dept": "相关部门",
        "hashtags": [title.strip("#")[:20], f"{kw}官方回应", f"{kw}最新进展", f"{kw}真相"],
        "keywords": [kw],
        "seed_posts": [
            {"author_role": "netizen", "content": f"刚刷到{title}，这是真的吗？太震惊了", "stance": -0.4, "belief": 0.7},
            {"author_role": "media", "content": f"【关注】{title}，本报记者正在核实", "stance": -0.1, "belief": 0.4},
            {"author_role": "kol", "content": f"关于{title}，大家先别急，等等权威信息", "stance": 0.1, "belief": 0.3},
        ],
        "controversy": 0.6, "sensitivity": 0.5, "negativity": 0.6,
    }


async def build_card(title: str, desc: str = "") -> dict:
    data = await llm.chat_json(SYSTEM, PROMPT.format(title=title, desc=desc or "无"), temperature=0.6, max_tokens=1200, tag="事件卡生成")
    card = fallback_card(title, desc)
    if isinstance(data, dict):
        for k, v in data.items():
            if v not in (None, "", [], {}):
                card[k] = v
        card["llm_generated"] = True
    card["source_title"] = title
    card["city"] = random.choice(CITIES)
    # 规范化
    card["hashtags"] = [h.strip("#").strip() for h in card.get("hashtags", []) if h][:6] or [title]
    for k in ("controversy", "sensitivity", "negativity"):
        try:
            card[k] = float(min(1, max(0, float(card.get(k, 0.5)))))
        except Exception:  # noqa: BLE001
            card[k] = 0.5
    return card
