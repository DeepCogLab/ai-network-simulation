import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import Chart, { base, xAxis, yAxis } from '../components/Chart.jsx'
import { COMM_COLORS, stanceColor, useStore } from '../store'

export default function Analysis() {
  const { version, history, summary } = useStore()
  const [a, setA] = useState(null)
  useEffect(() => { api.get('/api/sim/analysis').then(setA) }, [Math.floor(version / 2)])
  const x = history.map((h) => h.time)
  const comms = summary.communities

  const trajOpt = useMemo(() => {
    if (!a?.traj?.length) return null
    const T = a.traj.length, K = a.traj[0].length
    const off = history.length - T
    const series = []
    for (let k = 0; k < K; k++) {
      const fin = a.traj[T - 1][k]
      series.push({ type: 'line', showSymbol: false, silent: true, data: a.traj.map((r) => r[k]), lineStyle: { width: 0.8, color: stanceColor(fin), opacity: 0.45 } })
    }
    return base({ tooltip: { show: false }, xAxis: xAxis(x.slice(off)), yAxis: yAxis({ min: -1, max: 1 }), series, animation: false })
  }, [a])

  const sankeyOpt = useMemo(() => a && ({
    tooltip: { trigger: 'item' },
    series: [{ type: 'sankey', left: 10, right: 70, top: 10, bottom: 10, data: a.sankey.nodes.map((n) => ({ ...n, itemStyle: { color: n.name.includes('反对') ? '#ff4d6a' : n.name.includes('支持') ? '#3ad6ff' : '#7c8aa8' } })),
      links: a.sankey.links, lineStyle: { color: 'gradient', opacity: 0.35 }, label: { color: '#dfe7ff' }, nodeWidth: 14 }],
  }), [a])

  const commOpt = useMemo(() => base({
    legend: { data: comms, type: 'scroll' }, xAxis: xAxis(x), yAxis: yAxis({ min: -1, max: 1 }),
    series: comms.map((c, i) => ({ name: c, type: 'line', smooth: true, showSymbol: false, data: history.map((h) => h.communities?.[i]?.op), lineStyle: { color: COMM_COLORS[i], width: 2 }, itemStyle: { color: COMM_COLORS[i] } })),
  }), [history.length])

  const radarOpt = useMemo(() => {
    const h = history[history.length - 1]
    if (!h) return null
    return {
      legend: { data: comms, bottom: 0, textStyle: { color: '#9aa7c7', fontSize: 10 }, itemWidth: 10 },
      radar: { indicator: [{ name: '批评倾向', max: 1 }, { name: '情绪唤醒', max: 1 }, { name: '传言相信', max: 1 }, { name: '卷入比例', max: 1 }], radius: '62%', center: ['50%', '45%'],
        axisName: { color: '#9aa7c7' }, splitLine: { lineStyle: { color: '#1f2a44' } }, splitArea: { show: false }, axisLine: { lineStyle: { color: '#1f2a44' } } },
      tooltip: {},
      series: [{ type: 'radar', data: h.communities.map((c, i) => ({ name: comms[i], value: [(1 - c.op) / 2, c.aro, c.bel, Math.min(1, c.engaged / Math.max(1, summary.n_agents / comms.length))],
        lineStyle: { color: COMM_COLORS[i] }, itemStyle: { color: COMM_COLORS[i] }, areaStyle: { color: COMM_COLORS[i], opacity: 0.08 } })) }],
    }
  }, [history.length])

  const structOpt = useMemo(() => base({
    legend: { data: ['极化指数 BC', 'Esteban-Ray 极化', '回音室指数', '意见领袖 Gini', '观点标准差'] }, xAxis: xAxis(x), yAxis: yAxis(),
    series: [['极化指数 BC', 'polarization', '#ffb020'], ['Esteban-Ray 极化', 'er_polarization', '#ff4d6a'], ['回音室指数', 'echo', '#20c9b0'], ['意见领袖 Gini', 'leader_gini', '#a66bff'], ['观点标准差', 'op_std', '#3ad6ff']]
      .map(([n, k, c]) => ({ name: n, type: 'line', smooth: true, showSymbol: false, data: history.map((h) => h[k]), lineStyle: { color: c, width: 2 }, itemStyle: { color: c } })),
  }), [history.length])

  const wordOpt = useMemo(() => a && ({
    series: [{ type: 'wordCloud', shape: 'circle', gridSize: 6, sizeRange: [12, 46], rotationRange: [0, 0], width: '100%', height: '100%',
      textStyle: { fontFamily: 'Microsoft YaHei', fontWeight: 600, color: () => ['#3ad6ff', '#8b5cff', '#ff4d6a', '#ffb020', '#2bd99f', '#ff7ab6', '#dfe7ff'][Math.floor(Math.random() * 7)] },
      data: a.words }],
  }), [a?.words?.length, a?.words?.[0]?.name])

  const topicOpt = useMemo(() => a && base({
    grid: { left: 150, right: 30, top: 8, bottom: 20 }, tooltip: { trigger: 'item' },
    xAxis: yAxis(), yAxis: { type: 'category', data: a.topics.map((t) => t.name).reverse(), axisLabel: { color: '#c9d4ee', fontSize: 11, width: 140, overflow: 'truncate' }, axisLine: { show: false } },
    series: [{ type: 'bar', data: a.topics.map((t) => t.heat).reverse(), itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#8b5cff' }, { offset: 1, color: '#3ad6ff' }] }, borderRadius: 4 }, barWidth: 12 }],
  }), [a])

  const rtOpt = useMemo(() => base({
    legend: { data: ['Rt', '活跃传播者 I', '沉默人数'] }, xAxis: xAxis(x), yAxis: [yAxis(), yAxis({ splitLine: { show: false } })],
    series: [
      { name: 'Rt', type: 'line', smooth: true, showSymbol: false, data: history.map((h) => h.Rt), lineStyle: { color: '#ff4d6a' }, itemStyle: { color: '#ff4d6a' }, markLine: { symbol: 'none', data: [{ yAxis: 1 }], lineStyle: { color: '#666', type: 'dashed' }, label: { formatter: 'Rt=1', color: '#888' } } },
      { name: '活跃传播者 I', type: 'bar', yAxisIndex: 1, data: history.map((h) => h.I), itemStyle: { color: 'rgba(58,214,255,.35)' } },
      { name: '沉默人数', type: 'line', yAxisIndex: 1, showSymbol: false, data: history.map((h) => h.silenced), lineStyle: { color: '#7c8aa8', type: 'dotted' }, itemStyle: { color: '#7c8aa8' } },
    ],
  }), [history.length])

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
        <div className="panel"><h3>个体观点演化轨迹 <span className="hint">随机抽样 240 名网民，颜色为当前立场（Deffuant/HK 动力学经典视图）</span></h3>{trajOpt && <Chart option={trajOpt} notMerge style={{ height: 300 }} />}</div>
        <div className="panel"><h3>立场迁移桑基图 <span className="hint">初始 → 当前</span></h3>{sankeyOpt && <Chart option={sankeyOpt} style={{ height: 300 }} />}</div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
        <div className="panel"><h3>各社群平均立场演化</h3><Chart option={commOpt} style={{ height: 280 }} /></div>
        <div className="panel"><h3>社群画像雷达</h3>{radarOpt && <Chart option={radarOpt} style={{ height: 280 }} />}</div>
      </div>
      <div className="grid g2">
        <div className="panel"><h3>极化 / 回音室 / 注意力集中度</h3><Chart option={structOpt} /></div>
        <div className="panel"><h3>传播再生数与沉默的螺旋</h3><Chart option={rtOpt} /></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="panel"><h3>舆论热词云 <span className="hint">jieba TF-IDF</span></h3>{wordOpt && <Chart option={wordOpt} style={{ height: 280 }} />}</div>
        <div className="panel"><h3>话题热度（含涌现话题）</h3>{topicOpt && <Chart option={topicOpt} notMerge style={{ height: 280 }} />}</div>
        <div className="panel">
          <h3>群体智能体语料池 <span className="hint">大模型为社群生成的评论样本</span></h3>
          <div className="scroll" style={{ maxHeight: 280 }}>
            {a && Object.entries(a.pools).map(([k, v]) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: COMM_COLORS[comms.indexOf(k)] }}>{k}</div>
                {v.slice(-4).map((c, i) => <div key={i} className="muted" style={{ fontSize: 12, padding: '3px 0 3px 8px', borderLeft: `2px solid ${stanceColor(c.stance)}`, margin: '4px 0' }}>{c.text}</div>)}
              </div>
            ))}
            {a && Object.keys(a.pools).length === 0 && <div className="dim">等待群体智能体生成…</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
