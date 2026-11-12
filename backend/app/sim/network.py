"""社交网络生成。

方法：随机块模型(SBM, 社群同质性) + 偏好连接(BA, 无标度度分布) + 核心主体亲和关注。
- 网民以 75% 概率关注同社群用户（同质性 homophily），关注对象按“吸引力”幂律抽样（富者愈富）；
- 网民关注核心账号（媒体/大V/政务）的概率与“立场亲和度”及账号热度成正比，形成两级传播结构；
- 营销号大量关注他人、粉丝很少。
"""
from __future__ import annotations

import math

import networkx as nx
import numpy as np

from .personas import (BOT_PRE, COMMUNITIES, EXPERT_TEMPLATES, FIRST, GOV_TEMPLATES, KOL_TEMPLATES, MEDIA_TEMPLATES,
                       NICK_PRE, ROLES, SECOND)


def _nick(rng, used: set) -> str:
    for _ in range(20):
        n = rng.choice(NICK_PRE) + rng.choice(list(FIRST)) + rng.choice(SECOND)
        if rng.random() < 0.3:
            n += str(rng.integers(1, 999))
        if n not in used:
            used.add(n)
            return n
    n = f"用户{rng.integers(10**6, 10**7)}"
    used.add(n)
    return n


def build_population(cfg: dict, card: dict, rng: np.random.Generator) -> tuple[list[dict], nx.DiGraph]:
    agents: list[dict] = []
    used: set = set()
    city = card.get("city", "临江市")
    dept = card.get("gov_dept", "相关部门")

    def add(role, name, persona, lean=0.0, driver=None, community=-1, fscale=1.0):
        agents.append({
            "id": len(agents), "name": name, "role": role, "driver": driver or ROLES[role]["driver"], "persona": persona,
            "lean": float(lean), "community": community, "fscale": fscale, "verified": role in ("gov", "media", "kol", "expert", "party"),
        })

    for t in GOV_TEMPLATES[: cfg["n_gov"]]:
        add("gov", t["name"].format(city=city, dept=dept), t["persona"].format(city=city), 0.35, fscale=1.5)
    for t in MEDIA_TEMPLATES[: cfg["n_media"]]:
        add("media", t["name"], t["persona"], t["lean"], fscale=2.0)
    for t in KOL_TEMPLATES[: cfg["n_kol"]]:
        add("kol", t["name"], t["persona"], t["lean"], fscale=t["followers"])
    for t in EXPERT_TEMPLATES[: cfg["n_expert"]]:
        add("expert", t["name"], t["persona"], t["lean"], fscale=0.8)
    party = card.get("party") or {}
    add("party", party.get("name", "当事方")[:16], party.get("persona", "事件当事方"), 0.75, fscale=0.7)

    n_elite = len(agents)
    n_rest = max(50, cfg["n_agents"] - n_elite)
    n_bots = int(n_rest * cfg["bot_ratio"])
    n_net = n_rest - n_bots
    comms = COMMUNITIES[: cfg["n_communities"]]
    w = np.array([0.24, 0.2, 0.14, 0.2, 0.13, 0.09][: len(comms)])
    w = w / w.sum()
    cids = rng.choice(len(comms), size=n_net, p=w)
    llm_slots = set(rng.choice(n_net, size=min(cfg["llm_netizens"], n_net), replace=False).tolist()) if cfg["llm_enabled"] else set()
    for i in range(n_net):
        c = comms[cids[i]]
        drv = "llm" if i in llm_slots else "rule"
        add("netizen", _nick(rng, used), f"普通网民，属于“{c['name']}”：{c['desc']}", c["mu"], driver=drv, community=int(cids[i]))
    for _ in range(n_bots):
        add("bot", rng.choice(BOT_PRE) + str(rng.integers(10, 9999)), "以流量为目的的营销号/水军账号，批量转发带节奏内容。", cfg["bot_stance"])

    # ---------------- 关注关系 ----------------
    N = len(agents)
    G = nx.DiGraph()
    G.add_nodes_from(range(N))
    roles = np.array([a["role"] for a in agents])
    comm = np.array([a["community"] for a in agents])
    net_idx = np.where(roles == "netizen")[0]
    bot_idx = np.where(roles == "bot")[0]
    elite_idx = np.arange(n_elite)
    fitness = rng.pareto(1.6, N) + 0.2  # 吸引力服从幂律 -> 偏好连接

    by_comm = {c: net_idx[comm[net_idx] == c] for c in range(len(comms))}
    for i in net_idx:
        k = int(np.clip(rng.lognormal(math.log(14), 0.6), 3, 120))
        same = by_comm[comm[i]]
        k_in = min(int(k * 0.75), len(same) - 1)
        if k_in > 0:
            p = fitness[same] / fitness[same].sum()
            for j in rng.choice(same, size=k_in, replace=False, p=p):
                if j != i:
                    G.add_edge(i, int(j))
        others = net_idx[comm[net_idx] != comm[i]]
        k_out = k - k_in
        if k_out > 0 and len(others):
            p = fitness[others] / fitness[others].sum()
            for j in rng.choice(others, size=min(k_out, len(others)), replace=False, p=p):
                G.add_edge(i, int(j))
        # 关注核心账号：亲和度 * 账号热度
        mu = comms[comm[i]]["mu"]
        for e in elite_idx:
            a = agents[e]
            aff = math.exp(-abs(a["lean"] - mu) * 1.2)
            base = {"gov": 0.18, "media": 0.3, "kol": 0.28, "expert": 0.1, "party": 0.06}[a["role"]]
            if rng.random() < base * aff * a["fscale"]:
                G.add_edge(i, int(e))
    for b in bot_idx:
        for j in rng.choice(N, size=min(N - 1, int(rng.integers(40, 120))), replace=False):
            if j != b:
                G.add_edge(int(b), int(j))
        # 少量网民误关注营销号
        for j in rng.choice(net_idx, size=int(rng.integers(2, 12)), replace=False):
            G.add_edge(int(j), int(b))
    # 核心账号之间：媒体/大V关注政务与媒体
    for e in elite_idx:
        for f in elite_idx:
            if e != f and agents[f]["role"] in ("gov", "media") and rng.random() < 0.6:
                G.add_edge(int(e), int(f))
    # 网民之间少量互关，提高互惠性
    for u, v in list(G.edges()):
        if roles[u] == "netizen" and roles[v] == "netizen" and rng.random() < 0.25:
            G.add_edge(v, u)

    pr = nx.pagerank(G.reverse(copy=False), alpha=0.85, max_iter=60, tol=1e-5)  # 被关注越多影响力越高
    prv = np.array([pr[i] for i in range(N)])
    infl = prv / prv.max()
    indeg = np.array([G.in_degree(i) for i in range(N)])
    scale = {"gov": 4200, "media": 9000, "kol": 6000, "expert": 1800, "party": 1500, "netizen": 18, "bot": 9}
    for a in agents:
        i = a["id"]
        a["influence"] = float(infl[i])
        a["followers"] = int(indeg[i] * scale[a["role"]] * (0.7 + 0.6 * rng.random()) + rng.integers(0, 50))
        a["following"] = int(G.out_degree(i))
    return agents, G
