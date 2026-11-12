"""舆情指标体系。

- 传播规模：热度指数、参与人数、发帖/转发/评论/点赞、SEIR 仓室
- 传播结构：级联深度、结构病毒性(Goel et al. 2016, 平均最短路径 Wiener 指数)、再生数 R_t
- 观点结构：均值/方差、极化指数(双峰系数 BC)、Esteban-Ray 极化、回音室指数
- 情感：情感指数、负面占比、情绪类别分布
- 认知：传言相信率、政务/媒体公信力
- 注意力集中度：意见领袖 Gini 系数
- 生命周期：潜伏/爆发/蔓延/衰退/平息
"""
from __future__ import annotations

import math
from collections import defaultdict

import numpy as np


def gini(x: np.ndarray) -> float:
    x = np.sort(np.asarray(x, dtype=float))
    if x.sum() <= 0:
        return 0.0
    n = len(x)
    return float((2 * np.arange(1, n + 1) - n - 1).dot(x) / (n * x.sum()))


def bimodality(x: np.ndarray) -> float:
    """Sarle 双峰系数，>0.555 提示双峰（极化）。"""
    n = len(x)
    if n < 4 or np.std(x) < 1e-6:
        return 0.0
    m = x - x.mean()
    s2 = (m ** 2).mean()
    g = (m ** 3).mean() / s2 ** 1.5
    k = (m ** 4).mean() / s2 ** 2 - 3
    return float((g ** 2 + 1) / (k + 3 * (n - 1) ** 2 / ((n - 2) * (n - 3))))


def esteban_ray(x: np.ndarray, bins: int = 10, alpha: float = 1.3) -> float:
    h, edges = np.histogram(x, bins=bins, range=(-1, 1))
    p = h / max(1, h.sum())
    c = (edges[:-1] + edges[1:]) / 2
    val = sum(p[i] ** (1 + alpha) * p[j] * abs(c[i] - c[j]) for i in range(bins) for j in range(bins))
    return float(val * 4)  # 归一化到约 0~1


def structural_virality(parent: dict[int, int | None]) -> tuple[float, int]:
    """给定级联树(节点->父节点)，返回(结构病毒性 = 平均两两最短距离, 最大深度)。"""
    nodes = list(parent)
    n = len(nodes)
    if n < 2:
        return 0.0, 0
    children = defaultdict(list)
    root = None
    for v, p in parent.items():
        if p is None or p not in parent:
            root = v if root is None else root
        else:
            children[p].append(v)
    if root is None:
        return 0.0, 0
    # Wiener 指数 = Σ_边 size(sub)*(n-size(sub))
    size, depth, order, stack = {}, {root: 0}, [], [root]
    while stack:
        v = stack.pop()
        order.append(v)
        for c in children[v]:
            depth[c] = depth[v] + 1
            stack.append(c)
    for v in reversed(order):
        size[v] = 1 + sum(size[c] for c in children[v])
    w = sum(size[v] * (len(order) - size[v]) for v in order if v != root)
    m = len(order)
    return (2 * w / (m * (m - 1)) if m > 1 else 0.0), max(depth.values())


def lifecycle(heats: list[float]) -> str:
    if not heats:
        return "潜伏期"
    sm = [float(np.mean(heats[max(0, i - 2): i + 1])) for i in range(len(heats))]  # 3 步滑动平均
    heats = sm
    peak = max(heats)
    cur = heats[-1]
    if peak < 30:
        return "潜伏期"
    prev = np.mean(heats[-4:-1]) if len(heats) >= 4 else heats[0]
    growth = (cur - prev) / (prev + 1)
    if cur >= 0.85 * peak and growth > -0.05:
        return "爆发期" if growth > 0.15 else "高峰期"
    if growth > 0.15:
        return "爆发期"
    if cur > 0.35 * peak:
        return "蔓延期" if growth >= -0.08 else "衰退期"
    return "衰退期" if cur > 0.12 * peak else "平息期"


EMOTIONS = ["愤怒", "悲伤", "恐惧", "惊讶", "厌恶", "喜悦", "中性"]


def emotion_of(valence: float, arousal: float, rng) -> str:
    if valence < -0.25:
        if arousal > 0.55:
            return "愤怒" if rng.random() < 0.7 else "厌恶"
        return "悲伤" if rng.random() < 0.6 else "恐惧"
    if valence > 0.25:
        return "喜悦"
    return "惊讶" if arousal > 0.5 else "中性"
