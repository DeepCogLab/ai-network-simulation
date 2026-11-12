import React, { useEffect, useState } from 'react'
import { Activity, BookOpen, Bot, Brain, FileText, GitFork, LayoutDashboard, MessagesSquare, Pause, Play, Settings2, Share2, ShieldAlert, SkipForward, Sparkles, Wifi, WifiOff } from 'lucide-react'
import { connectWS, useStore } from './store'
import Setup from './pages/Setup.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Social from './pages/Social.jsx'
import Network from './pages/Network.jsx'
import Cascade from './pages/Cascade.jsx'
import Analysis from './pages/Analysis.jsx'
import Intervene from './pages/Intervene.jsx'
import Agents from './pages/Agents.jsx'
import Report from './pages/Report.jsx'
import Theory from './pages/Theory.jsx'

const NAV = [
  { sec: '推演' },
  { key: 'setup', label: '情景配置', icon: Settings2, sub: '热搜→事件' },
  { key: 'dashboard', label: '态势总览', icon: LayoutDashboard },
  { key: 'social', label: '微言平台', icon: MessagesSquare, sub: '仿真社交' },
  { sec: '可视化' },
  { key: 'network', label: '传播网络', icon: Share2 },
  { key: 'cascade', label: '级联溯源', icon: GitFork },
  { key: 'analysis', label: '演化分析', icon: Activity },
  { sec: '决策' },
  { key: 'intervene', label: '干预中心', icon: ShieldAlert, sub: '推演对比' },
  { key: 'agents', label: '智能体', icon: Bot },
  { key: 'report', label: '研判报告', icon: FileText },
  { key: 'theory', label: '理论模型', icon: BookOpen },
]
const PAGES = { setup: Setup, dashboard: Dashboard, social: Social, network: Network, cascade: Cascade, analysis: Analysis, intervene: Intervene, agents: Agents, report: Report, theory: Theory }

export const STAGE_COLOR = { 潜伏期: '#7c8aa8', 爆发期: '#ff4d6a', 高峰期: '#ff7a3d', 蔓延期: '#ffb020', 衰退期: '#3ad6ff', 平息期: '#2bd99f' }

export default function App() {
  const { page, setPage, summary, refresh, loadMeta, toast } = useStore()
  useEffect(() => {
    loadMeta(); refresh(); connectWS()
    const h = () => useStore.setState({ page: (location.hash || '#setup').slice(1) })
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  const Page = PAGES[page] || Setup
  const needSim = page !== 'setup' && page !== 'theory'
  return (
    <div className="app">
      <TopBar />
      <nav className="sidebar">
        {NAV.map((n, i) => n.sec ? <div key={i} className="nav-sec">{n.sec}</div> : (
          <div key={n.key} className={'nav' + (page === n.key ? ' active' : '')} onClick={() => setPage(n.key)}>
            <n.icon size={16} /> {n.label} {n.sub && <span className="sub">{n.sub}</span>}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <LLMBadge />
      </nav>
      <main className="main">
        {needSim && !summary ? (
          <div className="empty">
            <Sparkles size={40} color="#3ad6ff" />
            <div style={{ fontSize: 15, color: '#c9d4ee' }}>尚未创建仿真</div>
            <div>请先在「情景配置」中选择一条实时热搜或自定义事件</div>
            <button className="btn primary" onClick={() => setPage('setup')}>前往情景配置</button>
          </div>
        ) : <Page />}
      </main>
      {toast && <div className={'toast ' + (toast.kind === 'error' ? 'err' : toast.kind === 'ok' ? 'ok' : '')}>{toast.msg}</div>}
    </div>
  )
}

function TopBar() {
  const { summary, running, busy, control, ws, history, notify } = useStore()
  const [speed, setSpeed] = useState(1)
  const latest = history[history.length - 1]
  const act = async (a) => {
    try { await control(a, { speed }) } catch (e) { notify(e.message, 'error') }
  }
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-logo"><span>镜</span></div>
        <div><b>舆镜</b><small>OPINION LENS · AGENT SIM</small></div>
      </div>
      <div className="event-title">
        {summary ? <>
          <span className="tag o">事件</span>
          <span className="t" title={summary.card.title}>{summary.card.title}</span>
          {latest && <span className="stage" style={{ color: STAGE_COLOR[latest.stage], borderColor: STAGE_COLOR[latest.stage] + '88' }}>{latest.stage}</span>}
          {latest?.rank && <span className="tag r">热搜 #{latest.rank}</span>}
        </> : <span className="dim">未加载事件</span>}
      </div>
      {summary && <>
        <div className="row" title="仿真时间（每步 1 小时）">
          <span className="dim">T{summary.tick}</span>
          <span className="clock">{latest?.time || summary.time}</span>
        </div>
        <div className="row">
          <select className="select" style={{ width: 92, padding: '6px 26px 6px 10px' }} value={speed} onChange={(e) => { setSpeed(+e.target.value); control(running ? 'start' : 'pause', { speed: +e.target.value }) }}>
            <option value={3}>慢速</option><option value={1}>标准</option><option value={0.2}>快速</option><option value={0}>极速</option>
          </select>
          {running
            ? <button className="btn" onClick={() => act('pause')}><Pause size={15} /> 暂停</button>
            : <button className="btn primary" onClick={() => act('start')}><Play size={15} /> 运行</button>}
          <button className="btn" disabled={running || busy} onClick={() => act('step')}><SkipForward size={15} /> 单步</button>
          {busy && <span className="tag c"><Brain size={12} className="pulse" /> 智能体思考中</span>}
        </div>
      </>}
      <span title={'实时通道 ' + ws}>{ws === 'online' ? <Wifi size={16} color="#2bd99f" /> : <WifiOff size={16} color="#ff4d6a" />}</span>
    </header>
  )
}

function LLMBadge() {
  const llm = useStore((s) => s.llm || s.meta?.llm)
  if (!llm) return null
  return (
    <div className="panel" style={{ padding: 10, fontSize: 11 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="status-dot" style={{ background: llm.enabled ? '#2bd99f' : '#ff4d6a' }} />
        <b style={{ fontSize: 12 }}>{llm.enabled ? '大模型在线' : '大模型未配置'}</b>
      </div>
      <div className="dim mono" style={{ wordBreak: 'break-all' }}>{llm.model}</div>
      <div className="row muted" style={{ marginTop: 6, justifyContent: 'space-between' }}>
        <span>调用 <b className="mono">{llm.calls}</b></span>
        <span>失败 <b className="mono">{llm.failures}</b></span>
      </div>
      <div className="row muted" style={{ justifyContent: 'space-between' }}>
        <span>Tokens <b className="mono">{((llm.prompt_tokens + llm.completion_tokens) / 1000).toFixed(1)}k</b></span>
        <span>{llm.avg_latency}s</span>
      </div>
    </div>
  )
}
