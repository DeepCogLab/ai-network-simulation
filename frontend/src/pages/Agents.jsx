import React, { useEffect, useMemo, useState } from 'react'
import { Cpu } from 'lucide-react'
import { api } from '../api'
import Chart from '../components/Chart.jsx'
import AgentDrawer from '../components/AgentDrawer.jsx'
import { fmt, ROLE_META, stanceColor, useStore } from '../store'
import { ThoughtStream } from './Dashboard.jsx'

export default function Agents() {
  const { summary, version, thoughts } = useStore()
  const [list, setList] = useState([])
  const [logs, setLogs] = useState(null)
  const [sel, setSel] = useState(null)
  const [role, setRole] = useState('')
  useEffect(() => {
    Promise.all(['gov', 'media', 'kol', 'expert', 'party', 'netizen'].map((r) => api.get(`/api/sim/agents?role=${r}&limit=${r === 'netizen' ? 400 : 20}`)))
      .then((rs) => setList(rs.flat().filter((a) => a.driver === 'llm')))
    api.get('/api/llm/logs').then(setLogs)
  }, [Math.floor(version / 2)])

  const pie = useMemo(() => {
    const rc = summary.role_counts || {}
    return {
      tooltip: { trigger: 'item' },
      legend: { orient: 'vertical', right: 0, top: 'middle', textStyle: { color: '#9aa7c7' } },
      series: [{ type: 'pie', radius: ['45%', '72%'], center: ['38%', '50%'], itemStyle: { borderColor: '#0b1222', borderWidth: 2 }, label: { show: false },
        data: Object.entries(rc).map(([k, v]) => ({ name: `${ROLE_META[k].label} ${v}`, value: v, itemStyle: { color: ROLE_META[k].color } })) }],
    }
  }, [summary.role_counts])
  const nLLM = list.length
  const rows = list.filter((a) => !role || a.role === role)

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid" style={{ gridTemplateColumns: '360px minmax(0,1fr)' }}>
        <div className="panel"><h3>主体构成</h3><Chart option={pie} style={{ height: 230 }} /></div>
        <div className="panel">
          <h3><Cpu size={14} />混合智能体架构</h3>
          <div className="grid g3">
            {[
              ['大模型个体智能体', '#a66bff', `${nLLM} 个`, '政务、媒体、大V、专家、当事方与少量代表性网民。每步依据人设、记忆、当前态势和看到的信息流，自主决定发帖、转发、评论或观望，并输出内心想法。'],
              ['大模型群体智能体', '#20c9b0', `${summary.communities.length} 个社群`, '每个网民社群对应一个“集体心智”，周期性推演群体心态迁移（立场/情绪/信念/信任/参与意愿），并生成社群评论语料池。'],
              ['规则函数个体智能体', '#4d9fff', `${(summary.role_counts.netizen || 0) - nLLM + (summary.role_counts.bot || 0)} 个`, 'Hawkes 活跃 + SEIR 状态 + 有界信任观点更新 + 情绪传染 + 沉默的螺旋 + 级联转发，在群体心智引导下表达个体差异。'],
            ].map(([t, c, n, d]) => (
              <div key={t} className="list-item" style={{ border: `1px solid ${c}55`, background: c + '0d' }}>
                <div className="row"><b style={{ color: c }}>{t}</b><span className="mono" style={{ marginLeft: 'auto' }}>{n}</span></div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.7, marginTop: 6 }}>{d}</div>
              </div>
            ))}
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.7 }}>
            一步仿真内：大模型任务（个体 + 群体）与规则动力学<b>并发</b>执行 → 应用决策 → 更新热搜与指标 → 通过 WebSocket 推送前端。大模型调用失败时自动降级为规则行为，确保推演不中断。
          </div>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="panel">
          <h3>大模型驱动账号</h3>
          <div className="tabs" style={{ marginBottom: 8 }}>{['', 'gov', 'media', 'kol', 'expert', 'party', 'netizen'].map((r) => <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{r ? ROLE_META[r].label : '全部'}</button>)}</div>
          <div className="scroll" style={{ maxHeight: 380 }}>
            <table className="t">
              <thead><tr><th>账号</th><th>类型</th><th>粉丝</th><th>当前立场</th></tr></thead>
              <tbody>{rows.map((a) => (
                <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setSel(a.id)}>
                  <td><span className="dot" style={{ background: ROLE_META[a.role].color, marginRight: 6 }} />{a.name}</td>
                  <td className="muted">{ROLE_META[a.role].label}</td>
                  <td className="mono">{fmt(a.followers)}</td>
                  <td><div className="row"><div style={{ width: 70, height: 5, background: '#16203a', borderRadius: 3, position: 'relative' }}>
                    <div style={{ position: 'absolute', left: `${(a.op + 1) * 50}%`, top: -2, width: 9, height: 9, borderRadius: '50%', background: stanceColor(a.op), transform: 'translateX(-50%)' }} /></div>
                    <span className="mono" style={{ fontSize: 11 }}>{a.op.toFixed(2)}</span></div></td>
                </tr>))}</tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h3>大模型调用日志 <span className="hint">{logs?.info.model}</span></h3>
          <div className="scroll" style={{ maxHeight: 420 }}>
            {logs?.recent.map((l, i) => (
              <div key={i} className="list-item" style={{ borderBottom: '1px solid var(--line)' }}>
                <div className="row"><span className={'tag ' + (l.ok ? 'g' : 'r')}>{l.ok ? 'OK' : 'FAIL'}</span><b style={{ fontSize: 12 }}>{l.tag}</b><span className="mono dim" style={{ marginLeft: 'auto' }}>{l.latency}s</span></div>
                <div className="mono dim" style={{ fontSize: 11, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 64, overflow: 'hidden' }}>{l.out}</div>
              </div>
            ))}
            {!logs?.recent.length && <div className="dim">暂无调用</div>}
          </div>
        </div>
      </div>
      <ThoughtStream thoughts={thoughts} height={420} />
      <AgentDrawer id={sel} onClose={() => setSel(null)} />
    </div>
  )
}
