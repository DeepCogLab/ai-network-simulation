import React, { useEffect, useMemo, useState } from 'react'
import { Ban, Bot, EyeOff, FlaskConical, Gauge, Loader2, Megaphone, Pin, RotateCcw, Send, ShieldCheck, Shuffle, Sparkles, Trash2, Zap } from 'lucide-react'
import { api } from '../api'
import Chart, { base, xAxis, yAxis } from '../components/Chart.jsx'
import { fmt, pct, ROLE_META, useStore } from '../store'
import { Timeline } from './Dashboard.jsx'
import { Toggle } from './Setup.jsx'

const GOALS = [
  '发布权威通报，回应关切，澄清不实传言',
  '公布调查进展与处置结果，表态严肃追责',
  '发布深度报道，还原事件来龙去脉',
  '发表评论引导理性讨论，反对网暴',
  '承认问题并真诚道歉，公布整改措施',
  '强硬否认，警告造谣者将被追究法律责任',
]

const QUICK = [
  { type: 'delete', icon: Trash2, label: '删除谣言帖', desc: '删除传言支持度最高的 30 条', params: { mode: 'rumor', count: 30 }, danger: true },
  { type: 'delete', icon: Trash2, label: '删除负面帖', desc: '删除批评最激烈且传播广的 30 条', params: { mode: 'negative', count: 30 }, danger: true },
  { type: 'mute', icon: Ban, label: '禁言高传播者', desc: '禁言 10 个批评立场的高互动账号 12h', params: { count: 10, ticks: 12 }, danger: true },
  { type: 'throttle', icon: Gauge, label: '负面内容限流', desc: '立场 < −0.4 的内容降权 12h', params: { lo: -1, hi: -0.4, ticks: 12 } },
  { type: 'hot_remove', icon: EyeOff, label: '撤下事件热搜', desc: '事件话题退出热搜榜（议程干预）', params: {} },
  { type: 'hot_restore', icon: RotateCcw, label: '恢复热搜', desc: '恢复全部话题上榜', params: {} },
  { type: 'clean_bots', icon: Bot, label: '清理水军', desc: '封禁营销号并删除其内容', params: {} },
]
const ALGS = [['timeline', '时间线'], ['hot', '热度优先'], ['personalized', '个性化'], ['diverse', '多元化']]

export default function Intervene() {
  const { summary, events, notify, refresh } = useStore()
  const [accounts, setAccounts] = useState([])
  const [actor, setActor] = useState(null)
  const [goal, setGoal] = useState(GOALS[0])
  const [content, setContent] = useState('')
  const [stance, setStance] = useState(0.3)
  const [belief, setBelief] = useState(0.1)
  const [boost, setBoost] = useState(true)
  const [pin, setPin] = useState(false)
  const [kind, setKind] = useState('debunk')
  const [draft, setDraft] = useState(null)
  const [drafting, setDrafting] = useState(false)
  const [plan, setPlan] = useState([])
  const [whatif, setWhatif] = useState(null)
  const [wiLoading, setWiLoading] = useState(false)
  const [wiTicks, setWiTicks] = useState(24)

  useEffect(() => {
    Promise.all(['gov', 'media', 'kol', 'expert', 'party'].map((r) => api.get('/api/sim/agents?role=' + r + '&limit=10'))).then((rs) => {
      const all = rs.flat(); setAccounts(all); setActor(all[0])
    })
  }, [summary?.card?.title])

  const makeDraft = async () => {
    setDrafting(true)
    try {
      const r = await api.post('/api/sim/draft', { actor: actor.name, role: actor.role, goal })
      setDraft(r); setContent(r.content); setStance(+(r.stance ?? 0.3).toFixed(2)); setBelief(+(r.belief ?? 0.1).toFixed(2))
    } catch (e) { notify(e.message, 'error') }
    setDrafting(false)
  }
  const pubIv = () => ({ type: kind, actor_id: actor.id, content, stance, belief, boost, pin, arousal: 0.3 })
  const send = async (iv) => {
    try { await api.post('/api/sim/intervene', iv); notify('干预已生效', 'ok'); refresh() } catch (e) { notify(e.message, 'error') }
  }
  const runWhatIf = async (ivs) => {
    if (!ivs.length) return notify('请先把干预措施加入推演方案', 'error')
    setWiLoading(true)
    try { setWhatif({ ...(await api.post('/api/sim/whatif', { interventions: ivs, ticks: wiTicks, runs: 2 })), ivs }) } catch (e) { notify(e.message, 'error') }
    setWiLoading(false)
  }
  const ivLabel = (iv) => iv.label || ({ publish: '发布', debunk: '辟谣', inject: '注入信息' }[iv.type] + '：' + (iv.content || '').slice(0, 16))

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)', alignItems: 'start' }}>
      <div className="col" style={{ gap: 12 }}>
        <div className="panel">
          <h3><Megaphone size={14} />扮演主体发布 <span className="hint">以政务/媒体/大V身份发声，由大模型辅助撰稿与效果预判</span></h3>
          <div className="grid g2">
            <label className="f">发布账号
              <select className="select" value={actor?.id ?? ''} onChange={(e) => setActor(accounts.find((a) => a.id === +e.target.value))}>
                {accounts.map((a) => <option key={a.id} value={a.id}>[{ROLE_META[a.role].label}] {a.name}</option>)}
              </select>
            </label>
            <label className="f">发布类型
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="debunk">辟谣 / 权威通报</option><option value="publish">普通发布 / 评论</option><option value="inject">注入新信息（新证据、反转）</option>
              </select>
            </label>
          </div>
          <label className="f" style={{ marginTop: 10 }}>沟通策略
            <div className="row"><select className="select" value={goal} onChange={(e) => setGoal(e.target.value)}>{GOALS.map((g) => <option key={g}>{g}</option>)}</select>
              <button className="btn" disabled={drafting || !actor} onClick={makeDraft}>{drafting ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} AI 撰稿</button></div>
          </label>
          <textarea className="input" style={{ marginTop: 10, minHeight: 110 }} placeholder="输入要发布的内容，或点击 AI 撰稿" value={content} onChange={(e) => setContent(e.target.value)} />
          {draft && <div className="row wrap" style={{ marginTop: 8, fontSize: 12 }}>
            <span className="tag g">预判效果</span><span className="muted">{draft.predicted_effect}</span>
            <span className="tag r">风险</span><span className="muted">{draft.risk}</span>
          </div>}
          <div className="grid g2" style={{ marginTop: 10 }}>
            <label className="f"><div>内容立场<span className="v">{stance}</span></div><input type="range" min={-1} max={1} step={0.05} value={stance} onChange={(e) => setStance(+e.target.value)} /></label>
            <label className="f"><div>对传言的支持度<span className="v">{belief}</span></div><input type="range" min={0} max={1} step={0.05} value={belief} onChange={(e) => setBelief(+e.target.value)} /></label>
          </div>
          <div className="row" style={{ marginTop: 10, gap: 16 }}>
            <Toggle label="流量加推" v={boost} onChange={setBoost} />
            <Toggle label="置顶" v={pin} onChange={setPin} />
            <div style={{ flex: 1 }} />
            <button className="btn" disabled={!content} onClick={() => setPlan([...plan, { ...pubIv(), label: `${actor.name}${kind === 'debunk' ? '辟谣' : '发布'}` }])}><FlaskConical size={14} /> 加入推演方案</button>
            <button className="btn primary" disabled={!content || !actor} onClick={() => send(pubIv())}><Send size={14} /> 立即发布</button>
          </div>
        </div>

        <div className="panel">
          <h3><ShieldCheck size={14} />平台治理措施 <span className="hint">点击立即执行；⊕ 加入推演方案</span></h3>
          <div className="grid g2">
            {QUICK.map((q) => (
              <div key={q.label} className="list-item row" style={{ border: '1px solid var(--line)' }}>
                <q.icon size={18} color={q.danger ? '#ff8b9c' : '#3ad6ff'} />
                <div className="grow"><div style={{ fontWeight: 600 }}>{q.label}</div><div className="dim" style={{ fontSize: 11 }}>{q.desc}</div></div>
                <button className="btn sm ghost" title="加入推演方案" onClick={() => setPlan([...plan, { type: q.type, ...q.params, label: q.label }])}>⊕</button>
                <button className={'btn sm' + (q.danger ? ' danger' : '')} onClick={() => send({ type: q.type, ...q.params })}><Zap size={12} /></button>
              </div>
            ))}
            <div className="list-item row" style={{ border: '1px solid var(--line)' }}>
              <Pin size={18} color="#3ad6ff" />
              <div className="grow"><div style={{ fontWeight: 600 }}>置顶官方话题</div><div className="dim" style={{ fontSize: 11 }}>#{summary.card.hashtags?.[0]?.slice(0, 8)}官方通报# 置顶热搜</div></div>
              <button className="btn sm" onClick={() => send({ type: 'hot_pin', topic: summary.card.hashtags[0] + '官方通报' })}><Zap size={12} /></button>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <Shuffle size={16} color="#a66bff" /><span style={{ fontWeight: 600 }}>推荐算法</span>
            <div className="tabs">{ALGS.map(([k, n]) => <button key={k} className={summary.cfg.algorithm === k ? 'on' : ''} onClick={() => send({ type: 'algorithm', algorithm: k })}>{n}</button>)}</div>
            <button className="btn sm ghost" onClick={() => setPlan([...plan, { type: 'algorithm', algorithm: 'diverse', label: '切换多元化推荐' }])}>⊕ 多元化</button>
          </div>
        </div>
        <Timeline events={events.filter((e) => e.kind === 'intervention' || e.kind === 'gov')} height={220} />
      </div>

      <div className="col" style={{ gap: 12 }}>
        <div className="panel">
          <h3><FlaskConical size={14} />平行推演（反事实对比）<span className="hint">从当前状态克隆两个世界：不干预 vs 执行方案</span></h3>
          <div className="col" style={{ gap: 6 }}>
            {plan.length === 0 && <div className="dim" style={{ padding: 8 }}>在左侧点击「加入推演方案」或 ⊕ 组合多项干预措施</div>}
            {plan.map((iv, i) => (
              <div key={i} className="row list-item" style={{ border: '1px solid var(--line)' }}>
                <span className="tag p">{i + 1}</span><span className="grow">{ivLabel(iv)}</span>
                <button className="btn sm ghost" onClick={() => setPlan(plan.filter((_, j) => j !== i))}>移除</button>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted">推演时长</span>
            <div className="tabs">{[12, 24, 48].map((t) => <button key={t} className={wiTicks === t ? 'on' : ''} onClick={() => setWiTicks(t)}>{t} 小时</button>)}</div>
            <div style={{ flex: 1 }} />
            <button className="btn primary" disabled={wiLoading || !plan.length} onClick={() => runWhatIf(plan)}>{wiLoading ? <Loader2 size={14} className="spin" /> : <FlaskConical size={14} />} 开始平行推演</button>
          </div>
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>为保证速度，平行推演中大模型智能体以规则模式运行，结果为 2 次随机种子的平均。</div>
        </div>
        {whatif && <WhatIfResult r={whatif} />}
      </div>
    </div>
  )
}

function WhatIfResult({ r }) {
  const metrics = [['heat', '话题热度'], ['belief_rate', '传言相信率'], ['neg_share', '负面情绪占比'], ['trust_gov', '政务公信力'], ['op_mean', '立场均值'], ['polarization', '极化指数']]
  const last = (k, w) => r[w][k][r[w][k].length - 1]
  const sum = (k, w) => r[w][k].reduce((a, b) => a + b, 0)
  const better = { heat: -1, belief_rate: -1, neg_share: -1, trust_gov: 1, op_mean: 0, polarization: -1 }
  return (
    <>
      <div className="panel fadein">
        <h3>效果评估</h3>
        <table className="t">
          <thead><tr><th>指标</th><th>不干预</th><th>执行方案</th><th>变化</th></tr></thead>
          <tbody>
            {metrics.map(([k, n]) => {
              const isCum = k === 'heat'
              const a = isCum ? sum(k, 'base') : last(k, 'base'), b = isCum ? sum(k, 'iv') : last(k, 'iv')
              const d = isCum ? (b - a) / Math.max(1, a) : b - a
              const good = better[k] === 0 ? null : d * better[k] > 0
              return (
                <tr key={k}>
                  <td>{n}{isCum && <span className="dim">（累计）</span>}</td>
                  <td className="mono">{isCum ? Math.round(a / 1e4) + '万' : a.toFixed(3)}</td>
                  <td className="mono">{isCum ? Math.round(b / 1e4) + '万' : b.toFixed(3)}</td>
                  <td className="mono" style={{ color: good == null ? '#9aa7c7' : good ? '#2bd99f' : '#ff6b81' }}>{isCum ? (d > 0 ? '+' : '') + pct(d) : (d > 0 ? '+' : '') + d.toFixed(3)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="grid g2">
        {metrics.map(([k, n]) => (
          <div key={k} className="panel">
            <h3>{n}</h3>
            <Chart style={{ height: 170 }} notMerge option={base({ grid: { left: 40, right: 8, top: 24, bottom: 22 }, legend: { data: ['不干预', '执行方案'] }, xAxis: xAxis(r.time, { axisLabel: { color: '#8a97b5', fontSize: 9 } }), yAxis: yAxis({ scale: true, axisLabel: { color: '#8a97b5', fontSize: 10, formatter: (v) => (Math.abs(v) >= 1e4 ? fmt(v) : +v.toFixed(2)) } }),
              series: [{ name: '不干预', type: 'line', showSymbol: false, smooth: true, data: r.base[k], lineStyle: { color: '#7c8aa8', type: 'dashed' }, itemStyle: { color: '#7c8aa8' } },
                { name: '执行方案', type: 'line', showSymbol: false, smooth: true, data: r.iv[k], lineStyle: { color: '#3ad6ff', width: 2 }, itemStyle: { color: '#3ad6ff' }, areaStyle: { color: 'rgba(58,214,255,.08)' } }] })} />
          </div>
        ))}
      </div>
    </>
  )
}
