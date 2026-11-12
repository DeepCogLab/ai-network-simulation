"""舆情仿真引擎（混合智能体 ABM）。

每个仿真步（默认 1 小时）依次执行：
 1. 处理干预指令（发布/辟谣/删帖/禁言/限流/热搜操作/算法切换/清理水军/信息注入）
 2. 更新话题热度与热搜榜 -> 议程设置显著度 salience
 3. 规则智能体：Hawkes 自激活跃 -> 推荐算法生成信息流 -> 曝光(SEIR) ->
    有界信任观点更新(Deffuant/HK) + 情绪传染 + 信任加权信念更新(塔西佗效应) ->
    沉默的螺旋 -> 独立级联/阈值式转发与评论
 4. 大模型个体智能体（政务/媒体/大V/专家/当事方/代表性网民）并发决策
 5. 大模型群体智能体（社群集体心智）周期性推演，驱动社群心态迁移并生成语料池
 6. SEIR 衰减、情绪回落、政务沉默导致的公信力流失
 7. 计算指标
"""
from __future__ import annotations

import asyncio
import copy
import datetime as dt
import math
import random
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field

import numpy as np

from ..llm import llm
from . import llm_agents as LA
from .metrics import EMOTIONS, bimodality, emotion_of, esteban_ray, gini, lifecycle, structural_virality
from .network import build_population
from .personas import COMMUNITIES, ROLES, TEMPLATES

S, E, I, R = 0, 1, 2, 3
CIRC = [0.5, 0.3, 0.2, 0.15, 0.15, 0.2, 0.4, 0.7, 0.9, 1.0, 1.0, 1.1, 1.25, 1.1, 1.0, 1.0, 1.0, 1.05, 1.15, 1.3, 1.45, 1.5, 1.35, 0.9]

DEFAULT_CFG = dict(
    n_agents=1000, n_gov=3, n_media=5, n_kol=8, n_expert=2, n_communities=6,
    bot_ratio=0.03, bot_stance=-0.8,
    llm_enabled=True, llm_netizens=6, max_llm_per_tick=6, group_interval=2,
    tick_minutes=60, seed=42,
    algorithm="hot",          # timeline / hot / personalized / diverse
    epsilon=0.5,              # 有界信任阈值
    mu=0.2,                   # 观点收敛速率
    backfire=0.05,            # 逆火效应强度
    silence=0.6,              # 沉默的螺旋强度
    gamma=0.1,                # I->R 兴趣衰减
    feed_k=6,
    gov_auto=True,            # 政务账号是否由 AI 自主回应（关闭则仅由用户扮演）
    streisand=0.6,            # 删帖引发的史翠珊效应强度
    alpha_notify=0.03,        # Hawkes 自激强度
)


@dataclass(slots=True)
class Post:
    id: int
    author: int
    tick: int
    kind: str  # post / repost / comment
    content: str
    stance: float
    valence: float
    arousal: float
    belief: float
    emotion: str
    topic: int
    parent: int | None
    root: int
    depth: int
    source: str
    likes: int = 0
    reposts: int = 0
    comments: int = 0
    views: int = 0
    deleted: bool = False
    boosted: int = 0
    pinned: bool = False
    official: bool = False
    debunk: bool = False
    intervention: bool = False
    top_comment: int | None = None
    children: list = field(default_factory=list)


class Simulation:
    def __init__(self, card: dict, cfg: dict | None = None, background: list[dict] | None = None):
        self.cfg = {**DEFAULT_CFG, **(cfg or {})}
        if not llm.enabled:
            self.cfg["llm_enabled"] = False
        self.use_llm = self.cfg["llm_enabled"]
        self.card = card
        self.rng = np.random.default_rng(self.cfg["seed"])
        random.seed(self.cfg["seed"])
        self.agents, self.G = build_population(self.cfg, card, self.rng)
        N = self.N = len(self.agents)
        self.roles = np.array([a["role"] for a in self.agents])
        self.comm = np.array([a["community"] for a in self.agents])
        self.driver = np.array([a["driver"] for a in self.agents])
        self.infl = np.array([a["influence"] for a in self.agents])
        self.following = [np.array(sorted(self.G.successors(i)), dtype=np.int32) for i in range(N)]
        self.followers = [np.array(list(self.G.predecessors(i)), dtype=np.int32) for i in range(N)]
        rng = self.rng
        lean = np.array([a["lean"] for a in self.agents])
        cm = [COMMUNITIES[c] if c >= 0 else None for c in self.comm]
        self.op = np.clip(lean + rng.normal(0, 0.28, N) * (self.roles == "netizen"), -1, 1)
        self.op0 = self.op.copy()
        self.aro_base = np.array([c["aro"] if c else 0.3 for c in cm]) * (0.6 + 0.8 * rng.random(N))
        self.aro = self.aro_base.copy()
        self.val = np.zeros(N)
        self.bel = np.clip(0.4 - 0.25 * self.op + 0.15 * rng.normal(size=N), 0.05, 0.95)
        self.tg = np.clip(np.array([c["trust"] if c else 0.7 for c in cm]) + rng.normal(0, 0.12, N), 0.02, 0.98)
        self.tm = np.clip(self.tg * 0.8 + 0.15 + rng.normal(0, 0.1, N), 0.02, 0.98)
        self.conf = np.clip(np.array([c["conf"] if c else 0.2 for c in cm]) + rng.normal(0, 0.12, N), 0, 1)
        self.eps = np.clip(self.cfg["epsilon"] + rng.normal(0, 0.12, N), 0.1, 1.5)
        self.stub = np.clip(rng.beta(2, 5, N) + (self.roles != "netizen") * 0.4, 0, 0.95)
        self.invol = (self.comm == 5) * 0.6 + rng.random(N) * 0.2
        self.act = np.array([ROLES[r]["act"] for r in self.roles]) * (0.4 + 1.2 * rng.random(N))
        self.state = np.zeros(N, dtype=np.int8)
        self.exc = np.zeros(N)
        self.muted_until = np.zeros(N, dtype=np.int32)
        self.engaged = np.zeros(N, dtype=bool)
        self.recv = np.zeros(N)  # 收到的互动数（意见领袖识别）
        self.silenced = 0
        self.part_bonus = defaultdict(float)  # 群体参与意愿
        self.tick = 0
        self.start = dt.datetime.now().replace(minute=0, second=0, microsecond=0)
        self.posts: list[Post] = []
        self.feedable: list[int] = []
        self.pool: dict[int, list[dict]] = defaultdict(list)
        self.moods: dict[int, dict] = {}
        self.thoughts: list[dict] = []
        self.events: list[dict] = []
        self.history: list[dict] = []
        self.queue: list[dict] = []
        self.throttle: dict | None = None
        self.memory: dict[int, list[str]] = defaultdict(list)
        self.interactions: list[tuple] = []  # (actor, target_author, tick, kind)
        self.new_post_ids: list[int] = []
        self.gov_responded_tick: int | None = None
        self.first_media_tick: int | None = None
        self.trending_ticks = 0
        self.best_rank = 99
        self.cache: dict = {}
        # 话题：事件相关 + 真实热搜背景
        self.topics = [{"name": h, "kind": "event", "raw": 0.0, "heat": 0, "hidden": False, "pinned": False, "born": 0}
                       for h in card["hashtags"]]
        for b in (background or [])[:30]:
            if b.get("hot"):
                self.topics.append({"name": b["title"], "kind": "bg", "raw": 0.0, "heat": int(b["hot"]), "base": int(b["hot"]),
                                    "hidden": False, "pinned": False, "born": 0, "label": b.get("label", "")})
        if not any(t["kind"] == "bg" for t in self.topics):
            for i, nm in enumerate(["周末去哪儿玩", "新剧开播口碑", "今日油价调整", "明星官宣恋情", "高校食堂测评", "球队绝杀晋级"]):
                self.topics.append({"name": nm, "kind": "bg", "raw": 0.0, "heat": 900000 - i * 110000, "base": 900000 - i * 110000,
                                    "hidden": False, "pinned": False, "born": 0, "label": ""})
        self.board: list[dict] = []
        self.salience = 0.0
        self.sample_idx = rng.choice(np.where(self.roles == "netizen")[0], size=min(240, int((self.roles == "netizen").sum())), replace=False)
        self.traj: list[list[float]] = []
        edges = np.array([(u, v) for u, v in self.G.edges() if self.roles[u] == "netizen" and self.roles[v] == "netizen"])
        self.net_edges = edges[rng.choice(len(edges), size=min(4000, len(edges)), replace=False)] if len(edges) else edges
        self.heat_scale = 5200 * 1000 / max(300, N)
        self._seed_posts()
        self._log("系统", "仿真开始", f"事件“{card['title']}”进入平台，初始帖子 {len(self.posts)} 条")
        self._update_board()
        self._metrics()

    # ------------------------------------------------------------------ utils
    def now(self, tick: int | None = None) -> dt.datetime:
        return self.start + dt.timedelta(minutes=self.cfg["tick_minutes"] * (self.tick if tick is None else tick))

    def tlabel(self, tick: int | None = None) -> str:
        t = self.now(tick)
        d = (t.date() - self.start.date()).days + 1
        return f"D{d} {t:%H:%M}"

    def _log(self, actor: str, title: str, detail: str = "", kind: str = "info"):
        self.events.append({"tick": self.tick, "time": self.tlabel(), "actor": actor, "title": title, "detail": detail, "kind": kind})

    def _weight(self, a: int) -> float:
        return 0.3 + 0.7 * math.sqrt(self.infl[a]) * ROLES[self.roles[a]]["weight"] / 2.2

    def _topic_idx(self, name: str | None) -> int:
        if not name:
            return 0
        name = name.strip().strip("#")
        for i, t in enumerate(self.topics):
            if t["kind"] == "event" and (t["name"] == name or name in t["name"] or t["name"] in name):
                return i
        ev = [t for t in self.topics if t["kind"] == "event"]
        if len(ev) < 10 and 2 <= len(name) <= 24:
            self.topics.insert(len(ev), {"name": name, "kind": "event", "raw": 0.0, "heat": 0, "hidden": False, "pinned": False, "born": self.tick})
            self._log("平台", "新话题涌现", f"#{name}#")
            return len(ev)
        return 0

    def _rand_topic(self) -> int:
        ev = [i for i, t in enumerate(self.topics) if t["kind"] == "event"]
        w = np.array([3.0 if i == 0 else 1.0 / (1 + 0.3 * k) for k, i in enumerate(ev)])
        return int(self.rng.choice(ev, p=w / w.sum()))

    # ------------------------------------------------------------------ posting
    def _new_post(self, author: int, kind: str, content: str, stance: float, *, valence=None, arousal=None, belief=None,
                  emotion=None, topic=None, parent: int | None = None, source="rule", **flags) -> Post:
        stance = float(np.clip(stance, -1, 1))
        if valence is None:
            valence = float(np.clip(0.6 * stance - 0.3 * self.aro[author] + self.rng.normal(0, 0.15), -1, 1)) if kind != "like" else 0
        if arousal is None:
            arousal = float(self.aro[author])
        belief = float(self.bel[author] if belief is None else np.clip(belief, 0, 1))
        emotion = emotion if emotion in EMOTIONS else emotion_of(valence, arousal, self.rng)
        par = self.posts[parent] if parent is not None else None
        if topic is None:
            topic = par.topic if par else self._rand_topic()
        p = Post(id=len(self.posts), author=author, tick=self.tick, kind=kind, content=content[:300], stance=stance,
                 valence=float(valence), arousal=float(arousal), belief=belief, emotion=emotion, topic=topic, parent=parent,
                 root=par.root if par else len(self.posts), depth=(par.depth + 1) if (par and kind == "repost") else (par.depth if par else 0),
                 source=source, **flags)
        self.posts.append(p)
        self.new_post_ids.append(p.id)
        if par:
            par.children.append(p.id)
            if kind == "repost":
                par.reposts += 1
                if par.root != par.id:
                    self.posts[par.root].reposts += 1
            else:
                par.comments += 1
                if par.top_comment is None or self.infl[author] > self.infl[self.posts[par.top_comment].author]:
                    par.top_comment = p.id
            self.recv[par.author] += 1
            self.exc[par.author] += 0.05
            self.interactions.append((author, par.author, self.tick, kind))
        if kind in ("post", "repost"):
            self.feedable.append(p.id)
            fl = self.followers[author]
            if len(fl):
                self.exc[fl] += self.cfg["alpha_notify"] * (0.5 + self.infl[author])
        self.engaged[author] = True
        if self.state[author] < I:
            self.state[author] = I
        if self.roles[author] == "gov" and self.gov_responded_tick is None and kind != "comment":
            self.gov_responded_tick = self.tick
            self._log(self.agents[author]["name"], "政务首次回应", content[:60], "gov")
        if self.roles[author] == "media" and self.first_media_tick is None:
            self.first_media_tick = self.tick
            self._log(self.agents[author]["name"], "媒体介入报道", content[:60], "media")
        return p

    def _seed_posts(self):
        kw = (self.card.get("keywords") or [self.card["title"]])[0]
        for sp in self.card.get("seed_posts", [])[:4]:
            role = sp.get("author_role", "netizen")
            cands = np.where(self.roles == role)[0]
            if role == "netizen":
                cands = cands[self.driver[cands] == "rule"]
            if not len(cands):
                cands = np.where(self.roles == "netizen")[0]
            a = int(cands[np.argmax(self.infl[cands] * self.rng.random(len(cands)))])
            self._new_post(a, "post", sp.get("content", kw), LA.clamp(sp.get("stance", -0.3), -1, 1),
                           belief=LA.clamp(sp.get("belief", 0.6), 0, 1), arousal=0.7, topic=0, source="seed")
        if not self.posts:
            a = int(np.where(self.roles == "netizen")[0][0])
            self._new_post(a, "post", f"#{self.card['hashtags'][0]}# {self.card['summary']}", -0.3, topic=0, source="seed")

    # ------------------------------------------------------------------ board
    def _update_board(self):
        t = self.tick
        raw = defaultdict(float)
        for pid in self.new_post_ids_window():
            p = self.posts[pid]
            if p.deleted:
                continue
            age = t - p.tick
            raw[p.topic] += (1 + 0.25 * p.likes + 1.2 * p.comments + 1.6 * p.reposts) * math.exp(-age / 5)
        for i, tp in enumerate(self.topics):
            if tp["kind"] == "event":
                tp["raw"] = raw.get(i, 0.0)
                tp["heat"] = int(tp["raw"] * self.heat_scale)
            else:
                drift = math.exp(-0.035 * t) * (1 + 0.08 * self.rng.normal())
                tp["heat"] = int(tp["base"] * max(0.2, drift))
        vis = [(i, tp) for i, tp in enumerate(self.topics) if not tp["hidden"] and tp["heat"] > 0]
        vis.sort(key=lambda x: (not x[1]["pinned"], -x[1]["heat"]))
        self.board = [{"rank": r + 1, "idx": i, "name": tp["name"], "heat": tp["heat"], "kind": tp["kind"], "pinned": tp["pinned"],
                       "label": ("新" if tp["kind"] == "event" and t - tp["born"] <= 2 else ("爆" if tp["heat"] > 2.5e6 else ("热" if tp["heat"] > 1.2e6 else tp.get("label", ""))))}
                      for r, (i, tp) in enumerate(vis[:50])]
        main = next((b for b in self.board if b["idx"] == 0), None)
        rank = main["rank"] if main else 99
        if self.topics[0]["hidden"]:
            self.salience = 0.0
        else:
            ev_best = min([b["rank"] for b in self.board if b["kind"] == "event"] or [99])
            self.salience = max(0.0, 1 - (ev_best - 1) / 30) if ev_best <= 30 else 0.0
        if rank <= 50:
            self.trending_ticks += 1
        for th in (50, 10, 3, 1):
            if rank <= th < self.best_rank:
                self._log("平台", f"主话题登上热搜{'榜首' if th == 1 else f'前{th}'}", f"#{self.topics[0]['name']}# 热度 {self.topics[0]['heat']:,}", "hot")
                self.best_rank = th
                break

    def new_post_ids_window(self):
        lo = 0
        # 仅统计最近 10 步内的帖子
        for k in range(len(self.posts) - 1, -1, -1):
            if self.tick - self.posts[k].tick > 10:
                lo = k + 1
                break
        return range(lo, len(self.posts))

    # ------------------------------------------------------------------ feed / recommender
    def _candidates(self):
        t = self.tick
        ids = [pid for pid in self.feedable if not self.posts[pid].deleted and t - self.posts[pid].tick <= 14]
        self.feedable = ids
        if not ids:
            return None
        P = self.posts
        eng = np.array([P[i].likes + 3 * P[i].reposts + 2 * P[i].comments for i in ids], dtype=float)
        age = np.array([t - P[i].tick for i in ids], dtype=float)
        if len(ids) > 500:
            keep = np.argsort(-(np.log1p(eng) + 2 * np.exp(-age / 3)))[:500]
            ids = [ids[k] for k in keep]
            eng, age = eng[keep], age[keep]
        thr = np.zeros(len(ids))
        if self.throttle and self.throttle["until"] >= t:
            lo, hi = self.throttle["range"]
            thr = np.array([1.0 if lo <= P[i].stance <= hi and not P[i].official else 0.0 for i in ids])
        return {
            "ids": np.array(ids), "author": np.array([P[i].author for i in ids]), "stance": np.array([P[i].stance for i in ids]),
            "eng": eng, "age": age, "boost": np.array([P[i].boosted + (5 if P[i].pinned else 0) for i in ids], dtype=float),
            "thr": thr, "infl": np.array([self.infl[P[i].author] for i in ids]),
        }

    def _feed(self, i: int, C: dict, k: int | None = None, alg: str | None = None) -> list[int]:
        if C is None:
            return []
        k = k or self.cfg["feed_k"]
        alg = alg or self.cfg["algorithm"]
        fol = np.isin(C["author"], self.following[i])
        rec = np.exp(-C["age"] / 4)
        pop = np.log1p(C["eng"])
        if alg == "timeline":
            s = 3 * fol + 2 * rec + 0.15 * pop
            reach = 0.08
        elif alg == "personalized":
            sim = 1 - np.abs(self.op[i] - C["stance"]) / 2
            s = 1.5 * fol + rec + 0.6 * pop + 3.2 * sim ** 2
            reach = 0.45
        elif alg == "diverse":
            s = 1.2 * fol + rec + 0.7 * pop + 1.6 * np.abs(self.op[i] - C["stance"]) / 2 + 0.6 * C["infl"]
            reach = 0.4
        else:  # hot
            s = 1.5 * fol + rec + 0.8 * pop + 0.5 * C["infl"]
            reach = 0.32
        s = s + 3 * C["boost"] - 3.5 * C["thr"] + self.rng.gumbel(0, 0.4, len(s))
        # 议程设置：热搜显著度越高，非关注内容触达率越高
        if self.rng.random() > min(0.95, reach + 0.55 * self.salience):
            elig = fol | (C["boost"] > 0)
            if not elig.any():
                return []
            s = np.where(elig, s, -1e9)
        idx = np.argsort(-s)[:k]
        return [int(C["ids"][j]) for j in idx if s[j] > -1e8 and C["author"][j] != i]

    # ------------------------------------------------------------------ exposure dynamics
    def _expose(self, i: int, feed: list[int]) -> float:
        """对 agent i 施加信息流影响，返回感知到的“意见气候”。"""
        if not feed:
            return self.op[i]
        P = self.posts
        cfg = self.cfg
        if self.state[i] == S:
            self.state[i] = E
        elif self.state[i] == R and self.rng.random() < 0.12 + 0.3 * self.salience:
            self.state[i] = E
        clim_num = clim_den = 0.0
        items = []
        for pid in feed:
            p = P[pid]
            items.append((p, 1.0))
            if p.top_comment is not None and not P[p.top_comment].deleted:
                items.append((P[p.top_comment], 0.5))  # 评论区效应
        for p, wt in items:
            p.views += 1
            a = p.author
            w = self._weight(a) * wt
            clim_num += w * p.stance * (1 + math.log1p(p.likes))
            clim_den += w * (1 + math.log1p(p.likes))
            d = p.stance - self.op[i]
            if abs(d) < self.eps[i]:
                self.op[i] += cfg["mu"] * (1 - self.stub[i]) * w * d
            elif cfg["backfire"] > 0:
                self.op[i] -= cfg["backfire"] * w * np.sign(d) * self.aro[i]
            self.aro[i] += 0.12 * w * (p.arousal - self.aro[i])
            self.val[i] += 0.15 * w * (p.valence - self.val[i])
            role = self.roles[a]
            if role in ("gov", "party") or p.official:
                tr = self.tg[i]
                if tr > 0.35 or p.belief > 0.5:
                    self.bel[i] += 0.32 * tr * (p.belief - self.bel[i])
                    self.tg[i] += 0.008
                else:  # 塔西佗陷阱：低信任时，官方否认反而强化传言
                    self.bel[i] += 0.10 * (1 - tr) * (1 - self.bel[i]) * (p.belief < 0.4)
                    self.tg[i] -= 0.01
            elif role in ("media", "expert"):
                tr = self.tm[i]
                self.bel[i] += 0.22 * tr * (p.belief - self.bel[i])
            else:
                self.bel[i] += 0.14 * w * (p.belief - self.bel[i]) * (0.6 + self.aro[i])
            if self.rng.random() < 0.08 and abs(d) < 0.5:
                p.likes += 1
        self.op[i] = float(np.clip(self.op[i], -1, 1))
        self.aro[i] = float(np.clip(self.aro[i], 0, 1))
        self.bel[i] = float(np.clip(self.bel[i], 0, 1))
        self.tg[i] = float(np.clip(self.tg[i], 0.01, 0.99))
        return clim_num / clim_den if clim_den else self.op[i]

    def _rule_text(self, i: int, stance: float) -> tuple[str, str]:
        c = int(self.comm[i])
        pool = self.pool.get(c) or []
        if pool and self.rng.random() < 0.85:
            ds = sorted(pool[-30:], key=lambda x: abs(x["stance"] - stance) + 0.3 * self.rng.random())
            pick = ds[int(self.rng.integers(0, min(4, len(ds))))]
            return pick["text"], "llm_group"
        kw = (self.card.get("keywords") or [self.card["title"][:8]])[0]
        bucket = "neg" if stance < -0.25 else ("pos" if stance > 0.25 else "neu")
        return str(self.rng.choice(TEMPLATES[bucket])).format(kw=kw), "template"

    def _rule_act(self, i: int, feed: list[int], climate: float):
        P = self.posts
        role = self.roles[i]
        if role == "bot":
            if self.rng.random() > 0.7:
                return
            same = [pid for pid in feed if P[pid].stance * self.cfg["bot_stance"] > 0]
            tp = self.posts[same[0]] if same else None
            tag = self.topics[tp.topic if tp else 0]["name"]
            if tp and self.rng.random() < 0.7:
                self._new_post(i, "repost", f"#{tag}# 扩散！！大家都来看看", self.cfg["bot_stance"], parent=tp.id, arousal=0.85, belief=0.85, source="bot")
            else:
                txt, _ = self._rule_text(i, self.cfg["bot_stance"])
                self._new_post(i, "post", f"#{tag}# {txt}【转发越多越好】", self.cfg["bot_stance"], arousal=0.85, belief=0.9, topic=0, source="bot")
            return
        dis = abs(self.op[i] - climate) / 2
        will = float(np.clip(1 - self.cfg["silence"] * self.conf[i] * max(0, dis - 0.2) * 2.5, 0.05, 1))
        z = -2.7 + 2.6 * self.aro[i] + 1.1 * self.salience + 0.7 * (self.state[i] == I) + 1.3 * self.invol[i] + self.part_bonus[int(self.comm[i])]
        p_eng = 1 / (1 + math.exp(-z))
        if self.rng.random() > p_eng:
            return
        if self.rng.random() > will:
            self.silenced += 1  # 因感知自己处于少数而选择沉默
            return
        if not feed:
            return
        a = self.aro[i]
        w = np.array([0.5, 0.22, 0.17 * (0.6 + a), 0.11 * (0.6 + a)])
        act = self.rng.choice(["like", "comment", "repost", "post"], p=w / w.sum())
        st = np.array([P[pid].stance for pid in feed])
        sim = (1 - np.abs(self.op[i] - st) / 2) ** 2
        if act == "comment" and self.rng.random() < 0.3 * a:
            sim = 1 - sim + 0.05  # 情绪高涨时去“对线”
        pw = sim * np.array([(0.5 + P[pid].arousal) * (0.4 + self.infl[P[pid].author]) for pid in feed]) + 1e-6
        tgt = P[feed[int(self.rng.choice(len(feed), p=pw / pw.sum()))]]
        self.engaged[i] = True
        self.state[i] = I
        if act == "like":
            tgt.likes += 1
            self.recv[tgt.author] += 0.2
            return
        stance = float(np.clip(self.op[i] + self.rng.normal(0, 0.1), -1, 1))
        txt, src = self._rule_text(i, stance)
        if act == "comment":
            self._new_post(i, "comment", txt, stance, parent=tgt.id, source=src)
        elif act == "repost":
            body = txt if self.rng.random() < 0.6 else "转发微博"
            self._new_post(i, "repost", body, 0.6 * tgt.stance + 0.4 * stance, parent=tgt.id, belief=0.5 * (tgt.belief + self.bel[i]), source=src)
        else:
            tag = self.topics[self._rand_topic()]["name"]
            self._new_post(i, "post", f"#{tag}# {txt}", stance, source=src, topic=self._topic_idx(tag))

    # ------------------------------------------------------------------ LLM agents
    def _ctx_common(self) -> dict:
        h = self.history[-1] if self.history else {}
        main = next((b for b in self.board if b["idx"] == 0), None)
        ev = [f"[{e['time']}] {e['actor']}：{e['title']}" + (f"（{e['detail'][:40]}）" if e["detail"] else "") for e in self.events[-6:] if e["actor"] != "系统"]
        return dict(
            title=self.card["title"], summary=self.card["summary"], claim=self.card["claim"],
            neg=self.card["stance_axis"]["neg"], pos=self.card["stance_axis"]["pos"], time=self.now().strftime("%m月%d日 %H:%M"),
            rank=f"第{main['rank']}名(热度{main['heat']:,})" if main else ("已撤下" if self.topics[0]["hidden"] else "未上榜"),
            mean_op=h.get("op_mean", 0), neg_share=h.get("neg_share", 0), belief_rate=h.get("belief_rate", 0), stage=h.get("stage", "潜伏期"),
            events="；".join(ev) or "暂无", tags="、".join(f"#{t['name']}#" for t in self.topics if t["kind"] == "event"),
        )

    def _fmt_feed(self, feed: list[int]) -> str:
        lines = []
        for pid in feed:
            p = self.posts[pid]
            a = self.agents[p.author]
            body = p.content
            if p.kind == "repost" and p.parent is not None:
                body += f" //转发自 @{self.agents[self.posts[p.parent].author]['name']}: {self.posts[p.parent].content[:50]}"
            lines.append(f"[{pid}] @{a['name']}({ROLES[a['role']]['label']}) 转{p.reposts} 评{p.comments} 赞{p.likes}：{body[:110]}")
        return "\n".join(lines) or "（暂无相关内容）"

    def _select_llm_agents(self) -> list[int]:
        hr = self.now().hour
        cands = []
        for e in np.where(self.driver == "llm")[0]:
            if self.muted_until[e] > self.tick:
                continue
            role = self.roles[e]
            base = ROLES[role]["act"] * CIRC[hr]
            p = base * (0.4 + 1.8 * self.salience) + min(0.5, self.exc[e] * 0.3)
            if role == "gov":
                if not self.cfg["gov_auto"]:
                    continue
                if self.gov_responded_tick is None:
                    p = 0.01 + (0.22 if self.salience > 0.6 and self.trending_ticks >= 5 else 0) + 0.15 * (self.trending_ticks >= 10)
                else:
                    p = 0.06 + 0.1 * self.salience
            elif role == "party":
                p = 0.03 + (0.3 if self.salience > 0.4 else 0) * (1 if len(self.memory[e]) < 2 else 0.3)
            elif role == "netizen" and self.state[e] == S:
                continue
            if self.rng.random() < p:
                cands.append(int(e))
        pr = {"gov": 0, "party": 1, "media": 2, "kol": 3, "expert": 4, "netizen": 5}
        cands.sort(key=lambda e: (pr.get(self.roles[e], 9), -self.infl[e]))
        return cands[: self.cfg["max_llm_per_tick"]]

    def _llm_fallback(self, e: int, feed: list[int]) -> dict:
        role = self.roles[e]
        c = self.card
        tag = c["hashtags"][0]
        city = c.get("city", "")
        if role == "gov":
            return {"action": "post", "content": f"【情况通报】近日，网传“{c['claim'][:30]}”引发关注。我{c.get('gov_dept','')}高度重视，已第一时间成立工作组开展调查，目前未发现网传严重情况，后续进展将及时向社会公布。请广大网民不信谣、不传谣。", "stance": 0.35, "belief": 0.15, "emotion": "中性", "arousal": 0.2, "thought": "需要尽快回应关切，稳定情绪"}
        if role == "party":
            return {"action": "post", "content": f"关于近期网络上有关我方的信息，我们高度重视并已启动内部核查，将积极配合有关部门调查，给公众一个交代。", "stance": 0.7, "belief": 0.2, "emotion": "中性", "arousal": 0.3, "thought": "先稳住，表态配合"}
        if role == "media":
            return {"action": "post", "content": f"#{tag}#【追踪】{c['summary'][:60]}……记者已联系{city}相关部门，正在进一步核实。", "stance": self.op[e], "belief": 0.4, "emotion": "中性", "arousal": 0.4, "thought": "跟进报道"}
        stance = float(self.op[e])
        txt, _ = self._rule_text(e, stance) if self.comm[e] >= 0 else (str(self.rng.choice(TEMPLATES["neg" if stance < -0.25 else ("pos" if stance > 0.25 else "neu")])).format(kw=c["title"][:8]), "")
        act = "repost" if feed and self.rng.random() < 0.4 else "post"
        return {"action": act, "target": feed[0] if feed else None, "content": f"#{tag}# {txt}", "stance": stance, "belief": float(self.bel[e]), "arousal": float(self.aro[e]), "thought": "按人设表态"}

    async def _llm_individuals(self, C) -> list:
        sel = self._select_llm_agents()
        if not sel:
            return []
        common = self._ctx_common()
        jobs = []
        feeds = {}
        for e in sel:
            feed = self._feed(e, C, k=7, alg="hot")
            feeds[e] = feed
            self._expose(e, feed)
            a = self.agents[e]
            ctx = dict(common, name=a["name"], role_label=ROLES[a["role"]]["label"], followers=f"{a['followers']:,}", persona=a["persona"],
                       op=self.op[e], aro=self.aro[e], belief=self.bel[e], memory="；".join(self.memory[e][-3:]) or "暂无",
                       feed=self._fmt_feed(feed))
            jobs.append((e, ctx))
        if self.use_llm:
            res = await asyncio.gather(*(LA.individual_decide(c) for _, c in jobs))
        else:
            res = [None] * len(jobs)
        out = []
        for (e, _), r in zip(jobs, res):
            src = "llm"
            if not isinstance(r, dict):
                r, src = self._llm_fallback(e, feeds[e]), "rule"
            out.append((e, r, feeds[e], src))
        return out

    def _apply_llm(self, e: int, r: dict, feed: list[int], src: str):
        act = str(r.get("action", "none")).lower()
        a = self.agents[e]
        thought = str(r.get("thought", ""))[:80]
        content = str(r.get("content", "")).strip()
        self.thoughts.append({"tick": self.tick, "time": self.tlabel(), "agent": e, "name": a["name"], "role": a["role"], "action": act,
                              "thought": thought, "content": content[:120], "src": src})
        self.thoughts = self.thoughts[-200:]
        if act not in ("post", "repost", "comment") or not content:
            return
        stance = LA.clamp(r.get("stance", self.op[e]), -1, 1, float(self.op[e]))
        belief = LA.clamp(r.get("belief", self.bel[e]), 0, 1, float(self.bel[e]))
        arousal = LA.clamp(r.get("arousal", self.aro[e]), 0, 1, float(self.aro[e]))
        self.op[e] = 0.7 * self.op[e] + 0.3 * stance
        self.bel[e] = 0.7 * self.bel[e] + 0.3 * belief
        tgt = r.get("target")
        try:
            tgt = int(tgt) if tgt is not None else None
        except Exception:  # noqa: BLE001
            tgt = None
        if tgt is not None and (tgt < 0 or tgt >= len(self.posts) or self.posts[tgt].deleted):
            tgt = feed[0] if feed else None
        if act in ("repost", "comment") and tgt is None:
            act = "post"
        topic = self._topic_idx(r.get("topic")) if act == "post" else None
        official = a["role"] in ("gov",)
        self._new_post(e, act, content, stance, belief=belief, arousal=arousal, emotion=r.get("emotion"), topic=topic,
                       parent=tgt if act != "post" else None, source=src, official=official,
                       debunk=official and belief < 0.3)
        self.memory[e].append(f"{self.tlabel()} {act}: {content[:40]}")

    async def _llm_groups(self) -> list:
        if self.tick % self.cfg["group_interval"] != 0:
            return []
        common = self._ctx_common()
        jobs = []
        for c in range(self.cfg["n_communities"]):
            mem = np.where((self.comm == c) & (self.driver == "rule"))[0]
            if not len(mem):
                continue
            eng = int(self.engaged[mem].sum())
            exposed = int((self.state[mem] > S).sum())
            if exposed < 3:
                continue
            ops = self.op[mem]
            # 社群成员最常看到的帖子：取社群成员互动最多的近期帖子
            cnt = Counter()
            for pid in self.feedable[-300:]:
                p = self.posts[pid]
                if self.comm[p.author] == c or self.roles[p.author] in ("gov", "media", "kol", "expert", "party"):
                    cnt[pid] = p.likes + 3 * p.reposts + 2 * p.comments + (8 if p.boosted or p.pinned else 0)
            feed = [pid for pid, _ in cnt.most_common(6)]
            info = COMMUNITIES[c]
            ctx = dict(common, name=info["name"], desc=info["desc"], n=len(mem), engaged=eng, mean=float(ops.mean()),
                       a=float((ops < -0.25).mean()), b=float((np.abs(ops) <= 0.25).mean()), c=float((ops > 0.25).mean()),
                       aro=float(self.aro[mem].mean()), bel=float((self.bel[mem] > 0.5).mean()), trust=float(self.tg[mem].mean()),
                       feed=self._fmt_feed(feed))
            jobs.append((c, mem, ctx))
        if not jobs:
            return []
        if self.use_llm:
            res = await asyncio.gather(*(LA.group_decide(j[2]) for j in jobs))
        else:
            res = [None] * len(jobs)
        return [(c, mem, r) for (c, mem, _), r in zip(jobs, res)]

    def _apply_group(self, c: int, mem: np.ndarray, r: dict | None):
        if not isinstance(r, dict):
            return
        rng = self.rng
        k = (0.5 + rng.random(len(mem))) * (0.4 + self.conf[mem])
        engaged = self.state[mem] > S
        self.op[mem] = np.clip(self.op[mem] + engaged * k * LA.clamp(r.get("stance_shift"), -0.3, 0.3) * 0.5, -1, 1)
        self.aro[mem] = np.clip(self.aro[mem] + engaged * k * LA.clamp(r.get("arousal_shift"), -0.3, 0.3) * 0.5, 0, 1)
        self.bel[mem] = np.clip(self.bel[mem] + engaged * k * LA.clamp(r.get("belief_shift"), -0.3, 0.3) * 0.5, 0, 1)
        self.tg[mem] = np.clip(self.tg[mem] + engaged * k * LA.clamp(r.get("trust_gov_shift"), -0.2, 0.2) * 0.5, 0.01, 0.99)
        self.part_bonus[c] = (LA.clamp(r.get("participation"), 0, 1, 0.5) - 0.5) * 1.2
        for cm in (r.get("comments") or [])[:8]:
            if isinstance(cm, dict) and cm.get("text"):
                self.pool[c].append({"text": str(cm["text"])[:120], "stance": LA.clamp(cm.get("stance"), -1, 1),
                                     "valence": LA.clamp(cm.get("valence"), -1, 1), "emotion": cm.get("emotion", "中性"), "tick": self.tick})
        self.pool[c] = self.pool[c][-40:]
        self.moods[c] = {"tick": self.tick, "time": self.tlabel(), "mood": str(r.get("mood", ""))[:40],
                         "stance_shift": LA.clamp(r.get("stance_shift"), -0.3, 0.3), "participation": LA.clamp(r.get("participation"), 0, 1, 0.5)}
        self.thoughts.append({"tick": self.tick, "time": self.tlabel(), "agent": -1 - c, "name": COMMUNITIES[c]["name"], "role": "group",
                              "action": "group", "thought": self.moods[c]["mood"], "content": " / ".join(x["text"] for x in self.pool[c][-3:])[:150], "src": "llm"})

    # ------------------------------------------------------------------ interventions
    def enqueue(self, iv: dict):
        self.queue.append(iv)

    def _pick_actor(self, iv: dict) -> int:
        if iv.get("actor_id") is not None:
            return int(iv["actor_id"])
        role = iv.get("role", "gov")
        cands = np.where(self.roles == role)[0]
        if not len(cands):
            cands = np.where(self.roles == "gov")[0]
        return int(cands[np.argmax(self.infl[cands])])

    def _apply_intervention(self, iv: dict):
        t = iv.get("type")
        name = "干预"
        if t in ("publish", "debunk", "inject"):
            a = self._pick_actor(iv)
            name = self.agents[a]["name"]
            debunk = t == "debunk"
            belief = 0.05 if debunk else LA.clamp(iv.get("belief", 0.4), 0, 1)
            stance = LA.clamp(iv.get("stance", 0.3 if debunk else 0), -1, 1)
            p = self._new_post(a, "post", iv.get("content") or "（官方发布）", stance, belief=belief, arousal=LA.clamp(iv.get("arousal", 0.3), 0, 1),
                               topic=self._topic_idx(iv.get("topic")) if iv.get("topic") else 0, source="user",
                               official=self.roles[a] == "gov", debunk=debunk, intervention=True, boosted=3 if iv.get("boost") else 0,
                               pinned=bool(iv.get("pin")))
            label = {"publish": "发布信息", "debunk": "发布辟谣", "inject": "注入新信息"}[t]
            self._log(name, f"【干预】{label}", p.content[:80], "intervention")
            if iv.get("truth") in ("true", "false"):
                self.card["truth"] = iv["truth"]
        elif t == "delete":
            mode, n = iv.get("mode", "rumor"), int(iv.get("count", 30))
            live = [p for p in self.posts if not p.deleted and not p.official and p.kind != "comment"]
            if mode == "rumor":
                live.sort(key=lambda p: -(p.belief * (1 + p.reposts)))
                live = [p for p in live if p.belief > 0.55]
            elif mode == "negative":
                live.sort(key=lambda p: p.stance * (1 + math.log1p(p.reposts)))
                live = [p for p in live if p.stance < -0.3]
            else:
                live.sort(key=lambda p: -(p.reposts * 3 + p.comments * 2 + p.likes))
            targets = live[:n]
            viewers = 0
            for p in targets:
                p.deleted = True
                viewers += p.views
                fl = self.followers[p.author]
                if len(fl) and self.cfg["streisand"] > 0:  # 史翠珊效应：删帖被察觉，激起逆反与不信任
                    seen = fl[self.state[fl] > S]
                    self.aro[seen] = np.clip(self.aro[seen] + 0.08 * self.cfg["streisand"], 0, 1)
                    self.tg[seen] = np.clip(self.tg[seen] - 0.04 * self.cfg["streisand"], 0.01, 0.99)
                    self.bel[seen] = np.clip(self.bel[seen] + 0.03 * self.cfg["streisand"], 0, 1)
            self._log("平台", "【干预】删除帖子", f"按“{ {'rumor':'谣言','negative':'负面','top':'高热'}.get(mode, mode)}”策略删除 {len(targets)} 条，曾被浏览 {viewers} 次", "intervention")
        elif t == "mute":
            n, ticks = int(iv.get("count", 10)), int(iv.get("ticks", 12))
            score = self.recv * (self.op < -0.3) * np.isin(self.roles, ["netizen", "kol", "bot"])
            top = np.argsort(-score)[:n]
            self.muted_until[top] = self.tick + ticks
            self._log("平台", "【干预】禁言高传播账号", f"禁言 {n} 个账号 {ticks} 小时：" + "、".join(self.agents[i]["name"] for i in top[:5]), "intervention")
        elif t == "throttle":
            self.throttle = {"range": (float(iv.get("lo", -1)), float(iv.get("hi", -0.4))), "until": self.tick + int(iv.get("ticks", 12))}
            self._log("平台", "【干预】内容限流", f"立场区间 {self.throttle['range']} 的内容降权 {iv.get('ticks', 12)} 小时", "intervention")
        elif t == "hot_remove":
            for tp in self.topics:
                if tp["kind"] == "event" and (iv.get("topic") in (None, tp["name"])):
                    tp["hidden"] = True
            self._log("平台", "【干预】撤下热搜", iv.get("topic") or "全部事件话题", "intervention")
        elif t == "hot_restore":
            for tp in self.topics:
                tp["hidden"] = False
            self._log("平台", "恢复热搜", "", "intervention")
        elif t == "hot_pin":
            idx = self._topic_idx(iv.get("topic") or "官方通报")
            self.topics[idx]["pinned"] = True
            self._log("平台", "【干预】话题置顶", f"#{self.topics[idx]['name']}#", "intervention")
        elif t == "algorithm":
            self.cfg["algorithm"] = iv.get("algorithm", "hot")
            self._log("平台", "【干预】切换推荐算法", {"timeline": "时间线", "hot": "热度优先", "personalized": "个性化(兴趣)", "diverse": "多元化"}.get(self.cfg["algorithm"], ""), "intervention")
        elif t == "clean_bots":
            bots = np.where(self.roles == "bot")[0]
            self.muted_until[bots] = 10 ** 6
            n = 0
            for p in self.posts:
                if self.roles[p.author] == "bot" and not p.deleted:
                    p.deleted = True
                    n += 1
            self._log("平台", "【干预】清理水军", f"封禁 {len(bots)} 个营销号，删除 {n} 条内容", "intervention")
        elif t == "params":
            for k, v in (iv.get("params") or {}).items():
                if k in self.cfg:
                    self.cfg[k] = type(self.cfg[k])(v)
            self._log("系统", "参数调整", str(iv.get("params")), "intervention")

    # ------------------------------------------------------------------ main step
    async def step(self):
        self.new_post_ids = []
        self.silenced = 0
        for iv in self.queue:
            self._apply_intervention(iv)
        self.queue = []
        cfg = self.cfg
        hr = self.now().hour
        C = self._candidates()
        # LLM 任务先发起（并发），规则动力学同时进行
        ind_task = asyncio.create_task(self._llm_individuals(C))
        grp_task = asyncio.create_task(self._llm_groups())
        await asyncio.sleep(0)
        # Hawkes 自激活跃
        self.exc *= 0.55
        lam = self.act * CIRC[hr] * (0.6 + 0.8 * self.salience) + np.minimum(self.exc, 1.5)
        p_act = 1 - np.exp(-lam)
        active = np.where((self.rng.random(self.N) < p_act) & (self.driver == "rule") & (self.muted_until <= self.tick))[0]
        self.rng.shuffle(active)
        for i in active:
            feed = self._feed(int(i), C)
            clim = self._expose(int(i), feed)
            if self.state[i] in (E, I):
                self._rule_act(int(i), feed, clim)
        ind = await ind_task
        grp = await grp_task
        for e, r, feed, src in ind:
            self._apply_llm(e, r, feed, src)
        for c, mem, r in grp:
            self._apply_group(c, mem, r)
        # SEIR 衰减与情绪回落
        rnd = self.rng.random(self.N)
        self.state[(self.state == I) & (rnd < cfg["gamma"] * (1.3 - self.aro))] = R
        self.state[(self.state == E) & (rnd < 0.05)] = R
        self.aro += 0.06 * (self.aro_base - self.aro)
        # 政务“失语”导致公信力流失（黄金 4 小时法则）
        if self.gov_responded_tick is None and self.salience > 0.4:
            ex = self.state > S
            self.tg[ex] = np.clip(self.tg[ex] - 0.004 * min(self.trending_ticks, 10), 0.01, 0.99)
        self.tick += 1
        self._update_board()
        self._metrics()

    # ------------------------------------------------------------------ metrics
    def _metrics(self):
        t = self.tick
        P = self.posts
        new = [P[i] for i in self.new_post_ids]
        net = self.roles == "netizen"
        ex = (self.state > S) & net
        ops = self.op[ex] if ex.sum() > 5 else self.op[net]
        vals = [p.valence for p in new if p.kind != "like"]
        emo = Counter(p.emotion for p in new)
        heats = [h["heat"] for h in self.history]
        main_heat = sum(tp["heat"] for tp in self.topics if tp["kind"] == "event")
        main_rank = next((b["rank"] for b in self.board if b["idx"] == 0), None)
        prevI = self.history[-1]["I"] if self.history else 1
        newI = int(sum(1 for p in new if p.kind in ("post", "repost", "comment")))
        m = {
            "tick": t, "time": self.tlabel(), "heat": main_heat, "rank": main_rank,
            "posts": sum(p.kind == "post" for p in new), "reposts": sum(p.kind == "repost" for p in new), "comments": sum(p.kind == "comment" for p in new),
            "total_posts": len(P), "participants": int(self.engaged.sum()),
            "S": int((self.state == S).sum()), "E": int((self.state == E).sum()), "I": int((self.state == I).sum()), "R": int((self.state == R).sum()),
            "op_mean": float(ops.mean()), "op_std": float(ops.std()), "polarization": bimodality(ops), "er_polarization": esteban_ray(ops),
            "op_hist": np.histogram(ops, bins=20, range=(-1, 1))[0].tolist(),
            "sentiment": float(np.mean(vals)) if vals else (self.history[-1]["sentiment"] if self.history else 0.0),
            "neg_share": float(np.mean([v < -0.2 for v in vals])) if vals else (self.history[-1]["neg_share"] if self.history else 0.0),
            "pos_share": float(np.mean([v > 0.2 for v in vals])) if vals else 0.0,
            "emotions": {k: emo.get(k, 0) for k in EMOTIONS},
            "arousal": float(self.aro[ex].mean()) if ex.any() else float(self.aro.mean()),
            "belief_rate": float((self.bel[ex] > 0.5).mean()) if ex.any() else float((self.bel[net] > 0.5).mean()),
            "trust_gov": float(self.tg[net].mean()), "trust_media": float(self.tm[net].mean()),
            "Rt": round(newI / max(1, prevI), 3), "silenced": self.silenced,
            "stance_share": [float((ops < -0.25).mean()), float((np.abs(ops) <= 0.25).mean()), float((ops > 0.25).mean())],
            "llm_calls": llm.stats.calls,
        }
        if self.history:  # 指数平滑，减少小样本抖动
            ph = self.history[-1]
            for k in ("sentiment", "neg_share", "pos_share"):
                m[k] = 0.5 * ph[k] + 0.5 * m[k]
        m["stage"] = lifecycle(heats + [main_heat])
        if t % 2 == 0 or not self.history:
            if len(self.net_edges):
                u, v = self.op[self.net_edges[:, 0]], self.op[self.net_edges[:, 1]]
                m["echo"] = float(np.corrcoef(u, v)[0, 1]) if u.std() > 1e-6 and v.std() > 1e-6 else 0.0
            m["leader_gini"] = gini(self.recv[self.recv > 0]) if (self.recv > 0).sum() > 2 else 0.0
            cas = self.cascade_stats()
            m.update(cas)
        else:
            for k in ("echo", "leader_gini", "max_depth", "virality", "max_cascade"):
                m[k] = self.history[-1].get(k, 0)
        m["communities"] = [{"c": c, "op": float(self.op[self.comm == c].mean()), "aro": float(self.aro[self.comm == c].mean()),
                             "bel": float((self.bel[self.comm == c] > 0.5).mean()), "engaged": int(self.engaged[self.comm == c].sum())}
                            for c in range(self.cfg["n_communities"])]
        self.history.append(m)
        self.traj.append(self.op[self.sample_idx].round(3).tolist())

    def cascade_stats(self) -> dict:
        roots = defaultdict(dict)
        for p in self.posts:
            if p.kind == "repost" and p.parent is not None:
                roots[p.root][p.id] = p.parent
        best = (0, 0.0, 0)
        for r, par in roots.items():
            par = dict(par)
            par[r] = None
            sv, d = structural_virality(par)
            if len(par) > best[0]:
                best = (len(par), sv, d)
        return {"max_cascade": best[0], "virality": round(best[1], 3), "max_depth": best[2]}

    # ------------------------------------------------------------------ serialization
    def post_dict(self, p: Post, with_parent=True) -> dict:
        a = self.agents[p.author]
        d = {"id": p.id, "author": p.author, "name": a["name"], "role": a["role"], "verified": a["verified"], "followers": a["followers"],
             "tick": p.tick, "time": self.tlabel(p.tick), "kind": p.kind, "content": p.content, "stance": round(p.stance, 2),
             "valence": round(p.valence, 2), "belief": round(p.belief, 2), "emotion": p.emotion, "topic": self.topics[p.topic]["name"],
             "likes": p.likes, "reposts": p.reposts, "comments": p.comments, "views": p.views, "deleted": p.deleted,
             "official": p.official, "debunk": p.debunk, "intervention": p.intervention, "pinned": p.pinned, "source": p.source,
             "community": int(a["community"]), "depth": p.depth}
        if with_parent and p.parent is not None:
            d["parent"] = self.post_dict(self.posts[p.parent], with_parent=False)
        return d

    def summary(self) -> dict:
        return {
            "tick": self.tick, "time": self.tlabel(), "datetime": self.now().strftime("%Y-%m-%d %H:%M"), "card": self.card, "cfg": self.cfg,
            "n_agents": self.N, "latest": self.history[-1], "board": self.board[:30], "events": self.events[-80:],
            "moods": {COMMUNITIES[c]["name"]: v for c, v in self.moods.items()}, "thoughts": self.thoughts[-40:],
            "communities": [c["name"] for c in COMMUNITIES[: self.cfg["n_communities"]]], "gov_responded": self.gov_responded_tick,
            "role_counts": dict(Counter(self.roles.tolist())), "llm": llm.info(), "use_llm": self.use_llm,
        }

    def tick_payload(self) -> dict:
        new = [self.post_dict(self.posts[i]) for i in self.new_post_ids[-60:]]
        return {"tick": self.tick, "time": self.tlabel(), "latest": self.history[-1], "board": self.board[:30], "new_posts": new,
                "events": self.events[-12:], "thoughts": self.thoughts[-12:], "llm": llm.info(),
                "moods": {COMMUNITIES[c]["name"]: v for c, v in self.moods.items()}}

    def network(self, max_edges: int = 5000, color_by: str = "op") -> dict:
        nodes = []
        for a in self.agents:
            i = a["id"]
            nodes.append({"id": i, "name": a["name"], "role": a["role"], "c": int(a["community"]), "f": a["followers"], "infl": round(a["influence"], 4),
                          "op": round(float(self.op[i]), 3), "st": int(self.state[i]), "bel": round(float(self.bel[i]), 2),
                          "aro": round(float(self.aro[i]), 2), "eng": bool(self.engaged[i]), "recv": float(self.recv[i]), "driver": a["driver"],
                          "muted": bool(self.muted_until[i] > self.tick)})
        edges = list(self.G.edges())
        elite = set(np.where(self.roles != "netizen")[0].tolist())
        imp = [e for e in edges if e[1] in elite]
        rest = [e for e in edges if e[1] not in elite]
        rng = random.Random(1)
        if len(imp) > max_edges * 0.4:
            imp = rng.sample(imp, int(max_edges * 0.4))
        if len(rest) > max_edges - len(imp):
            rest = rng.sample(rest, max_edges - len(imp))
        return {"nodes": nodes, "edges": [[int(u), int(v)] for u, v in imp + rest], "total_edges": self.G.number_of_edges()}

    def interaction_net(self) -> dict:
        agg = {}
        for a, b, t, k in self.interactions:
            if a == b:
                continue
            key = (a, b)
            if key not in agg:
                agg[key] = [t, 0, k]
            agg[key][1] += 1
        involved = set()
        for a, b in agg:
            involved.add(a)
            involved.add(b)
        nodes = [{"id": i, "name": self.agents[i]["name"], "role": self.roles[i], "c": int(self.comm[i]), "op": round(float(self.op[i]), 3),
                  "recv": float(self.recv[i]), "f": self.agents[i]["followers"],
                  "first": min([v[0] for (x, y), v in agg.items() if x == i or y == i] or [0])} for i in involved]
        links = [{"source": a, "target": b, "t": v[0], "w": v[1], "k": v[2]} for (a, b), v in agg.items()]
        return {"nodes": nodes, "links": links}

    def cascades(self, top: int = 6) -> list[dict]:
        cand = sorted([p for p in self.posts if p.kind == "post"], key=lambda p: -p.reposts)[:top]
        out = []
        for root in cand:
            tree, stack = [], [root.id]
            while stack and len(tree) < 600:
                pid = stack.pop()
                p = self.posts[pid]
                tree.append({"id": p.id, "parent": p.parent if p.id != root.id else None, "author": self.agents[p.author]["name"],
                             "role": str(self.roles[p.author]), "tick": p.tick, "stance": round(p.stance, 2), "kind": p.kind,
                             "content": p.content[:60], "deleted": p.deleted})
                stack.extend([c for c in p.children if self.posts[c].kind == "repost"])
            par = {n["id"]: n["parent"] for n in tree}
            sv, d = structural_virality(par)
            out.append({"root": self.post_dict(root, False), "nodes": tree, "size": len(tree), "virality": round(sv, 3), "depth": d})
        return out

    def agent_detail(self, i: int) -> dict:
        a = dict(self.agents[i])
        a.update({"op": float(self.op[i]), "aro": float(self.aro[i]), "bel": float(self.bel[i]), "trust_gov": float(self.tg[i]),
                  "trust_media": float(self.tm[i]), "state": "SEIR"[self.state[i]], "eps": float(self.eps[i]), "conformity": float(self.conf[i]),
                  "stubborn": float(self.stub[i]), "muted": bool(self.muted_until[i] > self.tick), "recv": float(self.recv[i]),
                  "community_name": COMMUNITIES[a["community"]]["name"] if a["community"] >= 0 else ROLES[a["role"]]["label"],
                  "memory": self.memory.get(i, [])[-10:],
                  "posts": [self.post_dict(p) for p in self.posts if p.author == i][-20:][::-1],
                  "thoughts": [t for t in self.thoughts if t["agent"] == i][-10:]})
        return a

    def sankey(self) -> dict:
        net = self.roles == "netizen"
        bins = lambda x: np.digitize(x, [-0.25, 0.25])  # noqa: E731
        b0, b1 = bins(self.op0[net]), bins(self.op[net])
        names = ["反对", "中立", "支持"]
        links = []
        for i in range(3):
            for j in range(3):
                v = int(((b0 == i) & (b1 == j)).sum())
                if v:
                    links.append({"source": f"初始·{names[i]}", "target": f"当前·{names[j]}", "value": v})
        return {"nodes": [{"name": f"初始·{n}"} for n in names] + [{"name": f"当前·{n}"} for n in names], "links": links}

    def leaders(self, n: int = 20) -> list[dict]:
        idx = np.argsort(-self.recv)[:n]
        return [{"id": int(i), "name": self.agents[i]["name"], "role": self.roles[i], "recv": float(self.recv[i]), "followers": self.agents[i]["followers"],
                 "op": float(self.op[i]), "posts": sum(1 for p in self.posts if p.author == i)} for i in idx if self.recv[i] > 0]

    def words(self, n: int = 80) -> list[dict]:
        key = ("words", len(self.posts))
        if key in self.cache:
            return self.cache[key]
        try:
            import jieba.analyse as ja
            text = "\n".join(p.content for p in self.posts[-1500:] if not p.deleted and p.content != "转发微博")
            res = [{"name": w, "value": round(s * 1000, 1)} for w, s in ja.extract_tags(text, topK=n, withWeight=True)]
        except Exception:  # noqa: BLE001
            res = []
        self.cache = {key: res}
        return res

    def clone_for_whatif(self) -> "Simulation":
        c = copy.copy(self)
        for k, v in self.__dict__.items():
            if k in ("G", "agents", "following", "followers", "net_edges", "sample_idx"):
                setattr(c, k, v)  # 只读结构共享
            else:
                setattr(c, k, copy.deepcopy(v))
        c.use_llm = False
        c.cache = {}
        return c
