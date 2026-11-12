import React, { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { RefreshCw } from 'lucide-react'
import { api } from '../api'
import Chart, { base, xAxis, yAxis } from '../components/Chart.jsx'
import { fmt, ROLE_META, stanceColor, useStore } from '../store'

export default function Cascade() {
  const { version, history } = useStore()
  const [list, setList] = useState([])
  const [idx, setIdx] = useState(0)
  const [layout, setLayout] = useState('radialout')
  const [colorBy, setColorBy] = useState('stance')
  const box = useRef()
  const fg = useRef()
  const [size, setSize] = useState({ w: 600, h: 500 })
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(box.current); return () => ro.disconnect()
  }, [])
  const load = () => api.get('/api/sim/cascades?top=8').then(setList)
  useEffect(() => { load() }, [])
  useEffect(() => { if (version % 3 === 0) load() }, [version])

  const cur = list[idx]
  const maxT = useMemo(() => cur ? Math.max(...cur.nodes.map((n) => n.tick)) : 0, [cur])
  const minT = cur?.root.tick || 0
  const graph = useMemo(() => {
    if (!cur) return { nodes: [], links: [] }
    return { nodes: cur.nodes.map((n) => ({ ...n })), links: cur.nodes.filter((n) => n.parent != null).map((n) => ({ source: n.parent, target: n.id })) }
  }, [cur?.root.id, cur?.size])

  const depthOpt = useMemo(() => {
    if (!cur) return null
    const d = {}; const par = new Map(cur.nodes.map((n) => [n.id, n.parent]))
    const depth = (id) => { let k = 0, p = par.get(id); while (p != null) { k++; p = par.get(p) } return k }
    cur.nodes.forEach((n) => { const k = depth(n.id); d[k] = (d[k] || 0) + 1 })
    const ks = Object.keys(d).map(Number).sort((a, b) => a - b)
    return base({ grid: { left: 36, right: 10, top: 16, bottom: 24 }, xAxis: { ...xAxis(ks.map((k) => k + '层')), boundaryGap: true }, yAxis: yAxis(),
      series: [{ type: 'bar', data: ks.map((k) => d[k]), itemStyle: { color: '#3ad6ff', borderRadius: [4, 4, 0, 0] }, barWidth: '55%' }] })
  }, [cur])

  const growthOpt = useMemo(() => {
    if (!list.length) return null
    const T = history.length
    return base({ legend: { show: false }, grid: { left: 36, right: 10, top: 16, bottom: 24 }, xAxis: xAxis(history.map((h) => h.time)), yAxis: yAxis(),
      series: list.slice(0, 6).map((c, i) => {
        const cnt = new Array(T).fill(0)
        c.nodes.forEach((n) => { if (n.tick < T) cnt[n.tick]++ })
        let acc = 0
        return { name: c.root.name, type: 'line', smooth: true, showSymbol: false, data: cnt.map((v) => (acc += v)), lineStyle: { width: i === idx ? 3 : 1.2 }, emphasis: { focus: 'series' } }
      }) })
  }, [list, idx, history.length])

  const nodeColor = (n) => {
    if (colorBy === 'stance') return stanceColor(n.stance)
    if (colorBy === 'role') return ROLE_META[n.role]?.color || '#4d9fff'
    const k = maxT > minT ? (n.tick - minT) / (maxT - minT) : 0
    return `hsl(${200 - k * 190}, 90%, 58%)`
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: '300px minmax(0,1fr) 300px', height: 'calc(100vh - 88px)' }}>
      <div className="panel scroll">
        <h3>转发级联 TOP <span className="hint"><RefreshCw size={12} style={{ cursor: 'pointer' }} onClick={load} /></span></h3>
        {list.length === 0 && <div className="dim">暂无转发级联</div>}
        {list.map((c, i) => (
          <div key={c.root.id} className="list-item" style={{ cursor: 'pointer', borderColor: i === idx ? 'var(--cyan)' : 'var(--line)', marginBottom: 6, background: i === idx ? 'rgba(58,214,255,.06)' : '' }} onClick={() => setIdx(i)}>
            <div className="row"><span className="dot" style={{ background: ROLE_META[c.root.role].color }} /><b style={{ fontSize: 12 }}>{c.root.name}</b><span className="dim mono" style={{ marginLeft: 'auto', fontSize: 11 }}>{c.root.time}</span></div>
            <div className="muted" style={{ fontSize: 12, margin: '4px 0', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.root.content}</div>
            <div className="row" style={{ fontSize: 11 }}><span className="tag o">规模 {c.size}</span><span className="tag c">深度 {c.depth}</span><span className="tag p">病毒性 {c.virality}</span></div>
          </div>
        ))}
      </div>
      <div className="panel" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="row" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
          <div className="tabs">{[['radialout', '放射树'], ['td', '层级树'], ['lr', '时间流'], [null, '力导向']].map(([k, n]) => <button key={n} className={layout === k ? 'on' : ''} onClick={() => setLayout(k)}>{n}</button>)}</div>
          <div className="tabs">{[['stance', '立场'], ['role', '角色'], ['time', '时间']].map(([k, n]) => <button key={k} className={colorBy === k ? 'on' : ''} onClick={() => setColorBy(k)}>{n}</button>)}</div>
          <span className="dim" style={{ marginLeft: 'auto', fontSize: 12 }}>根节点为原创帖，边为转发关系</span>
        </div>
        <div ref={box} style={{ flex: 1, minHeight: 0 }}>
          <ForceGraph2D ref={fg} onEngineStop={() => fg.current?.zoomToFit(400, 30)} key={(cur?.root.id ?? 'x') + String(layout)} graphData={graph} width={size.w} height={size.h} dagMode={layout || undefined} dagLevelDistance={layout === 'radialout' ? 38 : 46}
            backgroundColor="rgba(0,0,0,0)" nodeRelSize={3} nodeVal={(n) => (n.parent == null ? 18 : n.role !== 'netizen' && n.role !== 'bot' ? 6 : 1.4)} nodeColor={nodeColor}
            nodeLabel={(n) => `<div style="padding:4px 6px;max-width:260px"><b>${n.author}</b> · ${n.time || ''} T${n.tick}<br/>${n.content}</div>`}
            linkColor={() => 'rgba(140,170,255,0.3)'} linkDirectionalArrowLength={2.5} linkDirectionalArrowRelPos={1} d3VelocityDecay={0.35} cooldownTicks={120}
            linkDirectionalParticles={1} linkDirectionalParticleWidth={1.4} linkDirectionalParticleSpeed={0.008} />
        </div>
      </div>
      <div className="col" style={{ gap: 12, overflowY: 'auto' }}>
        {cur && <div className="panel">
          <h3>级联结构指标</h3>
          <div className="grid g2">
            <div className="kpi"><div className="k">规模</div><div className="v">{cur.size}</div></div>
            <div className="kpi"><div className="k">最大深度</div><div className="v">{cur.depth}</div></div>
            <div className="kpi"><div className="k">结构病毒性 ν</div><div className="v">{cur.virality}</div></div>
            <div className="kpi"><div className="k">持续时长</div><div className="v">{maxT - minT}h</div></div>
          </div>
          <div className="dim" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>结构病毒性 = 级联树中节点对平均距离（Goel 2016）。≈2 表示“广播式”扩散，越大越接近“病毒式”多层接力。</div>
        </div>}
        <div className="panel"><h3>逐层传播广度</h3>{depthOpt && <Chart option={depthOpt} notMerge style={{ height: 180 }} />}</div>
        <div className="panel"><h3>级联累计增长</h3>{growthOpt && <Chart option={growthOpt} notMerge style={{ height: 200 }} />}</div>
      </div>
    </div>
  )
}
