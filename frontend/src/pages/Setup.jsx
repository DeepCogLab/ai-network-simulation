import React, { useEffect, useState } from 'react'
import { Flame, Loader2, Newspaper, RefreshCw, Rocket, Wand2 } from 'lucide-react'
import { api } from '../api'
import { fmt, useStore } from '../store'

const SRC = [['weibo', '微博热搜'], ['baidu', '百度热搜'], ['tencent', '腾讯新闻'], ['chinanews', '中新网']]
const ALGS = { timeline: '时间线（仅关注）', hot: '热度优先', personalized: '个性化推荐（易成回音室）', diverse: '多元化推荐（跨立场）' }

export default function Setup() {
  const { meta, notify, setPage, refresh } = useStore()
  const [src, setSrc] = useState('weibo')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(false)
  const [card, setCard] = useState(null)
  const [gen, setGen] = useState(false)
  const [custom, setCustom] = useState({ title: '', desc: '' })
  const [cfg, setCfg] = useState(null)
  const [maxTicks, setMaxTicks] = useState(72)
  const [creating, setCreating] = useState(false)

  useEffect(() => { if (meta && !cfg) setCfg({ ...meta.defaults }) }, [meta])
  const load = async (k = src) => {
    setLoading(true)
    try { const r = await api.get('/api/sources/' + k); setData((d) => ({ ...d, [k]: r })) } catch (e) { notify('获取失败：' + e.message, 'error') }
    setLoading(false)
  }
  useEffect(() => { if (!data[src]) load(src) }, [src])

  const genCard = async (title, desc = '') => {
    setGen(true); setCard(null)
    try { setCard(await api.post('/api/scenario/card', { title, desc, use_llm: true })) } catch (e) { notify(e.message, 'error') }
    setGen(false)
  }
  const create = async () => {
    setCreating(true)
    try {
      await api.post('/api/sim/create', { card, cfg, max_ticks: maxTicks })
      await refresh()
      notify('仿真已创建，点击右上角「运行」开始推演', 'ok')
      setPage('dashboard')
    } catch (e) { notify(e.message, 'error') }
    setCreating(false)
  }
  const cur = data[src]
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }))

  return (
    <div className="grid" style={{ gridTemplateColumns: '380px minmax(0,1fr) 340px', alignItems: 'start' }}>
      {/* 实时数据 */}
      <div className="panel" style={{ height: 'calc(100vh - 90px)', display: 'flex', flexDirection: 'column' }}>
        <h3><Flame size={14} color="#ff7a3d" /> 实时热点数据源 <span className="hint">{cur && new Date(cur.fetched_at * 1000).toLocaleTimeString()}{cur?.offline && ' · 离线缓存'}</span></h3>
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="tabs">{SRC.map(([k, n]) => <button key={k} className={src === k ? 'on' : ''} onClick={() => setSrc(k)}>{n}</button>)}</div>
          <button className="btn sm ghost" onClick={() => load()} title="刷新"><RefreshCw size={13} className={loading ? 'spin' : ''} /></button>
        </div>
        <div className="scroll grow">
          {!cur && <div className="empty"><Loader2 className="spin" /></div>}
          {cur?.items?.map((it, i) => (
            <div key={i} className="list-item row" style={{ cursor: 'pointer', alignItems: 'flex-start' }} onClick={() => genCard(it.title, it.desc || '')}>
              <span className="mono" style={{ width: 22, color: i < 3 ? '#ff7a3d' : '#66738f', fontWeight: 700 }}>{it.rank || '顶'}</span>
              <div className="grow">
                <div style={{ lineHeight: 1.5 }}>{it.title} {it.label && <span className="tag r" style={{ padding: '0 5px' }}>{it.label}</span>}</div>
                {it.desc && <div className="dim" style={{ fontSize: 11, marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.desc}</div>}
                <div className="dim" style={{ fontSize: 11 }}>{it.hot ? '热度 ' + fmt(it.hot) : ''} {it.source || ''} {it.category || ''}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }} className="col">
          <div className="muted" style={{ fontSize: 12 }}>或自定义事件</div>
          <input className="input" placeholder="事件标题，如：某品牌奶茶被曝使用过期原料" value={custom.title} onChange={(e) => setCustom({ ...custom, title: e.target.value })} />
          <textarea className="input" style={{ minHeight: 50 }} placeholder="补充描述（可选）" value={custom.desc} onChange={(e) => setCustom({ ...custom, desc: e.target.value })} />
          <button className="btn" disabled={!custom.title || gen} onClick={() => genCard(custom.title, custom.desc)}><Wand2 size={14} /> 生成事件卡</button>
        </div>
      </div>

      {/* 事件卡 */}
      <div className="panel" style={{ minHeight: 'calc(100vh - 90px)' }}>
        <h3><Newspaper size={14} /> 事件卡 <span className="hint">大模型将热点抽象为可计算的舆论议题，可手动编辑</span></h3>
        {gen && <div className="empty"><Loader2 size={30} className="spin" color="#3ad6ff" /><div>大模型正在分析事件、设计立场轴与传言…</div></div>}
        {!gen && !card && <div className="empty"><Newspaper size={40} /><div>从左侧点击一条实时热点，或自定义事件</div></div>}
        {!gen && card && <CardEditor card={card} setCard={setCard} />}
      </div>

      {/* 参数 */}
      <div className="panel" style={{ height: 'calc(100vh - 90px)', overflowY: 'auto' }}>
        <h3>仿真参数</h3>
        {cfg && <div className="col" style={{ gap: 12 }}>
          <Group title="规模与主体">
            <Range label="智能体总数" k="n_agents" min={300} max={4000} step={100} cfg={cfg} set={set} />
            <Range label="网民社群数" k="n_communities" min={2} max={6} step={1} cfg={cfg} set={set} />
            <Range label="营销号/水军比例" k="bot_ratio" min={0} max={0.15} step={0.01} cfg={cfg} set={set} />
            <Range label="水军立场" k="bot_stance" min={-1} max={1} step={0.1} cfg={cfg} set={set} />
            <Range label="推演步数（小时）" v={maxTicks} onChange={setMaxTicks} min={12} max={240} step={12} />
          </Group>
          <Group title="大模型驱动">
            <Toggle label="启用大模型智能体" v={cfg.llm_enabled} onChange={(v) => set('llm_enabled', v)} />
            <Range label="大模型个体网民数" k="llm_netizens" min={0} max={30} step={1} cfg={cfg} set={set} />
            <Range label="每步最多个体调用" k="max_llm_per_tick" min={1} max={20} step={1} cfg={cfg} set={set} />
            <Range label="群体智能体推演间隔（步）" k="group_interval" min={1} max={6} step={1} cfg={cfg} set={set} />
            <Toggle label="政务账号 AI 自主回应" v={cfg.gov_auto} onChange={(v) => set('gov_auto', v)} />
          </Group>
          <Group title="平台推荐算法">
            <select className="select" value={cfg.algorithm} onChange={(e) => set('algorithm', e.target.value)}>
              {Object.entries(ALGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Group>
          <Group title="理论模型参数">
            <Range label="有界信任阈值 ε" k="epsilon" min={0.1} max={1.5} step={0.05} cfg={cfg} set={set} />
            <Range label="观点收敛速率 μ" k="mu" min={0} max={0.5} step={0.01} cfg={cfg} set={set} />
            <Range label="逆火效应强度" k="backfire" min={0} max={0.3} step={0.01} cfg={cfg} set={set} />
            <Range label="沉默的螺旋强度" k="silence" min={0} max={1} step={0.05} cfg={cfg} set={set} />
            <Range label="兴趣衰减率 γ" k="gamma" min={0.02} max={0.4} step={0.01} cfg={cfg} set={set} />
            <Range label="Hawkes 自激强度 α" k="alpha_notify" min={0} max={0.1} step={0.005} cfg={cfg} set={set} />
            <Range label="史翠珊效应强度" k="streisand" min={0} max={1.5} step={0.1} cfg={cfg} set={set} />
            <Range label="随机种子" k="seed" min={1} max={999} step={1} cfg={cfg} set={set} />
          </Group>
          <button className="btn primary" style={{ justifyContent: 'center', padding: 11 }} disabled={!card || creating} onClick={create}>
            {creating ? <Loader2 size={15} className="spin" /> : <Rocket size={15} />} 生成社交网络并创建仿真
          </button>
        </div>}
      </div>
    </div>
  )
}

function CardEditor({ card, setCard }) {
  const up = (k, v) => setCard({ ...card, [k]: v })
  return (
    <div className="col fadein" style={{ gap: 12 }}>
      <div className="row wrap">
        {card.llm_generated ? <span className="tag p">大模型生成</span> : <span className="tag">规则生成</span>}
        <span className="tag c">{card.category}</span>
        <span className="tag o">争议度 {(card.controversy * 100).toFixed(0)}</span>
        <span className="tag r">敏感度 {(card.sensitivity * 100).toFixed(0)}</span>
        <span className="tag">负面度 {(card.negativity * 100).toFixed(0)}</span>
      </div>
      <label className="f">事件标题<input className="input" style={{ fontSize: 16, fontWeight: 600 }} value={card.title} onChange={(e) => up('title', e.target.value)} /></label>
      <label className="f">事件概要<textarea className="input" value={card.summary} onChange={(e) => up('summary', e.target.value)} /></label>
      <label className="f">背景<textarea className="input" value={card.background} onChange={(e) => up('background', e.target.value)} /></label>
      <div className="grid g2">
        <label className="f"><span>立场轴 −1 端</span><input className="input" style={{ borderColor: 'rgba(255,77,106,.5)' }} value={card.stance_axis?.neg} onChange={(e) => up('stance_axis', { ...card.stance_axis, neg: e.target.value })} /></label>
        <label className="f"><span>立场轴 +1 端</span><input className="input" style={{ borderColor: 'rgba(58,214,255,.5)' }} value={card.stance_axis?.pos} onChange={(e) => up('stance_axis', { ...card.stance_axis, pos: e.target.value })} /></label>
      </div>
      <label className="f">待证实说法 / 传言（用于谣言传播与辟谣仿真）<textarea className="input" style={{ minHeight: 50 }} value={card.claim} onChange={(e) => up('claim', e.target.value)} /></label>
      <div className="grid g2">
        <label className="f">当事方<input className="input" value={card.party?.name} onChange={(e) => up('party', { ...card.party, name: e.target.value })} /></label>
        <label className="f">责任职能部门<input className="input" value={card.gov_dept} onChange={(e) => up('gov_dept', e.target.value)} /></label>
      </div>
      <label className="f">话题标签（逗号分隔，第一个为主话题）
        <input className="input" value={(card.hashtags || []).join('，')} onChange={(e) => up('hashtags', e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean))} />
      </label>
      <div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>引爆帖子（初始种子）</div>
        {(card.seed_posts || []).map((p, i) => (
          <div key={i} className="list-item" style={{ border: '1px solid var(--line)', marginBottom: 6 }}>
            <div className="row"><span className="tag">{p.author_role}</span><span className="dim">立场 {p.stance} · 传言支持 {p.belief}</span></div>
            <div style={{ marginTop: 4, lineHeight: 1.6 }}>{p.content}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

const Group = ({ title, children }) => (
  <div className="col" style={{ gap: 10, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
    <div style={{ fontSize: 12, color: '#3ad6ff', fontWeight: 600 }}>{title}</div>{children}
  </div>
)
const Range = ({ label, k, cfg, set, min, max, step, v, onChange }) => {
  const val = v ?? cfg[k]
  return (
    <label className="f"><div>{label}<span className="v">{val}</span></div>
      <input type="range" min={min} max={max} step={step} value={val} onChange={(e) => (onChange ? onChange(+e.target.value) : set(k, +e.target.value))} />
    </label>
  )
}
export const Toggle = ({ label, v, onChange }) => (
  <span className={'switch' + (v ? ' on' : '')} onClick={() => onChange(!v)}><i />{label}</span>
)
