import type { EventoSismico } from '../services/api'
import { Metric, Panel } from './ui'
import { number } from '../lib/format'

export function Statistics({ events, cutoff }: { events: EventoSismico[]; cutoff: string }) {
  const magnitudes = events.flatMap(e => e.magnitud === null ? [] : [e.magnitud])
  const averageDepth = events.length ? events.reduce((sum, e) => sum + e.profundidad, 0) / events.length : null
  const ranges = [
    { label: 'Menor de 4', value: magnitudes.filter(m => m < 4).length },
    { label: '4 a menos de 6', value: magnitudes.filter(m => m >= 4 && m < 6).length },
    { label: '6 o más', value: magnitudes.filter(m => m >= 6).length },
  ]
  const days = Array.from({ length: 8 }, (_, i) => {
    const key = new Date(new Date(cutoff).getTime() - (7 - i) * 86400000).toISOString().slice(0, 10)
    return { label: `${key.slice(8, 10)}/${key.slice(5, 7)}`, value: events.filter(e => e.ocurrido_en.slice(0, 10) === key).length }
  })
  return <><div className="metrics-grid"><Metric icon="event" title="Tamaño de muestra" value={String(events.length)} note="Observaciones del filtro actual" accent /><Metric icon="chart" title="Magnitud promedio" value={magnitudes.length ? number(magnitudes.reduce((sum, m) => sum + m, 0) / magnitudes.length, 2) : '—'} note="Media de magnitudes reportadas" /><Metric icon="depth" title="Profundidad promedio" value={averageDepth === null ? '—' : `${number(averageDepth)} km`} note="Según el conjunto seleccionado" /><Metric icon="info" title="Magnitud sin dato" value={String(events.length - magnitudes.length)} note="Excluida del promedio" /></div><div className="section-grid"><Panel title="Distribución por magnitud" description="Conteo por rango de magnitud reportada"><Bars data={ranges} /></Panel><Panel title="Eventos por día · UTC" description="Fechas agrupadas en tiempo universal"><Bars data={days} /></Panel></div><p className="context-note">Fuente: USGS · muestra: {events.length} eventos · se aplican los filtros del catálogo. El análisis es descriptivo y no constituye una predicción.</p></>
}

function Bars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.value))
  return <div className="bar-chart" role="img" aria-label={data.map(d => `${d.label}: ${d.value} eventos`).join('; ')}>{data.map(d => <div className="bar-row" key={d.label}><span>{d.label}</span><div className="bar-track"><div style={{ width: `${d.value / max * 100}%` }} /></div><strong>{d.value}</strong></div>)}<p className="chart-note">Número de eventos · escala desde cero</p></div>
}
