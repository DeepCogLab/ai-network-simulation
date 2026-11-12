import React, { useMemo } from 'react'
import { Brain, Flame, Users } from 'lucide-react'
import Chart, { base, xAxis, yAxis } from '../components/Chart.jsx'
import { fmt, pct, ROLE_META, useStore } from '../store'
import { STAGE_COLOR } from '../App.jsx'

const EMO_COLORS = { 愤怒: '#ff4d6a', 厌恶: '#c2417a', 悲伤: '#6b7cff', 恐惧: '#a66bff', 惊讶: '#ffb020', 喜悦: '#2bd99f', 中性: '#5d6b88' }

export function eventMarks(history, events) {
  return events.filter((e) => e.kind === 'intervention' || e.kind === 'gov').map((e) => ({
    xAxis: history.findIndex((h) => h.tick === e.tick) >= 0 ? history.findIndex((h) => h.tick === e.tick) : null,
    label: { formatter: e.kind === 'gov' ? '政务回应' : e.title.replace('【干预】', ''), color: e.kind === 'gov' ? '#ff8b9c' : '#b99bff', fontSize: 10, position: 'insideEndTop' },
    lineStyle: { color: e.kind === 'gov' ? '#ff4d6a' : '#8b5cff', type: 'dashed' },
  })).filter((m) => m.xAxis != null)
}

export default function Dashboard() {
  const { history, board, events, thoughts, summary, moods } = useStore()
  const h = history[history.length - 1] || {}
  const p = history[history.length - 2] || h
  const x = history.map((d) => d.time)
  const marks = useMemo(() => eventMarks(history, events), [history.length, events.length])

  const heatOpt = useMemo(() => base({
    legend: { data: ['话题热度', '热搜排名'] }, grid: { right: 36 },
    xAxis: xAxis(x), yAxis: [yAxis({ name: '', axisLabel: { formatter: (v) => fmt(v), color: '#8a97b5', fontSize: 11 } }), yAxis({ inverse: true, min: 1, max: 50, splitLine: { show: false } })],
    series: [
      { name: '话题热度', type: 'line', smooth: true, showSymbol: false, data: history.map((d) => d.heat), lineStyle: { width: 2, color: '#ff7a3d' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(255,122,61,.45)' }, { offset: 1, color: 'rgba(255,122,61,0)' }] } },
        markLine: { symbol: 'none', data: marks, silent: true } },
      { name: '热搜排名', type: 'line', step: 'end', yAxisIndex: 1, showSymbol: false, data: history.map((d) => d.rank || null), lineStyle: { color: '#3ad6ff', width: 1.5 } },
    ],
  }), [history.length, marks])

  const seirOpt = useMemo(() => base({
    legend: { data: ['未知S', '接触E', '传播I', '免疫R'] },
    xAxis: xAxis(x), yAxis: yAxis(),
    series: [['未知S', 'S', '#2a3654'], ['接触E', 'E', '#ffb020'], ['传播I', 'I', '#ff4d6a'], ['免疫R', 'R', '#2bd99f']].map(([n, k, c]) => ({
      name: n, type: 'line', stack: 's', smooth: true, showSymbol: false, data: history.map((d) => d[k]), lineStyle: { width: 0 }, areaStyle: { color: c, opacity: 0.85 }, itemStyle: { color: c } })),
  }), [history.length])

  const heatmapOpt = useMemo(() => {
    const data = []
    let mx = 0.01
    history.forEach((d, i) => {
      const s = d.op_hist.reduce((a, b) => a + b, 0) || 1
      d.op_hist.forEach((v, j) => { const r = v / s; data.push([i, j, r]); mx = Math.max(mx, r) })
    })
    return base({
      tooltip: { trigger: 'item', formatter: (p) => `${x[p.value[0]]}<br/>立场 ${(-1 + p.value[1] * 0.1).toFixed(1)}~${(-0.9 + p.value[1] * 0.1).toFixed(1)}：${(p.value[2] * 100).toFixed(1)}%` },
      grid: { left: 44, right: 16, top: 10, bottom: 26 },
      xAxis: { ...xAxis(x), boundaryGap: true }, yAxis: { type: 'category', data: Array.from({ length: 20 }, (_, j) => (-1 + j * 0.1 + 0.05).toFixed(1)), axisLabel: { color: '#8a97b5', fontSize: 10, interval: 4 }, axisLine: { show: false } },
      visualMap: { show: false, min: 0, max: mx, inRange: { color: ['#0a1020', '#18305e', '#3a5bd9', '#8b5cff', '#ff4d6a', '#ffd166'] } },
      series: [{ type: 'heatmap', data, progressive: 0 }],
    })
  }, [history.length])

  const emoOpt = useMemo(() => {
    const keys = Object.keys(EMO_COLORS)
    return base({
      legend: { data: keys }, xAxis: xAxis(x), yAxis: yAxis(),
      series: keys.map((k) => ({ name: k, type: 'bar', stack: 'e', barWidth: '70%', data: history.map((d) => d.emotions?.[k] || 0), itemStyle: { color: EMO_COLORS[k] } })),
    })
  }, [history.length])

  const cogOpt = useMemo(() => base({
    legend: { data: ['传言相信率', '政务公信力', '媒体公信力', '负面情绪占比'] },
    xAxis: xAxis(x), yAxis: yAxis({ min: 0, max: 1, axisLabel: { formatter: (v) => v * 100 + '%', color: '#8a97b5', fontSize: 11 } }),
    series: [['传言相信率', 'belief_rate', '#ff4d6a'], ['政务公信力', 'trust_gov', '#3ad6ff'], ['媒体公信力', 'trust_media', '#ffb020'], ['负面情绪占比', 'neg_share', '#a66bff']].map(([n, k, c]) => ({
      name: n, type: 'line', smooth: true, showSymbol: false, data: history.map((d) => d[k]), lineStyle: { color: c, width: 2 }, itemStyle: { color: c },
      markLine: n === '传言相信率' ? { symbol: 'none', data: marks, silent: true } : undefined })),
  }), [history.length, marks])

  const stanceOpt = useMemo(() => base({
    legend: { data: ['反对', '中立', '支持'] }, xAxis: xAxis(x), yAxis: yAxis({ max: 1, axisLabel: { formatter: (v) => v * 100 + '%', color: '#8a97b5', fontSize: 11 } }),
    series: [['反对', 0, '#ff4d6a'], ['中立', 1, '#5d6b88'], ['支持', 2, '#3ad6ff']].map(([n, i, c]) => ({ name: n, type: 'line', stack: 'st', smooth: true, showSymbol: false,
      data: history.map((d) => d.stance_share?.[i]), lineStyle: { width: 0 }, areaStyle: { color: c, opacity: 0.8 }, itemStyle: { color: c } })),
  }), [history.length])

  const tiles = [
    ['话题热度', fmt(h.heat), h.heat - p.heat, '#ff7a3d', fmt],
    ['参与人数', fmt(h.participants), h.participants - p.participants, '#3ad6ff', fmt],
    ['累计内容', fmt(h.total_posts), h.total_posts - p.total_posts, '#8b5cff', fmt],
    ['传播再生数 Rt', h.Rt?.toFixed(2), h.Rt - p.Rt, '#ff4d6a', (v) => v.toFixed(2)],
    ['立场均值', h.op_mean?.toFixed(2), h.op_mean - p.op_mean, '#3ad6ff', (v) => v.toFixed(3)],
    ['极化指数 BC', h.polarization?.toFixed(2), h.polarization - p.polarization, '#ffb020', (v) => v.toFixed(3)],
    ['负面情绪', pct(h.neg_share), h.neg_share - p.neg_share, '#a66bff', pct],
    ['传言相信率', pct(h.belief_rate), h.belief_rate - p.belief_rate, '#ff4d6a', pct],
    ['政务公信力', h.trust_gov?.toFixed(2), h.trust_gov - p.trust_gov, '#2bd99f', (v) => v.toFixed(3)],
    ['回音室指数', h.echo?.toFixed(2), h.echo - p.echo, '#20c9b0', (v) => v.toFixed(3)],
    ['最大级联', h.max_cascade, h.max_cascade - p.max_cascade, '#ffb020', fmt],
    ['沉默人数', h.silenced, h.silenced - p.silenced, '#7c8aa8', fmt],
  ]

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0,1fr))' }}>
        {tiles.map(([k, v, d, c, f]) => (
          <div className="kpi" key={k} style={{ '--glow': c + '33' }}>
            <div className="k"><span className="dot" style={{ background: c }} />{k}</div>
            <div className="v">{v ?? '-'}</div>
            <div className={'d ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'dim')}>{d ? (d > 0 ? '▲ ' : '▼ ') + f(Math.abs(d)) : '— 持平'}</div>
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr) 300px' }}>
        <div className="panel"><h3><Flame size={13} />热度与热搜排名 <span className="hint">虚线为政务回应 / 干预节点</span></h3><Chart option={heatOpt} /></div>
        <div className="panel"><h3>SEIR 传播仓室</h3><Chart option={seirOpt} /></div>
        <Board board={board} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 300px' }}>
        <div className="panel"><h3>观点分布演化热力图 <span className="hint">纵轴：立场 −1 {summary?.card?.stance_axis?.neg?.slice(0, 8)} → +1</span></h3><Chart option={heatmapOpt} /></div>
        <div className="panel"><h3>认知与信任</h3><Chart option={cogOpt} /></div>
        <Timeline events={events} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 300px' }}>
        <div className="panel"><h3>情绪构成（每小时新增内容）</h3><Chart option={emoOpt} /></div>
        <div className="panel"><h3>立场阵营占比</h3><Chart option={stanceOpt} /></div>
        <div className="panel">
          <h3><Users size={13} />群体心态 <span className="hint">大模型群体智能体</span></h3>
          <div className="scroll" style={{ maxHeight: 250 }}>
            {Object.keys(moods || {}).length === 0 && <div className="dim">等待群体智能体推演…</div>}
            {Object.entries(moods || {}).map(([k, v]) => (
              <div key={k} className="list-item">
                <div className="row"><b style={{ fontSize: 12 }}>{k}</b><span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>{v.time}</span></div>
                <div className="muted" style={{ marginTop: 3 }}>{v.mood}</div>
                <div className="row" style={{ marginTop: 3, fontSize: 11 }}>
                  <span className={v.stance_shift < 0 ? 'up' : 'down'}>立场偏移 {v.stance_shift > 0 ? '+' : ''}{v.stance_shift?.toFixed(2)}</span>
                  <span className="dim">参与意愿 {pct(v.participation)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <ThoughtStream thoughts={thoughts} />
    </div>
  )
}

export function Board({ board, height = 260 }) {
  return (
    <div className="panel">
      <h3><Flame size={13} color="#ff7a3d" />平台热搜榜 <span className="hint">事件话题高亮</span></h3>
      <div className="scroll" style={{ maxHeight: height }}>
        {board.slice(0, 20).map((b) => (
          <div key={b.name} className={'hot' + (b.kind === 'event' ? ' ev' : '')}>
            <span className={'n' + (b.rank <= 3 ? ' top' : '')}>{b.pinned ? '↑' : b.rank}</span>
            <span className="name" title={b.name}>{b.name}</span>
            {b.label && <span className="lb" style={{ background: b.label === '爆' ? '#d4062a' : b.label === '新' ? '#ff9406' : '#ff6a3d' }}>{b.label}</span>}
            <span className="h">{fmt(b.heat)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const EV_COLOR = { gov: '#ff4d6a', media: '#ffb020', hot: '#ff7a3d', intervention: '#a66bff', info: '#3ad6ff' }
export function Timeline({ events, height = 260 }) {
  return (
    <div className="panel">
      <h3>关键事件时间线</h3>
      <div className="scroll tl" style={{ maxHeight: height }}>
        {[...events].reverse().slice(0, 60).map((e, i) => (
          <div key={i} className="tl-item" style={{ '--c': EV_COLOR[e.kind] || '#3ad6ff' }}>
            <div className="row"><span className="mono dim" style={{ fontSize: 11 }}>{e.time}</span><b style={{ fontSize: 12 }}>{e.title}</b></div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{e.actor !== '平台' && e.actor !== '系统' && <span style={{ color: '#c9d4ee' }}>{e.actor}：</span>}{e.detail}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ThoughtStream({ thoughts, height = 300 }) {
  return (
    <div className="panel">
      <h3><Brain size={13} color="#a66bff" />智能体思维流 <span className="hint">大模型个体 / 群体智能体的内心想法与决策</span></h3>
      <div className="grid g3 scroll" style={{ maxHeight: height }}>
        {[...thoughts].reverse().slice(0, 30).map((t, i) => {
          const rm = ROLE_META[t.role] || { label: '群体', color: '#20c9b0' }
          return (
            <div key={i} className="list-item fadein" style={{ border: '1px solid var(--line)', background: 'rgba(5,9,18,.5)' }}>
              <div className="row">
                <span className="dot" style={{ background: rm.color }} /><b style={{ fontSize: 12 }}>{t.name}</b>
                <span className="tag" style={{ padding: '0 6px', fontSize: 10 }}>{rm.label}</span>
                <span className={'tag ' + (t.action === 'none' ? '' : 'c')} style={{ padding: '0 6px', fontSize: 10 }}>{{ post: '原创', repost: '转发', comment: '评论', none: '观望', group: '群体推演' }[t.action] || t.action}</span>
                {t.src !== 'llm' && <span className="tag" style={{ padding: '0 6px', fontSize: 10 }}>规则</span>}
                <span className="dim mono" style={{ marginLeft: 'auto', fontSize: 10 }}>{t.time}</span>
              </div>
              <div style={{ color: '#b99bff', fontSize: 12, margin: '5px 0 3px' }}>💭 {t.thought}</div>
              {t.content && <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>{t.content}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
