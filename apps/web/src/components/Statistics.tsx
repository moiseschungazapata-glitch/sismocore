import { useEffect, useRef, useState } from 'react'
import type { EventoSismico } from '../services/api'
import { Metric, Panel } from './ui'
import { number } from '../lib/format'

export function Statistics({ events, cutoff, days = 30 }: { events: EventoSismico[]; cutoff: string; days?: number }) {
  const magnitudes = events.flatMap(e => e.magnitud === null ? [] : [e.magnitud])
  const averageDepth = events.length ? events.reduce((sum, e) => sum + e.profundidad, 0) / events.length : null
  const ranges = [
    { label: 'Menor de 4', value: magnitudes.filter(m => m < 4).length, color: '#60c5d5' },
    { label: '4 a menos de 6', value: magnitudes.filter(m => m >= 4 && m < 6).length, color: '#7aa5eb' },
    { label: '6 o más', value: magnitudes.filter(m => m >= 6).length, color: '#b39cde' },
  ]
  const byDate = new Map<string, number>()
  events.forEach(event => {
    const date = event.ocurrido_en.slice(0, 10)
    byDate.set(date, (byDate.get(date) || 0) + 1)
  })
  const dailyCounts = Array.from({ length: days + 1 }, (_, i) => {
    const key = new Date(new Date(cutoff).getTime() - (days - i) * 86400000).toISOString().slice(0, 10)
    return { date: key, label: `${key.slice(8, 10)}/${key.slice(5, 7)}`, value: byDate.get(key) || 0 }
  })
  return <><div className="metrics-grid"><Metric icon="event" title="Tamaño de muestra" value={String(events.length)} note="Observaciones del filtro actual" accent /><Metric icon="chart" title="Magnitud promedio" value={magnitudes.length ? number(magnitudes.reduce((sum, m) => sum + m, 0) / magnitudes.length, 2) : '—'} note="Media de magnitudes reportadas" /><Metric icon="depth" title="Profundidad promedio" value={averageDepth === null ? '—' : `${number(averageDepth)} km`} note="Según el conjunto seleccionado" /><Metric icon="info" title="Magnitud sin dato" value={String(events.length - magnitudes.length)} note="Excluida del promedio" /></div>
    <div className="analysis-grid"><Panel title="Distribución por magnitud" description="Participación de cada rango en la muestra."><div className="bar-chart magnitude-distribution" role="img" aria-label={ranges.map(d => `${d.label}: ${d.value} eventos`).join('; ')}>{ranges.map(range => <div className="distribution-item" key={range.label}><div className="distribution-label"><span><i style={{ backgroundColor:range.color }} aria-hidden="true" />{range.label}</span><strong>{range.value}<small>{magnitudes.length ? number(range.value / magnitudes.length * 100) : '0'} %</small></strong></div><div className="distribution-track"><div style={{ width:`${magnitudes.length ? range.value / magnitudes.length * 100 : 0}%`, backgroundColor:range.color }} /></div></div>)}</div><p className="distribution-note">{magnitudes.length} eventos con magnitud disponible. Los valores sin dato se excluyen de esta distribución.</p></Panel>
    <Panel title="Actividad diaria" description={`Del ${dailyCounts[0].label} al ${dailyCounts.at(-1)?.label} · fechas UTC`}><DailyChart data={dailyCounts} /><details className="daily-data"><summary>Consultar datos diarios</summary><div className="daily-table-scroll" tabIndex={0} role="region" aria-label="Datos de actividad diaria"><table><caption className="sr-only">Número de eventos por fecha UTC</caption><thead><tr><th scope="col">Fecha UTC</th><th scope="col">Eventos</th></tr></thead><tbody>{dailyCounts.map(day => <tr key={day.date}><td>{day.date}</td><td>{day.value}</td></tr>)}</tbody></table></div></details></Panel></div>
    <p className="context-note">Fuente: IGP / CENSIS · muestra: {events.length} eventos · se aplican los filtros del catálogo. El análisis es descriptivo y no constituye una predicción.</p></>
}

function DailyChart({ data }: { data: { date:string; label:string; value:number }[] }) {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(Math.max(220, element.clientWidth)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const max = Math.max(...data.map(day => day.value))
  const upper = Math.max(4, Math.ceil(max / 4) * 4)
  const plot = { left:30, right:12, top:20, bottom:207 }
  const step = (width - plot.left - plot.right) / data.length
  const labelEvery = Math.max(1, Math.ceil((data.length - 1) / (width < 420 ? 3 : 5)))
  return <div className="bar-chart daily-chart" ref={container}><svg viewBox={`0 0 ${width} 240`} role="img" aria-label={`Eventos diarios en UTC. ${data.length} fechas. Máximo de ${max} eventos en un día. Consulta los valores exactos en la tabla de datos diarios.`}>
    <text className="chart-axis-title" x={plot.left} y={10}>Eventos</text>
    {[0, 1, 2, 3, 4].map(tick => {
      const value = tick * upper / 4
      const y = plot.bottom - tick * (plot.bottom - plot.top) / 4
      return <g key={tick}><line className="chart-gridline" x1={plot.left} x2={width - plot.right} y1={y} y2={y} /><text className="chart-axis-label" x={plot.left - 9} y={y + 4} textAnchor="end">{value}</text></g>
    })}
    {data.map((day, index) => {
      const height = day.value / upper * (plot.bottom - plot.top)
      const x = plot.left + index * step + step * .15
      return <g key={day.date}><rect className="daily-bar" x={x} y={plot.bottom - height} width={Math.max(1, step * .7)} height={height} rx={Math.min(3, step * .15)}><title>{day.date} UTC: {day.value} eventos</title></rect>{(index % labelEvery === 0 || index === data.length - 1) && <text className="chart-axis-label" x={x + step * .35} y={227} textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}>{day.label}</text>}</g>
    })}
  </svg><p className="daily-chart-note">Cada barra representa un día. Los días sin eventos conservan el valor cero.</p></div>
}
