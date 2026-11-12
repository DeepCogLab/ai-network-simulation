import React, { useState } from 'react'
import { Download, FileText, Loader2, Printer } from 'lucide-react'
import { api } from '../api'
import { fmt, pct, useStore } from '../store'

const RISK = { 低: '#2bd99f', 中: '#ffb020', 高: '#ff7a3d', 极高: '#ff4d6a' }

export default function Report() {
  const { summary, notify } = useStore()
  const [r, setR] = useState(null)
  const [loading, setLoading] = useState(false)
  const gen = async () => {
    setLoading(true)
    try { setR(await api.get('/api/sim/report')) } catch (e) { notify(e.message, 'error') }
    setLoading(false)
  }
  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div className="row no-print" style={{ marginBottom: 12 }}>
        <button className="btn primary" disabled={loading} onClick={gen}>{loading ? <Loader2 size={14} className="spin" /> : <FileText size={14} />} {r ? '重新生成研判报告' : '生成研判报告'}</button>
        {r && <button className="btn" onClick={() => window.print()}><Printer size={14} /> 打印 / 导出 PDF</button>}
        <a className="btn" href="/api/sim/export" target="_blank" rel="noreferrer"><Download size={14} /> 导出仿真数据 JSON</a>
        <span className="dim" style={{ marginLeft: 'auto' }}>基于当前推演数据（{summary.time}）由大模型生成</span>
      </div>
      {loading && <div className="panel empty"><Loader2 size={30} className="spin" color="#3ad6ff" />首席分析师智能体正在撰写报告…</div>}
      {!loading && !r && <div className="panel empty"><FileText size={40} />推演一段时间后，点击生成研判报告</div>}
      {!loading && r && (
        <div className="panel report fadein" style={{ padding: 28 }}>
          <div className="dim" style={{ fontSize: 12 }}>舆情仿真研判报告 · {summary.card.title} · 截至 {r.generated_at}</div>
          <div className="row" style={{ margin: '10px 0 6px', alignItems: 'flex-start' }}>
            <h1 className="grow">{r.headline}</h1>
            <span className="risk" style={{ background: (RISK[r.risk_level] || '#888') + '22', color: RISK[r.risk_level], border: `1px solid ${RISK[r.risk_level]}` }}>风险等级：{r.risk_level}</span>
          </div>
          <div className="grid g4" style={{ margin: '14px 0' }}>
            {[['峰值热度', fmt(r.metrics.peak), r.metrics.peak_time], ['最高热搜', '#' + r.metrics.best_rank, ''], ['参与人数', fmt(r.metrics.part), `${fmt(r.metrics.posts)} 条内容`],
              ['传言相信率', pct(r.metrics.bel), `峰值 ${pct(r.metrics.bel_peak)}`], ['负面情绪', pct(r.metrics.negs), ''], ['政务公信力', r.metrics.tg.toFixed(2), `初始 ${r.metrics.tg0.toFixed(2)}`],
              ['极化指数', r.metrics.pol.toFixed(2), `回音室 ${r.metrics.echo.toFixed(2)}`], ['最大级联', r.metrics.casc, `病毒性 ${r.metrics.vir}`]].map(([k, v, d]) => (
              <div key={k} className="kpi"><div className="k">{k}</div><div className="v">{v}</div><div className="d dim">{d}</div></div>
            ))}
          </div>
          <h2>一、事件概述</h2><p>{r.overview}</p>
          <h2>二、演化阶段</h2>
          <div className="tl">{(r.phases || []).map((p, i) => <div key={i} className="tl-item"><b>{p.name}</b> <span className="dim mono">{p.time}</span><p style={{ margin: '2px 0' }}>{p.desc}</p></div>)}</div>
          <h2>三、关键发现</h2><ol>{(r.key_findings || []).map((f, i) => <li key={i}>{f}</li>)}</ol>
          <h2>四、干预效果评价</h2><p>{r.intervention_review}</p>
          <h2>五、风险提示</h2><ul>{(r.risks || []).map((f, i) => <li key={i} style={{ color: '#ffb3bf' }}>{f}</li>)}</ul>
          <h2>六、处置建议</h2>
          <table className="t"><tbody>{(r.suggestions || []).map((s, i) => <tr key={i}><td style={{ width: 70 }}><span className="tag c">{s.target}</span></td><td style={{ lineHeight: 1.7 }}>{s.action}</td></tr>)}</tbody></table>
          <h2>七、走势预判</h2><p>{r.outlook}</p>
        </div>
      )}
    </div>
  )
}
