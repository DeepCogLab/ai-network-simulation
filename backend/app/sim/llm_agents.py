"""大模型驱动的智能体：
1) 个体智能体 (政府/媒体/大V/专家/当事方/代表性网民)：感知-记忆-决策，输出具体平台行为；
2) 群体智能体 (网民社群“集体心智”)：以平均场方式推演一个社群的心态迁移，并生成评论语料池，
   由社群内的规则个体执行（LLM 负责“想什么”，规则负责“谁、何时、多少”）。
"""
from __future__ import annotations

from ..llm import llm

IND_SYSTEM = ("你在模拟一个虚构的中文社交平台“微言”（类似微博）上的真实账号。你必须严格保持人设与身份口吻，"
              "以第一人称决定下一步平台行为。禁止输出任何解释性文字，只输出 JSON。")

IND_PROMPT = """【你的账号】{name}（{role_label}，粉丝 {followers}）
【人设】{persona}
【你当前心理状态】立场 {op:+.2f}（-1={neg}，+1={pos}）；情绪唤醒 {aro:.2f}；对传言“{claim}”的相信度 {belief:.2f}
【事件】{title}：{summary}
【平台态势】现在是 {time}；主话题热搜：{rank}；全网立场均值 {mean_op:+.2f}；负面情绪占比 {neg_share:.0%}；传言相信率 {belief_rate:.0%}；舆情阶段：{stage}
【已发生的关键动态】{events}
【你最近的发言】{memory}
【你刷到的帖子】
{feed}

请决定你此刻的行为：post(发原创) / repost(转发某帖并附评论) / comment(评论某帖) / none(暂不发言)。
要求：符合人设和身份（政务号用规范通报语体，媒体号用新闻语体，大V有个人风格，网民口语化），贴合事件进展，不超过120字，可带一个话题 #话题#（从 {tags} 中选）。避免与已有内容重复。
输出 JSON：{{"action":"post|repost|comment|none","target":帖子编号或null,"content":"","topic":"","stance":-1到1,"belief":0到1(你的内容对传言的支持度，0=明确否认/辟谣，0.5=未表态，1=证实/扩散传言),"emotion":"愤怒|悲伤|恐惧|惊讶|厌恶|喜悦|中性","arousal":0到1,"thought":"内心想法(30字内)"}}"""

GROUP_SYSTEM = ("你是社会心理学家，正在扮演一个网民社群的“集体心智”，推演其在社交平台上的群体反应。"
                "需体现从众、情绪传染、沉默的螺旋、群体极化等规律。只输出 JSON。")

GROUP_PROMPT = """【群体】{name}：{desc}
【规模】共 {n} 人，已卷入讨论 {engaged} 人
【群体状态】平均立场 {mean:+.2f}（-1={neg}，+1={pos}）；立场分布 反对{a:.0%}/中立{b:.0%}/支持{c:.0%}；情绪唤醒 {aro:.2f}；传言相信率 {bel:.0%}；对政务信任 {trust:.2f}
【事件】{title}：{summary}
【传言】{claim}
【现在】{time}，舆情阶段：{stage}，主话题热搜：{rank}
【最新关键动态】{events}
【群体成员正在刷的热门内容】
{feed}

请推演该群体在接下来一段时间的集体反应，并生成 6 条该群体成员可能发出的评论（立场应有分化、口语化、网络用语、各不相同、15-50字）。
输出 JSON：{{"mood":"群体心态(20字内)","stance_shift":-0.3到0.3,"arousal_shift":-0.3到0.3,"belief_shift":-0.3到0.3,"trust_gov_shift":-0.2到0.2,"participation":0到1,
"comments":[{{"text":"","stance":-1到1,"valence":-1到1,"emotion":"愤怒|悲伤|恐惧|惊讶|厌恶|喜悦|中性"}}]}}"""

DRAFT_PROMPT = """你是舆情应对专家。事件：{title}：{summary}
传言：{claim}
当前态势：舆情阶段 {stage}，立场均值 {mean_op:+.2f}，负面情绪 {neg_share:.0%}，传言相信率 {belief_rate:.0%}，政务公信力 {trust:.2f}。
立场轴：-1={neg}，+1={pos}。
请以“{actor}”（{role}）的身份，按策略“{goal}”撰写一条平台发布内容（150字内，符合身份语体），并预判效果。
输出 JSON：{{"content":"","stance":-1到1(内容在立场轴上的位置),"belief":0到1(内容对传言的支持度，0=辟谣否认，1=证实),"predicted_effect":"预判效果(60字内)","risk":"潜在风险(40字内)"}}"""


async def individual_decide(ctx: dict) -> dict | None:
    return await llm.chat_json(IND_SYSTEM, IND_PROMPT.format(**ctx), temperature=0.85, max_tokens=400, tag=f"个体·{ctx['name']}")


async def group_decide(ctx: dict) -> dict | None:
    return await llm.chat_json(GROUP_SYSTEM, GROUP_PROMPT.format(**ctx), temperature=0.9, max_tokens=900, tag=f"群体·{ctx['name']}")


async def draft_statement(ctx: dict) -> dict | None:
    return await llm.chat_json("你是政务与媒体传播专家。只输出 JSON。", DRAFT_PROMPT.format(**ctx), temperature=0.6, max_tokens=500, tag="干预文案")


def clamp(v, lo, hi, default=0.0) -> float:
    try:
        return float(min(hi, max(lo, float(v))))
    except Exception:  # noqa: BLE001
        return default
