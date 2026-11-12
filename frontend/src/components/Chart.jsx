import React, { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import 'echarts-wordcloud'

const AXIS = { axisLine: { lineStyle: { color: '#2a3550' } }, axisLabel: { color: '#8a97b5', fontSize: 11 }, splitLine: { lineStyle: { color: '#1a2338' } } }

export const base = ({ grid, tooltip, legend, ...o } = {}) => ({
  backgroundColor: 'transparent',
  textStyle: { fontFamily: 'inherit', color: '#c9d4ee' },
  ...o,
  grid: { left: 44, right: 16, top: 30, bottom: 26, ...(grid || {}) },
  tooltip: { trigger: 'axis', backgroundColor: 'rgba(10,16,30,.95)', borderColor: '#2a3a60', textStyle: { color: '#dfe7ff', fontSize: 12 }, ...(tooltip || {}) },
  legend: { textStyle: { color: '#c3cde6', fontSize: 11 }, inactiveColor: '#3a4660', top: 0, right: 8, itemWidth: 12, itemHeight: 8, ...(legend || {}) },
})
export const xAxis = (data, extra = {}) => ({ type: 'category', data, boundaryGap: false, ...AXIS, ...extra })
export const yAxis = (extra = {}) => ({ type: 'value', ...AXIS, ...extra })

export default function Chart({ option, style, onClick, notMerge = false }) {
  const ref = useRef(null)
  const inst = useRef(null)
  useEffect(() => {
    inst.current = echarts.init(ref.current, null, { renderer: 'canvas' })
    const ro = new ResizeObserver(() => inst.current?.resize())
    ro.observe(ref.current)
    return () => { ro.disconnect(); inst.current?.dispose() }
  }, [])
  useEffect(() => {
    if (inst.current && option) inst.current.setOption(option, notMerge)
  }, [option, notMerge])
  useEffect(() => {
    if (!inst.current || !onClick) return
    inst.current.off('click')
    inst.current.on('click', onClick)
  }, [onClick])
  return <div ref={ref} style={{ width: '100%', height: 260, ...style }} />
}
