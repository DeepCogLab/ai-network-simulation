"""舆情研判报告生成（大模型 + 规则兜底）。"""
from __future__ import annotations

from .llm import llm
from .sim.personas import COMMUNITIES

SYSTEM = "你是政府舆情研判中心的首席分析师，撰写专业、结构清晰、可执行的舆情研判报告。只输出 JSON。"

PROMPT = """以下是一次社交平台舆情仿真推演的数据，请撰写研判报告。
【事件】{title}：{summary}
【传言】{claim}
【推演时长】{span}，共 {n} 个智能体
【关键指标】峰值热度 {peak:,}（{peak_time}），最高热搜排名 {best_rank}，参与人数 {part}，累计内容 {posts}
最终：立场均值 {op:+.2f}（-1={neg}，+1={pos}），极化指数 {pol:.2f}，负面情绪占比 {negs:.0%}，传言相信率 {bel:.0%}（峰值 {bel_peak:.0%}），政务公信力 {tg:.2f}（初始 {tg0:.2f}），回音室指数 {echo:.2f}，最大级联 {casc}，结构病毒性 {vir}
【舆情阶段轨迹】{stages}
【关键事件时间线】
{events}
【各社群最终状态】{comms}
【意见领袖 TOP5】{leaders}

输出 JSON：{{"headline":"一句话研判结论","risk_level":"低|中|高|极高","overview":"事件与演化概述(150字)","phases":[{{"name":"阶段名","time":"时间段","desc":"特征"}}],
"key_findings":["发现1","发现2","发现3","发现4"],"intervention_review":"干预措施效果评价(100字)","risks":["风险1","风险2"],
"suggestions":[{{"target":"政府|媒体|平台","action":"建议"}}],"outlook":"后续走势预判(80字)"}}"""


async def build_report(sim) -> dict:
    H = sim.history
    peak = max(H, key=lambda h: h["heat"])
    ranks = [h["rank"] for h in H if h["rank"]]
    stages, last = [], None
    for h in H:
        if h["stage"] != last:
            stages.append(f"{h['time']} {h['stage']}")
            last = h["stage"]
    m = H[-1]
    ctx = dict(
        title=sim.card["title"], summary=sim.card["summary"], claim=sim.card["claim"], span=f"{H[0]['time']} ~ {m['time']}", n=sim.N,
        peak=peak["heat"], peak_time=peak["time"], best_rank=min(ranks) if ranks else "未上榜", part=m["participants"], posts=m["total_posts"],
        op=m["op_mean"], neg=sim.card["stance_axis"]["neg"], pos=sim.card["stance_axis"]["pos"], pol=m["polarization"], negs=m["neg_share"],
        bel=m["belief_rate"], bel_peak=max(h["belief_rate"] for h in H), tg=m["trust_gov"], tg0=H[0]["trust_gov"], echo=m.get("echo", 0),
        casc=m.get("max_cascade", 0), vir=m.get("virality", 0), stages=" → ".join(stages[-12:]),
        events="\n".join(f"{e['time']} {e['actor']}：{e['title']} {e['detail'][:50]}" for e in sim.events if e["actor"] != "系统")[-2500:],
        comms="；".join(f"{COMMUNITIES[c['c']]['name']} 立场{c['op']:+.2f} 相信率{c['bel']:.0%}" for c in m["communities"]),
        leaders="、".join(f"{l['name']}({l['role']})" for l in sim.leaders(5)),
    )
    data = await llm.chat_json(SYSTEM, PROMPT.format(**ctx), temperature=0.5, max_tokens=1800, tag="研判报告")
    if not isinstance(data, dict):
        risk = "高" if m["neg_share"] > 0.5 or m["belief_rate"] > 0.5 else ("中" if m["neg_share"] > 0.3 else "低")
        data = {
            "headline": f"事件热度峰值 {peak['heat']:,}，当前处于{m['stage']}，风险{risk}",
            "risk_level": risk,
            "overview": f"“{sim.card['title']}”在 {peak['time']} 达到热度峰值，累计 {m['participants']} 人参与讨论，当前立场均值 {m['op_mean']:+.2f}。",
            "phases": [{"name": s.split(" ", 2)[-1], "time": " ".join(s.split(" ")[:2]), "desc": ""} for s in stages[-6:]],
            "key_findings": [f"传言相信率峰值 {ctx['bel_peak']:.0%}，当前 {m['belief_rate']:.0%}", f"政务公信力由 {ctx['tg0']:.2f} 变为 {m['trust_gov']:.2f}",
                             f"极化指数 {m['polarization']:.2f}，回音室指数 {ctx['echo']:.2f}", f"最大转发级联 {ctx['casc']} 人"],
            "intervention_review": "（未启用大模型，基于规则生成）", "risks": ["负面情绪反弹", "次生话题衍生"],
            "suggestions": [{"target": "政府", "action": "在黄金4小时内发布权威通报并持续更新进展"}, {"target": "平台", "action": "对不实信息加注辟谣标签，避免简单删帖"}],
            "outlook": "若无新增刺激信息，舆情将逐步进入衰退期。",
        }
    data["metrics"] = {k: ctx[k] for k in ("peak", "peak_time", "best_rank", "part", "posts", "op", "pol", "negs", "bel", "bel_peak", "tg", "tg0", "echo", "casc", "vir")}
    data["generated_at"] = m["time"]
    return data
