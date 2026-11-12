import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../api'
import { fmt, ROLE_META, stanceColor } from '../store'

const Bar = ({ label, v, min = 0, max = 1, color }) => {
  const w = ((v - min) / (max - min)) * 100
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="row" style={{ fontSize: 11 }}><span className="muted">{label}</span><span className="mono" style={{ marginLeft: 'auto' }}>{v?.toFixed(2)}</span></div>
      <div style={{ height: 6, background: '#16203a', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
        {min < 0 && <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#3a4660' }} />}
        <div style={{ width: w + '%', height: '100%', background: color, borderRadius: 4 }} />
      </div>
    </div>
  )
}

export default function AgentDrawer({ id, onClose }) {
  const [a, setA] = useState(null)
  useEffect(() => { setA(null); if (id != null) api.get('/api/sim/agent/' + id).then(setA).catch(() => {}) }, [id])
  if (id == null) return null
  const rm = a ? ROLE_META[a.role] : null
  return (
    <>
      <div className="drawer-mask" onClick={onClose} />
      <div className="drawer">
        <button className="btn sm ghost" style={{ position: 'absolute', right: 14, top: 14 }} onClick={onClose}><X size={14} /></button>
        {!a ? <div className="dim">加载中…</div> : <>
          <div className="row" style={{ gap: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: rm.color, display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700 }}>{a.name[0]}</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{a.name} {a.verified && <span className="tag o" style={{ padding: '0 5px' }}>V</span>}</div>
              <div className="row" style={{ marginTop: 4 }}>
                <span className="tag" style={{ color: rm.color, borderColor: rm.color + '88' }}>{rm.label}</span>
                <span className={'tag ' + (a.driver === 'llm' ? 'p' : '')}>{a.driver === 'llm' ? '大模型个体驱动' : a.role === 'netizen' ? '规则 + 群体大模型驱动' : '规则驱动'}</span>
                {a.muted && <span className="tag r">禁言中</span>}
              </div>
            </div>
          </div>
          <div className="row" style={{ margin: '14px 0', gap: 18 }}>
            <div><div className="mono" style={{ fontSize: 17 }}>{fmt(a.followers)}</div><div className="dim">粉丝</div></div>
            <div><div className="mono" style={{ fontSize: 17 }}>{a.following}</div><div className="dim">关注</div></div>
            <div><div className="mono" style={{ fontSize: 17 }}>{(a.influence * 100).toFixed(1)}</div><div className="dim">影响力</div></div>
            <div><div className="mono" style={{ fontSize: 17 }}>{Math.round(a.recv)}</div><div className="dim">被互动</div></div>
            <div><div className="mono" style={{ fontSize: 17 }}>{a.state}</div><div className="dim">SEIR</div></div>
          </div>
          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>人设 · {a.community_name}</div>
            <div style={{ lineHeight: 1.7 }}>{a.persona}</div>
          </div>
          <div className="panel" style={{ marginBottom: 12 }}>
            <Bar label="立场" v={a.op} min={-1} max={1} color={stanceColor(a.op)} />
            <Bar label="情绪唤醒" v={a.aro} color="#ffb020" />
            <Bar label="传言相信度" v={a.bel} color="#ff4d6a" />
            <Bar label="对政务信任" v={a.trust_gov} color="#3ad6ff" />
            <Bar label="对媒体信任" v={a.trust_media} color="#a66bff" />
            <div className="row dim" style={{ fontSize: 11, justifyContent: 'space-between' }}>
              <span>信任阈值ε {a.eps.toFixed(2)}</span><span>从众性 {a.conformity.toFixed(2)}</span><span>固执度 {a.stubborn.toFixed(2)}</span>
            </div>
          </div>
          {a.thoughts?.length > 0 && <div className="panel" style={{ marginBottom: 12 }}>
            <h3>内心独白</h3>
            {a.thoughts.slice().reverse().map((t, i) => <div key={i} className="list-item"><span className="dim mono">{t.time}</span> <span style={{ color: '#b99bff' }}>💭 {t.thought}</span></div>)}
          </div>}
          <div className="panel">
            <h3>发布记录 <span className="hint">{a.posts.length} 条</span></h3>
            {a.posts.length === 0 && <div className="dim">暂无</div>}
            {a.posts.map((p) => (
              <div key={p.id} className="list-item" style={{ borderBottom: '1px solid var(--line)' }}>
                <div className="row dim" style={{ fontSize: 11 }}><span className="mono">{p.time}</span><span>{{ post: '原创', repost: '转发', comment: '评论' }[p.kind]}</span><span style={{ color: stanceColor(p.stance) }}>立场 {p.stance}</span>{p.deleted && <span className="tag r">已删除</span>}</div>
                <div style={{ marginTop: 3, lineHeight: 1.6 }}>{p.content}</div>
                {p.parent && <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>↪ @{p.parent.name}：{p.parent.content.slice(0, 50)}</div>}
              </div>
            ))}
          </div>
        </>}
      </div>
    </>
  )
}
