import { create } from 'zustand'
import { api } from './api'

export const useStore = create((set, get) => ({
  page: (location.hash || '#setup').slice(1),
  meta: null,
  summary: null,
  history: [],
  board: [],
  events: [],
  thoughts: [],
  moods: {},
  stream: [], // 实时新帖流
  running: false,
  busy: false,
  ws: 'connecting',
  llm: null,
  toast: null,
  version: 0, // 每个 tick 自增，用于触发各页面刷新

  setPage: (p) => { location.hash = p; set({ page: p }) },
  notify: (msg, kind = 'info') => {
    set({ toast: { msg, kind, t: Date.now() } })
    setTimeout(() => { if (Date.now() - (get().toast?.t || 0) >= 2900) set({ toast: null }) }, 3000)
  },

  loadMeta: async () => set({ meta: await api.get('/api/meta') }),
  refresh: async () => {
    try {
      const s = await api.get('/api/sim/summary')
      const h = await api.get('/api/sim/history')
      set({ summary: s, history: h, board: s.board, events: s.events, thoughts: s.thoughts, moods: s.moods,
        running: s.running, busy: s.busy, llm: s.llm, version: get().version + 1 })
    } catch {
      set({ summary: null })
    }
  },
  control: async (action, extra = {}) => {
    const r = await api.post('/api/sim/control', { action, ...extra })
    set({ running: r.running })
    return r
  },

  onMessage: (msg) => {
    const st = get()
    if (msg.type === 'tick') {
      const d = msg.data
      const history = [...st.history.filter((h) => h.tick < d.latest.tick), d.latest]
      set({
        history, board: d.board, busy: false, llm: d.llm, moods: d.moods,
        events: mergeById(st.events, d.events, (e) => e.tick + e.title + e.detail),
        thoughts: mergeById(st.thoughts, d.thoughts, (e) => e.tick + e.name + e.action + e.thought).slice(-200),
        stream: [...d.new_posts.slice().reverse(), ...st.stream].slice(0, 120),
        summary: st.summary ? { ...st.summary, tick: d.tick, time: d.time, latest: d.latest } : st.summary,
        version: st.version + 1,
      })
    } else if (msg.type === 'busy') set({ busy: true })
    else if (msg.type === 'status') set({ running: msg.running, busy: false })
    else if (msg.type === 'created') { set({ stream: [] }); get().refresh() }
    else if (msg.type === 'intervention') {
      set({ events: mergeById(st.events, msg.data.events, (e) => e.tick + e.title + e.detail), board: msg.data.board, version: st.version + 1 })
    }
  },
}))

function mergeById(a, b, key) {
  const seen = new Set(a.map(key))
  return [...a, ...b.filter((x) => !seen.has(key(x)))]
}

let sock
export function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  sock = new WebSocket(`${proto}://${location.host}/ws`)
  sock.onopen = () => useStore.setState({ ws: 'online' })
  sock.onclose = () => { useStore.setState({ ws: 'offline' }); setTimeout(connectWS, 2000) }
  sock.onmessage = (e) => useStore.getState().onMessage(JSON.parse(e.data))
}

// ---------- 通用工具 ----------
export const ROLE_META = {
  gov: { label: '政务', color: '#ff5a6e' },
  media: { label: '媒体', color: '#ffb020' },
  kol: { label: '大V', color: '#a66bff' },
  expert: { label: '专家', color: '#20c9b0' },
  party: { label: '当事方', color: '#ff7ab6' },
  netizen: { label: '网民', color: '#4d9fff' },
  bot: { label: '营销号', color: '#7c8695' },
}
export const COMM_COLORS = ['#3ad6ff', '#ff6b8b', '#ffb020', '#a66bff', '#2bd99f', '#ff8a3d']
export const SEIR_COLORS = ['#3a4660', '#ffb020', '#ff4d6a', '#2bd99f']
export const SEIR_LABEL = ['未知 S', '接触 E', '传播 I', '免疫 R']

export function stanceColor(v) {
  // -1 (批评) 橙红 → 0 灰 → +1 (支持) 青蓝
  const t = Math.max(-1, Math.min(1, v || 0))
  const neg = [255, 77, 106], mid = [140, 150, 170], pos = [58, 214, 255]
  const [a, b, k] = t < 0 ? [mid, neg, -t] : [mid, pos, t]
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * k))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
export const fmt = (n) => {
  if (n == null) return '-'
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return String(Math.round(n))
}
export const pct = (x) => (x == null ? '-' : (x * 100).toFixed(0) + '%')
