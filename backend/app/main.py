"""FastAPI 服务：REST + WebSocket 实时推送。"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import data_sources
from .config import RUNS_DIR
from .llm import llm
from .report import build_report
from .sim import llm_agents as LA
from .sim.engine import DEFAULT_CFG, Simulation
from .sim.personas import COMMUNITIES, ROLES
from .sim.scenario import build_card, fallback_card
from .sim.theories import THEORIES

app = FastAPI(title="舆镜 · 大模型智能体舆情仿真平台", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Manager:
    def __init__(self):
        self.sim: Simulation | None = None
        self.task: asyncio.Task | None = None
        self.running = False
        self.speed = 1.0  # 每步之间的间隔秒
        self.max_ticks = 96
        self.clients: set[WebSocket] = set()
        self.lock = asyncio.Lock()
        self.busy = False

    async def broadcast(self, msg: dict):
        dead = []
        txt = json.dumps(msg, ensure_ascii=False, default=float)
        for ws in self.clients:
            try:
                await ws.send_text(txt)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def step_once(self):
        async with self.lock:
            if not self.sim:
                return
            self.busy = True
            await self.broadcast({"type": "busy", "tick": self.sim.tick})
            t0 = time.time()
            await self.sim.step()
            self.busy = False
            payload = self.sim.tick_payload()
            payload["elapsed"] = round(time.time() - t0, 2)
            await self.broadcast({"type": "tick", "data": payload})

    async def loop(self):
        try:
            while self.running and self.sim and self.sim.tick < self.max_ticks:
                await self.step_once()
                await asyncio.sleep(self.speed)
        finally:
            self.running = False
            await self.broadcast({"type": "status", "running": False})

    def start(self):
        if self.running or not self.sim:
            return
        self.running = True
        self.task = asyncio.create_task(self.loop())

    def pause(self):
        self.running = False


M = Manager()


def need_sim() -> Simulation:
    if not M.sim:
        raise HTTPException(400, "尚未创建仿真，请先在“情景配置”中创建")
    return M.sim


# ------------------------------------------------------------------ meta
@app.get("/api/health")
async def health():
    return {"ok": True, "llm": llm.info(), "has_sim": M.sim is not None}


@app.get("/api/meta")
async def meta():
    return {"defaults": DEFAULT_CFG, "roles": ROLES, "communities": COMMUNITIES, "theories": THEORIES, "llm": llm.info()}


@app.get("/api/llm/logs")
async def llm_logs():
    return {"info": llm.info(), "recent": llm.stats.recent[::-1]}


# ------------------------------------------------------------------ data sources
@app.get("/api/sources")
async def sources():
    return await data_sources.get_all()


@app.get("/api/sources/{key}")
async def source(key: str):
    if key not in data_sources.SOURCES:
        raise HTTPException(404)
    return await data_sources.get_source(key)


class CardReq(BaseModel):
    title: str
    desc: str = ""
    use_llm: bool = True


@app.post("/api/scenario/card")
async def scenario_card(req: CardReq):
    if req.use_llm and llm.enabled:
        return await build_card(req.title, req.desc)
    c = fallback_card(req.title, req.desc)
    c["city"] = "临江市"
    return c


# ------------------------------------------------------------------ simulation lifecycle
class CreateReq(BaseModel):
    card: dict
    cfg: dict = {}
    max_ticks: int = 96


@app.post("/api/sim/create")
async def sim_create(req: CreateReq):
    M.pause()
    if M.task:
        try:
            await asyncio.wait_for(M.task, 60)
        except Exception:  # noqa: BLE001
            pass
    bg = (await data_sources.get_source("weibo"))["items"]
    card = dict(req.card)
    card.setdefault("city", "临江市")
    if not card.get("hashtags"):
        card = {**fallback_card(card.get("title", "未命名事件")), **card}
    M.sim = Simulation(card, req.cfg, background=[b for b in bg if b.get("title") != card.get("source_title")])
    M.max_ticks = req.max_ticks
    await M.broadcast({"type": "created", "data": M.sim.summary()})
    return M.sim.summary()


class ControlReq(BaseModel):
    action: str
    speed: float | None = None
    max_ticks: int | None = None


@app.post("/api/sim/control")
async def sim_control(req: ControlReq):
    need_sim()
    if req.speed is not None:
        M.speed = max(0.0, req.speed)
    if req.max_ticks:
        M.max_ticks = req.max_ticks
    if req.action == "start":
        M.start()
    elif req.action == "pause":
        M.pause()
    elif req.action == "step":
        if not M.running:
            await M.step_once()
    return {"running": M.running, "tick": M.sim.tick, "speed": M.speed, "max_ticks": M.max_ticks}


@app.get("/api/sim/summary")
async def sim_summary():
    s = need_sim().summary()
    s.update({"running": M.running, "speed": M.speed, "max_ticks": M.max_ticks, "busy": M.busy})
    return s


@app.get("/api/sim/history")
async def sim_history():
    return need_sim().history


@app.get("/api/sim/posts")
async def sim_posts(sort: str = "time", role: str = "", topic: str = "", q: str = "", kind: str = "", limit: int = 40, offset: int = 0,
                    official: bool = False):
    sim = need_sim()
    ps = [p for p in sim.posts if p.kind != "comment"] if kind != "comment" else [p for p in sim.posts if p.kind == "comment"]
    if kind in ("post", "repost"):
        ps = [p for p in ps if p.kind == kind]
    if role:
        ps = [p for p in ps if sim.roles[p.author] == role]
    if topic:
        ps = [p for p in ps if sim.topics[p.topic]["name"] == topic]
    if q:
        ps = [p for p in ps if q in p.content or q in sim.agents[p.author]["name"]]
    if official:
        ps = [p for p in ps if p.official or p.intervention]
    if sort == "hot":
        ps.sort(key=lambda p: -(p.likes + 3 * p.reposts + 2 * p.comments))
    else:
        ps = ps[::-1]
    pinned = [sim.post_dict(p) for p in sim.posts if p.pinned and not p.deleted] if offset == 0 and sort == "time" and not (role or topic or q) else []
    return {"total": len(ps), "items": pinned + [sim.post_dict(p) for p in ps[offset: offset + limit]]}


@app.get("/api/sim/post/{pid}")
async def sim_post(pid: int):
    sim = need_sim()
    if pid < 0 or pid >= len(sim.posts):
        raise HTTPException(404)
    p = sim.posts[pid]
    kids = [sim.posts[c] for c in p.children]
    return {"post": sim.post_dict(p), "comments": [sim.post_dict(c, False) for c in kids if c.kind == "comment"][::-1][:80],
            "reposts": [sim.post_dict(c, False) for c in kids if c.kind == "repost"][::-1][:80]}


@app.get("/api/sim/network")
async def sim_network(max_edges: int = 5000):
    return need_sim().network(max_edges)


@app.get("/api/sim/interactions")
async def sim_interactions():
    return need_sim().interaction_net()


@app.get("/api/sim/cascades")
async def sim_cascades(top: int = 6):
    return need_sim().cascades(top)


@app.get("/api/sim/agent/{aid}")
async def sim_agent(aid: int):
    sim = need_sim()
    if aid < 0 or aid >= sim.N:
        raise HTTPException(404)
    return sim.agent_detail(aid)


@app.get("/api/sim/agents")
async def sim_agents(role: str = "", q: str = "", limit: int = 50):
    sim = need_sim()
    out = []
    for a in sim.agents:
        if role and a["role"] != role:
            continue
        if q and q not in a["name"]:
            continue
        out.append({"id": a["id"], "name": a["name"], "role": a["role"], "driver": a["driver"], "followers": a["followers"], "op": float(sim.op[a["id"]])})
    out.sort(key=lambda x: -x["followers"])
    return out[:limit]


@app.get("/api/sim/analysis")
async def sim_analysis():
    sim = need_sim()
    return {"sankey": sim.sankey(), "leaders": sim.leaders(), "words": sim.words(), "traj": sim.traj[-200:],
            "topics": [{"name": t["name"], "heat": t["heat"], "kind": t["kind"]} for t in sim.topics if t["kind"] == "event"],
            "pools": {COMMUNITIES[c]["name"]: v[-8:] for c, v in sim.pool.items()}, "moods": {COMMUNITIES[c]["name"]: v for c, v in sim.moods.items()}}


@app.get("/api/sim/thoughts")
async def sim_thoughts():
    return need_sim().thoughts[::-1][:120]


# ------------------------------------------------------------------ interventions
@app.post("/api/sim/intervene")
async def sim_intervene(iv: dict):
    sim = need_sim()
    sim.enqueue(iv)
    applied = False
    if iv.get("immediate", True) and not M.busy:
        async with M.lock:
            for x in sim.queue:
                sim._apply_intervention(x)  # noqa: SLF001
            sim.queue = []
            sim._update_board()  # noqa: SLF001
        applied = True
        await M.broadcast({"type": "intervention", "data": {"events": sim.events[-5:], "board": sim.board[:30]}})
    return {"ok": True, "applied": applied, "queued": len(sim.queue)}


class DraftReq(BaseModel):
    actor: str = "临江市发布"
    role: str = "gov"
    goal: str = "发布权威通报，回应关切，澄清不实传言"


@app.post("/api/sim/draft")
async def sim_draft(req: DraftReq):
    sim = need_sim()
    h = sim.history[-1]
    ctx = dict(title=sim.card["title"], summary=sim.card["summary"], claim=sim.card["claim"], stage=h["stage"],
               neg=sim.card["stance_axis"]["neg"], pos=sim.card["stance_axis"]["pos"], mean_op=h["op_mean"],
               neg_share=h["neg_share"], belief_rate=h["belief_rate"], trust=h["trust_gov"], actor=req.actor, role=ROLES.get(req.role, {}).get("label", req.role), goal=req.goal)
    r = await LA.draft_statement(ctx)
    if not isinstance(r, dict):
        r = {"content": f"【情况通报】关于网传“{sim.card['claim'][:30]}”一事，经初步核查……我们将依法依规处理，并及时公布调查进展。", "stance": 0.3, "belief": 0.1,
             "predicted_effect": "（未启用大模型）预计可降低传言相信率", "risk": "回应过于模板化可能引发质疑"}
    return r


class WhatIfReq(BaseModel):
    interventions: list[dict] = []
    ticks: int = 24
    runs: int = 1


@app.post("/api/sim/whatif")
async def sim_whatif(req: WhatIfReq):
    """平行推演：从当前状态克隆两个世界（基线 vs 干预），用规则模式快速推演对比。"""
    sim = need_sim()
    keys = ["heat", "belief_rate", "neg_share", "op_mean", "polarization", "trust_gov", "participants", "I"]
    res = {"base": {k: [] for k in keys}, "iv": {k: [] for k in keys}, "time": []}
    async with M.lock:
        clones = []
        for r in range(max(1, min(3, req.runs))):
            b, v = sim.clone_for_whatif(), sim.clone_for_whatif()
            seed = 1000 + r
            import numpy as np
            b.rng, v.rng = np.random.default_rng(seed), np.random.default_rng(seed)
            for iv in req.interventions:
                v.enqueue(iv)
            clones.append((b, v))
    for _ in range(req.ticks):
        for b, v in clones:
            await b.step()
            await v.step()
        await asyncio.sleep(0)
    for name, idx in (("base", 0), ("iv", 1)):
        for k in keys:
            series = [[c[idx].history[sim.tick + 1 + t][k] for t in range(req.ticks)] for c in clones]
            res[name][k] = [round(sum(s[t] for s in series) / len(series), 4) for t in range(req.ticks)]
    res["time"] = [clones[0][0].history[sim.tick + 1 + t]["time"] for t in range(req.ticks)]
    return res


# ------------------------------------------------------------------ report / export
@app.get("/api/sim/report")
async def sim_report():
    return await build_report(need_sim())


@app.get("/api/sim/export")
async def sim_export():
    sim = need_sim()
    data = {"summary": sim.summary(), "history": sim.history, "posts": [sim.post_dict(p, False) for p in sim.posts], "events": sim.events,
            "thoughts": sim.thoughts}
    path = RUNS_DIR / f"run_{int(time.time())}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, default=float), encoding="utf-8")
    return FileResponse(path, filename=path.name, media_type="application/json")


# ------------------------------------------------------------------ websocket
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    M.clients.add(ws)
    try:
        if M.sim:
            await ws.send_text(json.dumps({"type": "hello", "running": M.running, "tick": M.sim.tick}, ensure_ascii=False))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        M.clients.discard(ws)


# ------------------------------------------------------------------ static frontend (生产模式)
DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str):
        f = DIST / path
        if path and f.exists() and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
else:
    @app.get("/")
    async def root():
        return JSONResponse({"msg": "后端已启动。前端开发模式请运行 frontend: npm run dev"})
