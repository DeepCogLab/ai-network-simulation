import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { Box, Pause, Play, RefreshCw } from 'lucide-react'
import { api } from '../api'
import { COMM_COLORS, fmt, ROLE_META, SEIR_COLORS, SEIR_LABEL, stanceColor, useStore } from '../store'
import AgentDrawer from '../components/AgentDrawer.jsx'

const ForceGraph3D = lazy(() => import('react-force-graph-3d'))

function useSize(ref) {
  const [s, setS] = useState({ w: 800, h: 600 })
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setS({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return s
}

// 社群聚类力：把同一社群的节点拉向各自的环形中心，核心账号居中，直观呈现社群/回音室结构
function clusterForce(R = 340, k = 0.12) {
  let nodes = []
  const f = (alpha) => {
    for (const n of nodes) {
      const c = n.c >= 0 ? n.c : -1
      const ang = (c / 6) * Math.PI * 2
      const cx = c < 0 ? 0 : Math.cos(ang) * R, cy = c < 0 ? 0 : Math.sin(ang) * R
      n.vx += (cx - n.x) * alpha * k
      n.vy += (cy - n.y) * alpha * k
    }
  }
  f.initialize = (ns) => { nodes = ns }
  return f
}

const COLOR_MODES = { op: '立场', st: 'SEIR 状态', c: '社群', role: '角色', bel: '传言相信度' }

export default function Network() {
  const { version, summary, history } = useStore()
  const [mode, setMode] = useState('follow') // follow | interact
  const [dim3, setDim3] = useState(false)
  const [colorBy, setColorBy] = useState('op')
  const [data, setData] = useState({ nodes: [], links: [] })
  const [sel, setSel] = useState(null)
  const [tMax, setTMax] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [onlyEngaged, setOnlyEngaged] = useState(false)
  const box = useRef()
  const fg = useRef()
  const size = useSize(box)
  const byId = useRef(new Map())
  const fitted = useRef(false)
  const tick = summary?.tick || 0

  // 拉取 & 增量合并（保持布局稳定）
  const load = async (reset = false) => {
    if (mode === 'follow') {
      const r = await api.get('/api/sim/network?max_edges=4500')
      if (reset || byId.current.size === 0 || data.links.length === 0 || data._mode !== 'follow') {
        const nodes = r.nodes.map((n) => ({ ...n }))
        byId.current = new Map(nodes.map((n) => [n.id, n]))
        setData({ nodes, links: r.edges.map(([s, t]) => ({ source: s, target: t })), _mode: 'follow' })
      } else {
        r.nodes.forEach((n) => Object.assign(byId.current.get(n.id) || {}, n))
        setData((d) => ({ ...d }))
      }
    } else {
      const r = await api.get('/api/sim/interactions')
      if (reset || data._mode !== 'interact') byId.current = new Map()
      const nodes = reset || data._mode !== 'interact' ? [] : [...data.nodes]
      r.nodes.forEach((n) => {
        const ex = byId.current.get(n.id)
        if (ex) Object.assign(ex, n)
        else { const nn = { ...n }; byId.current.set(n.id, nn); nodes.push(nn) }
      })
      const key = (l) => (l.source.id ?? l.source) + '-' + (l.target.id ?? l.target)
      const old = reset || data._mode !== 'interact' ? [] : data.links
      const have = new Set(old.map(key))
      const links = [...old, ...r.links.filter((l) => !have.has(key(l)))]
      setData({ nodes, links, _mode: 'interact' })
    }
  }
  useEffect(() => { load(true); setTMax(null); fitted.current = false }, [mode])
  useEffect(() => {
    if (!fg.current || dim3) return
    fg.current.d3Force('cluster', mode === 'follow' ? clusterForce() : null)
    fg.current.d3Force('charge')?.strength(mode === 'follow' ? -14 : -30)
  }, [mode, dim3, data._mode])
  useEffect(() => { if (version % 2 === 0) load() }, [version])

  // 回放
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setTMax((t) => { const n = (t ?? 0) + 1; if (n >= tick) { setPlaying(false); return null } return n }), 450)
    return () => clearInterval(id)
  }, [playing, tick])

  const color = (n) => {
    if (n.muted) return '#555'
    if (colorBy === 'op') return stanceColor(n.op)
    if (colorBy === 'st') return SEIR_COLORS[n.st ?? 0]
    if (colorBy === 'c') return n.c >= 0 ? COMM_COLORS[n.c] : ROLE_META[n.role].color
    if (colorBy === 'bel') return `hsl(${(1 - (n.bel ?? 0.5)) * 190}, 85%, ${45 + (n.bel ?? 0.5) * 10}%)`
    return ROLE_META[n.role].color
  }
  const val = (n) => n.role !== 'netizen' && n.role !== 'bot' ? 3 + Math.log10((n.f || 1) + 1) * 1.6 : 0.6 + Math.sqrt(n.recv || 0) * 0.5
  const radius = (n) => Math.sqrt(val(n)) * 2.2
  const visibleNode = (n) => (tMax == null || mode !== 'interact' || n.first <= tMax) && (!onlyEngaged || mode !== 'follow' || n.eng || n.role !== 'netizen')
  const visibleLink = (l) => {
    if (mode === 'interact') return tMax == null || l.t <= tMax
    if (onlyEngaged) { const s = l.source, t = l.target; return (s.eng || s.role !== 'netizen') && (t.eng || t.role !== 'netizen') }
    return true
  }
  const recent = (l) => mode === 'interact' && l.t >= (tMax ?? tick) - 1 && (tMax == null || l.t <= tMax)

  const stats = useMemo(() => {
    const ns = data.nodes
    const by = {}
    ns.forEach((n) => { by[n.role] = (by[n.role] || 0) + 1 })
    return { n: ns.length, e: data.links.length, by }
  }, [data])

  const common = {
    graphData: data, width: size.w, height: size.h, backgroundColor: 'rgba(0,0,0,0)',
    nodeId: 'id', nodeVal: val, nodeColor: color, nodeVisibility: visibleNode, linkVisibility: visibleLink,
    nodeLabel: (n) => `<div style="padding:4px 6px"><b>${n.name}</b> · ${ROLE_META[n.role].label}<br/>立场 ${n.op?.toFixed(2)} · 粉丝 ${fmt(n.f)}</div>`,
    linkColor: (l) => mode === 'interact' ? (l.k === 'repost' ? 'rgba(255,122,61,0.55)' : 'rgba(58,214,255,0.35)') : 'rgba(110,150,255,0.07)',
    linkDirectionalParticles: (l) => (recent(l) ? 2 : 0), linkDirectionalParticleWidth: 2.2, linkDirectionalParticleSpeed: 0.012,
    linkDirectionalParticleColor: (l) => (l.k === 'repost' ? '#ffb020' : '#3ad6ff'),
    onNodeClick: (n) => setSel(n.id), cooldownTicks: mode === 'follow' ? 140 : 80, warmupTicks: mode === 'follow' ? 40 : 10,
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 270px', height: 'calc(100vh - 88px)' }}>
      <div className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="row wrap" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
          <div className="tabs">
            <button className={mode === 'follow' ? 'on' : ''} onClick={() => setMode('follow')}>关注关系网络</button>
            <button className={mode === 'interact' ? 'on' : ''} onClick={() => setMode('interact')}>互动传播网络</button>
          </div>
          <div className="tabs">{Object.entries(COLOR_MODES).map(([k, v]) => <button key={k} className={colorBy === k ? 'on' : ''} onClick={() => setColorBy(k)}>{v}</button>)}</div>
          <button className={'btn sm' + (dim3 ? ' primary' : '')} onClick={() => setDim3(!dim3)}><Box size={13} /> 3D</button>
          {mode === 'follow' && <label className="row muted" style={{ cursor: 'pointer' }}><input type="checkbox" checked={onlyEngaged} onChange={(e) => setOnlyEngaged(e.target.checked)} />只看已卷入</label>}
          <button className="btn sm ghost" onClick={() => load(true)}><RefreshCw size={13} /></button>
        </div>
        <div ref={box} style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {dim3
            ? <Suspense fallback={<div className="empty">加载 3D 引擎…</div>}>
                <ForceGraph3D {...common} nodeRelSize={2.2} linkOpacity={0.25} linkWidth={mode === 'interact' ? 0.6 : 0} />
              </Suspense>
            : <ForceGraph2D ref={fg} {...common} onEngineStop={() => { if (!fitted.current && fg.current) { fg.current.zoomToFit(500, 30); fitted.current = true } }} nodeRelSize={2.2} linkWidth={(l) => (mode === 'interact' ? Math.min(3, 0.4 + l.w * 0.4) : 0.35)}
                nodeCanvasObjectMode={() => 'after'}
                nodeCanvasObject={(n, ctx, scale) => {
                  if (n.role !== 'netizen' && n.role !== 'bot' && scale > 0.7 && visibleNode(n)) {
                    ctx.font = `${11 / scale}px sans-serif`; ctx.fillStyle = 'rgba(223,231,255,.85)'; ctx.textAlign = 'center'
                    ctx.fillText(n.name, n.x, n.y + radius(n) + 9 / scale)
                  }
                }} />}
          <div className="legend">
            <b style={{ color: '#dfe7ff' }}>{COLOR_MODES[colorBy]}</b>
            {colorBy === 'op' && <><div className="gradient-bar" style={{ margin: '6px 0 3px' }} /><div className="row" style={{ justifyContent: 'space-between' }}><span>−1 {summary.card.stance_axis.neg.slice(0, 6)}</span><span>+1</span></div></>}
            {colorBy === 'st' && SEIR_LABEL.map((l, i) => <div key={l} className="li"><span className="dot" style={{ background: SEIR_COLORS[i] }} />{l}</div>)}
            {colorBy === 'c' && summary.communities.map((c, i) => <div key={c} className="li"><span className="dot" style={{ background: COMM_COLORS[i] }} />{c}</div>)}
            {colorBy === 'role' && Object.entries(ROLE_META).map(([k, v]) => <div key={k} className="li"><span className="dot" style={{ background: v.color }} />{v.label}</div>)}
            {colorBy === 'bel' && <div className="li">红=相信传言 · 蓝=不信</div>}
            <div className="dim" style={{ marginTop: 6 }}>节点大小：{mode === 'interact' ? '被互动次数' : '粉丝/被互动'}</div>
          </div>
        </div>
        {mode === 'interact' && (
          <div className="row" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
            <button className="btn sm" onClick={() => { if (!playing && tMax == null) setTMax(0); setPlaying(!playing) }}>{playing ? <Pause size={13} /> : <Play size={13} />} {playing ? '暂停' : '传播回放'}</button>
            <input type="range" min={0} max={Math.max(1, tick)} value={tMax ?? tick} onChange={(e) => { setPlaying(false); setTMax(+e.target.value >= tick ? null : +e.target.value) }} style={{ flex: 1 }} />
            <span className="mono" style={{ width: 90, textAlign: 'right', color: '#3ad6ff' }}>{tMax == null ? '实时' : history[tMax]?.time}</span>
          </div>
        )}
      </div>
      <div className="col" style={{ gap: 12, overflowY: 'auto' }}>
        <div className="panel">
          <h3>网络统计</h3>
          <table className="t"><tbody>
            <tr><td className="muted">显示节点</td><td className="mono">{stats.n}</td></tr>
            <tr><td className="muted">显示连边</td><td className="mono">{stats.e}</td></tr>
            {Object.entries(stats.by).map(([k, v]) => <tr key={k}><td className="muted"><span className="dot" style={{ background: ROLE_META[k]?.color, marginRight: 6 }} />{ROLE_META[k]?.label}</td><td className="mono">{v}</td></tr>)}
          </tbody></table>
        </div>
        <div className="panel">
          <h3>说明</h3>
          <div className="muted" style={{ lineHeight: 1.8, fontSize: 12 }}>
            {mode === 'follow'
              ? <>关注网络由 <b>随机块模型 + 偏好连接</b> 生成：社群内同质连接、核心账号按立场亲和被关注，呈现无标度与社区结构。切换「立场」着色可直观观察<b>回音室</b>与<b>极化</b>的形成。</>
              : <>互动传播网络记录谁转发 / 评论了谁（橙=转发，蓝=评论），粒子流表示最近 1 小时的信息流动。拖动时间轴或点击「传播回放」可重放舆情扩散全过程。</>}
          </div>
        </div>
        <Leaders onSel={setSel} />
      </div>
      <AgentDrawer id={sel} onClose={() => setSel(null)} />
    </div>
  )
}

function Leaders({ onSel }) {
  const version = useStore((s) => s.version)
  const [l, setL] = useState([])
  useEffect(() => { api.get('/api/sim/analysis').then((r) => setL(r.leaders)) }, [Math.floor(version / 3)])
  return (
    <div className="panel">
      <h3>意见领袖 TOP</h3>
      {l.slice(0, 12).map((x, i) => (
        <div key={x.id} className="row list-item" style={{ cursor: 'pointer' }} onClick={() => onSel(x.id)}>
          <span className="mono dim" style={{ width: 16 }}>{i + 1}</span>
          <span className="dot" style={{ background: ROLE_META[x.role].color }} />
          <span className="grow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.name}</span>
          <span className="mono" style={{ color: stanceColor(x.op), fontSize: 11 }}>{x.op.toFixed(2)}</span>
          <span className="mono dim" style={{ fontSize: 11 }}>{Math.round(x.recv)}</span>
        </div>
      ))}
    </div>
  )
}
