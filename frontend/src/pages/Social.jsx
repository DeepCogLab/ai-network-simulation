import React, { useCallback, useEffect, useState } from 'react'
import { BadgeCheck, Flame, Heart, Home, Landmark, MessageCircle, Mic, Newspaper, Repeat2, Search, ShieldCheck, Star, Users, X, Bot } from 'lucide-react'
import { api } from '../api'
import { fmt, ROLE_META, stanceColor, useStore } from '../store'
import AgentDrawer from '../components/AgentDrawer.jsx'

const NAV = [
  ['', '全部动态', Home], ['hot', '热门微博', Flame], ['gov', '政务', Landmark], ['media', '媒体', Newspaper], ['kol', '大V', Star],
  ['expert', '专家', Mic], ['netizen', '网民', Users], ['bot', '营销号', Bot], ['official', '官方/干预', ShieldCheck],
]

export function richText(s) {
  const parts = s.split(/(#[^#\n]{1,40}#|@[一-龥A-Za-z0-9_\-]{2,20})/g)
  return parts.map((p, i) => p.startsWith('#') && p.endsWith('#') ? <span key={i} className="ht">{p}</span> : p.startsWith('@') ? <span key={i} className="at">{p}</span> : p)
}

export function Avatar({ name, role, verified, size = 42 }) {
  const c = ROLE_META[role]?.color || '#4d9fff'
  const vb = verified ? (['gov', 'media', 'party'].includes(role) ? '#2f8cff' : '#ff9a00') : null
  return (
    <div className="wy-av" style={{ width: size, height: size, background: `linear-gradient(135deg, ${c}, ${c}aa)`, fontSize: size * 0.38 }}>
      {name?.[0]}
      {vb && <span className="vb" style={{ background: vb, color: '#fff' }}>V</span>}
    </div>
  )
}

export function PostCard({ p, onOpen, onUser }) {
  const rm = ROLE_META[p.role]
  return (
    <div className={'wy-post' + (p.deleted ? ' del' : '')}>
      <div className="wy-head">
        <div onClick={() => onUser(p.author)} style={{ cursor: 'pointer' }}><Avatar name={p.name} role={p.role} verified={p.verified} /></div>
        <div className="grow">
          <div className="row" style={{ gap: 6 }}>
            <span className="wy-name" onClick={() => onUser(p.author)}>{p.name}</span>
            <span className="wy-badge" style={{ background: rm.color + '22', color: rm.color }}>{rm.label}</span>
            {p.pinned && <span className="wy-badge" style={{ background: '#ffece0', color: '#ff8200' }}>置顶</span>}
            {p.debunk && <span className="wy-badge" style={{ background: '#e6f7ef', color: '#0a9c62' }}>辟谣</span>}
            {p.intervention && <span className="wy-badge" style={{ background: '#efe9ff', color: '#7b4dff' }}>人工干预</span>}
            {p.deleted && <span className="wy-badge" style={{ background: '#fde8eb', color: '#d0304a' }}>该内容已被删除</span>}
            {p.source === 'llm' && <span className="wy-badge" style={{ background: '#f3edff', color: '#8b5cff' }}>AI</span>}
          </div>
          <div className="wy-meta">{p.time} · 来自 {p.source === 'llm' ? '大模型智能体' : p.source === 'llm_group' ? '群体智能体语料' : p.source === 'user' ? '人工发布' : '微言客户端'} · 粉丝 {fmt(p.followers)}</div>
        </div>
        <div title={`立场 ${p.stance}`} style={{ width: 46 }}>
          <div className="stance-bar" style={{ background: stanceColor(p.stance) }} />
          <div style={{ fontSize: 10, color: '#9aa0a8', textAlign: 'right', marginTop: 2 }}>{p.emotion}</div>
        </div>
      </div>
      <div className="wy-text" onClick={() => onOpen(p.id)} style={{ cursor: 'pointer' }}>{richText(p.content)}</div>
      {p.parent && (
        <div className="wy-quote" onClick={() => onOpen(p.parent.id)} style={{ cursor: 'pointer' }}>
          <span className="wy-name" onClick={(e) => { e.stopPropagation(); onUser(p.parent.author) }}>@{p.parent.name}</span>：{richText(p.parent.content)}
          <div className="wy-meta" style={{ marginTop: 6 }}>{p.parent.time} · 转发 {fmt(p.parent.reposts)} · 评论 {fmt(p.parent.comments)} · 赞 {fmt(p.parent.likes)}</div>
        </div>
      )}
      <div className="wy-acts">
        <div onClick={() => onOpen(p.id)}><Repeat2 size={15} /> {p.reposts || '转发'}</div>
        <div onClick={() => onOpen(p.id)}><MessageCircle size={15} /> {p.comments || '评论'}</div>
        <div><Heart size={15} /> {p.likes || '赞'}</div>
        <div style={{ color: '#9aa0a8', fontSize: 11 }}>阅读 {fmt(p.views)}</div>
      </div>
    </div>
  )
}

export default function Social() {
  const { version, board, summary, history } = useStore()
  const [nav, setNav] = useState('')
  const [q, setQ] = useState('')
  const [topic, setTopic] = useState('')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(30)
  const [open, setOpen] = useState(null)
  const [user, setUser] = useState(null)
  const [live, setLive] = useState(true)

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit, sort: nav === 'hot' ? 'hot' : 'time', q, topic })
    if (nav && !['hot', 'official'].includes(nav)) params.set('role', nav)
    if (nav === 'official') params.set('official', 'true')
    const r = await api.get('/api/sim/posts?' + params)
    setItems(r.items); setTotal(r.total)
  }, [nav, q, topic, limit])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (live) load() }, [version])

  const h = history[history.length - 1] || {}
  return (
    <div className="wy">
      <div className="wy-top">
        <div className="wy-logo"><span style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg,#ff8200,#ff3d5a)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 15 }}>微</span>微言</div>
        <div className="row" style={{ background: '#f2f3f5', borderRadius: 99, padding: '0 12px', flex: 1, maxWidth: 380 }}>
          <Search size={15} color="#9aa0a8" />
          <input className="wy-search" placeholder="搜索内容或用户" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {topic && <span className="row" style={{ background: '#fff3e6', color: '#ff8200', borderRadius: 99, padding: '4px 10px', fontSize: 12 }}>#{topic}# <X size={12} style={{ cursor: 'pointer' }} onClick={() => setTopic('')} /></span>}
        <div style={{ marginLeft: 'auto', color: '#646a73', fontSize: 12 }} className="row">
          <label className="row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> 实时刷新</label>
          <span>共 {fmt(total)} 条</span>
        </div>
      </div>
      <div className="wy-body">
        <div className="wy-left">
          <div className="wy-card wy-nav" style={{ position: 'sticky', top: 50 }}>
            {NAV.map(([k, n, Ic]) => <div key={k} className={nav === k ? 'on' : ''} onClick={() => setNav(k)}><Ic size={15} />{n}</div>)}
          </div>
        </div>
        <div>
          {items.map((p) => <PostCard key={p.id + (p.pinned ? 'p' : '')} p={p} onOpen={setOpen} onUser={setUser} />)}
          {items.length === 0 && <div className="wy-card" style={{ textAlign: 'center', color: '#9aa0a8' }}>暂无内容，点击右上角「运行」开始推演</div>}
          {items.length < total && <div className="wy-card" style={{ textAlign: 'center', cursor: 'pointer', color: '#ff8200' }} onClick={() => setLimit(limit + 30)}>加载更多</div>}
        </div>
        <div>
          <div className="wy-card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ fontWeight: 700, marginBottom: 6 }}><Flame size={16} color="#ff3d3d" /> 微言热搜 <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9aa0a8', fontWeight: 400 }}>{h.time}</span></div>
            {board.slice(0, 20).map((b) => (
              <div key={b.name} className="wy-hot" onClick={() => b.kind === 'event' && setTopic(b.name)}>
                <span className={'rk' + (b.rank <= 3 ? ' t' + b.rank : '')}>{b.pinned ? <span style={{ color: '#ff3d3d' }}>↑</span> : b.rank}</span>
                <span className="nm" style={b.kind === 'event' ? { color: '#1f2329', fontWeight: 600 } : {}}>{b.name}</span>
                <span className="ht">{fmt(b.heat)}</span>
                {b.label && <span className="wy-lb" style={{ background: b.label === '爆' ? '#bd0000' : b.label === '新' ? '#ff3852' : '#ff9406' }}>{b.label}</span>}
              </div>
            ))}
          </div>
          <div className="wy-card" style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>事件导读</div>
            <div style={{ color: '#646a73' }}>{summary.card.summary}</div>
            <div style={{ marginTop: 8, fontSize: 12 }}>
              <div><span style={{ color: '#d0304a' }}>●</span> −1：{summary.card.stance_axis.neg}</div>
              <div><span style={{ color: '#1aa3d9' }}>●</span> +1：{summary.card.stance_axis.pos}</div>
            </div>
          </div>
        </div>
      </div>
      {open != null && <PostDetail id={open} onClose={() => setOpen(null)} onUser={setUser} />}
      <AgentDrawer id={user} onClose={() => setUser(null)} />
    </div>
  )
}

function PostDetail({ id, onClose, onUser }) {
  const [d, setD] = useState(null)
  const [tab, setTab] = useState('comments')
  useEffect(() => { api.get('/api/sim/post/' + id).then(setD) }, [id])
  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <div className="drawer wy" style={{ width: 560, margin: 0, borderRadius: 0, padding: 14 }}>
        <div className="row" style={{ marginBottom: 8 }}><b style={{ color: '#1f2329' }}>微博正文</b><button className="btn sm" style={{ marginLeft: 'auto', color: '#333', background: '#fff' }} onClick={onClose}><X size={14} /></button></div>
        {!d ? '加载中…' : <>
          <PostCard p={d.post} onOpen={() => {}} onUser={onUser} />
          <div className="wy-card">
            <div className="wy-tabs">
              <div className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>评论 {d.comments.length}</div>
              <div className={tab === 'reposts' ? 'on' : ''} onClick={() => setTab('reposts')}>转发 {d.reposts.length}</div>
            </div>
            {(tab === 'comments' ? d.comments : d.reposts).map((c) => (
              <div key={c.id} className="wy-cmt">
                <div onClick={() => onUser(c.author)} style={{ cursor: 'pointer' }}><Avatar name={c.name} role={c.role} verified={c.verified} size={32} /></div>
                <div className="grow">
                  <span className="wy-name" onClick={() => onUser(c.author)}>{c.name}</span>
                  {c.verified && <BadgeCheck size={12} color="#ff9a00" style={{ marginLeft: 3 }} />}：<span>{richText(c.content)}</span>
                  <div className="wy-meta row" style={{ marginTop: 3 }}>{c.time}<span style={{ marginLeft: 'auto', width: 30, height: 3, borderRadius: 2, background: stanceColor(c.stance) }} /></div>
                </div>
              </div>
            ))}
            {(tab === 'comments' ? d.comments : d.reposts).length === 0 && <div style={{ color: '#9aa0a8', padding: 20, textAlign: 'center' }}>暂无</div>}
          </div>
        </>}
      </div>
    </>
  )
}
