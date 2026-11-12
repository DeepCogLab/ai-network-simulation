import React from 'react'
import { useStore } from '../store'

const GROUP_COLOR = { 传播动力学: '#ff7a3d', 观点动力学: '#3ad6ff', 社会心理: '#a66bff', 传播结构: '#ffb020', 媒介效果: '#20c9b0', 危机传播: '#ff4d6a', 网络科学: '#2bd99f', 舆情管理: '#ff7ab6', 智能体架构: '#8b5cff' }

const FLOW = [
  ['实时数据', '微博/百度热搜、腾讯新闻、中新网 RSS'],
  ['事件建模', '大模型生成事件卡：立场轴、传言、当事方、话题'],
  ['社会网络', 'SBM + 偏好连接，七类主体、六类社群'],
  ['混合智能体', '大模型个体 + 大模型群体 + 规则个体'],
  ['平台机制', '推荐算法、热搜榜、评论区、转发链'],
  ['干预推演', '发布/辟谣/删帖/禁言/限流/议程 + 平行推演'],
  ['指标与研判', '30+ 指标、可视化、AI 研判报告'],
]

export default function Theory() {
  const theories = useStore((s) => s.meta?.theories || [])
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="panel">
        <h3>系统流程</h3>
        <div className="row" style={{ alignItems: 'stretch', gap: 0, overflowX: 'auto' }}>
          {FLOW.map(([t, d], i) => (
            <React.Fragment key={t}>
              <div style={{ flex: 1, minWidth: 130, padding: 12, borderRadius: 10, border: '1px solid var(--line2)', background: 'linear-gradient(160deg, rgba(58,214,255,.08), rgba(139,92,255,.06))' }}>
                <div className="mono" style={{ color: '#3ad6ff', fontSize: 11 }}>0{i + 1}</div>
                <b>{t}</b>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.6 }}>{d}</div>
              </div>
              {i < FLOW.length - 1 && <div style={{ alignSelf: 'center', color: '#3ad6ff', padding: '0 6px' }}>➜</div>}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="grid g3">
        {theories.map((t) => (
          <div key={t.key} className="panel">
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="tag" style={{ color: GROUP_COLOR[t.group], borderColor: GROUP_COLOR[t.group] + '77' }}>{t.group}</span>
              <span className="dim mono" style={{ marginLeft: 'auto', fontSize: 10 }}>{t.impl}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{t.name}</div>
            <div className="muted" style={{ lineHeight: 1.75, fontSize: 12.5 }}>{t.desc}</div>
            <div className="mono" style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(5,9,18,.7)', color: '#9fe8ff', fontSize: 11.5, border: '1px solid var(--line)' }}>{t.formula}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
