import { igpReportUrl } from '../lib/igp'
import { useState } from 'react'
import type { EventoSismico } from '../services/api'
import { fecha, magnitudeStyle, number } from '../lib/format'
import { Button, EmptyState } from './ui'
import { Icon } from './Icon'

export function Magnitude({ value, type }: { value: number | null; type?: string | null }) {
  const style = magnitudeStyle(value)
  return <span className={`magnitude magnitude--${style.key}`}><span className="magnitude-number">{value === null ? '—' : number(value)}</span><span>{value === null ? 'Sin dato' : type || 'M'}</span></span>
}

export function EventTable({ events, compact = false, onDetail, onClear }: { events: EventoSismico[]; compact?: boolean; onDetail: (event: EventoSismico) => void; onClear: () => void }) {
  const [page, setPage] = useState(0)
  const [order,setOrder] = useState('fecha-desc')
  const sorted=[...events].sort((a,b)=>{
    const [field,direction]=order.split('-')
    const value=(e:EventoSismico)=>field==='fecha'?Date.parse(e.ocurrido_en):field==='magnitud'?e.magnitud:field==='profundidad'?e.profundidad:e.lugar
    const av=value(a),bv=value(b)
    if(av===null)return bv===null?a.id.localeCompare(b.id):1
    if(bv===null)return -1
    const comparison=typeof av==='string'&&typeof bv==='string'?av.localeCompare(bv,'es'):Number(av)-Number(bv)
    return comparison*(direction==='asc'?1:-1)||a.id.localeCompare(b.id)
  })
  const pages = Math.max(1, Math.ceil(events.length / 20))
  const current = Math.min(page, pages - 1)
  const visible = compact ? sorted.slice(0, 5) : sorted.slice(current * 20, (current + 1) * 20)
  if (!events.length) return <EmptyState title="No hay eventos para este filtro" description="Prueba otra ubicación, magnitud o fecha dentro del periodo disponible." action={<Button onClick={onClear} icon="filter">Restablecer filtros</Button>} />
  return <>
    {!compact&&<div className="table-toolbar"><span>{events.length} observaciones · 20 por página</span><label className="field"><span>Ordenar eventos</span><select value={order} onChange={e=>{setOrder(e.target.value);setPage(0)}}><option value="fecha-desc">Más recientes primero</option><option value="fecha-asc">Más antiguos primero</option><option value="magnitud-desc">Mayor magnitud</option><option value="magnitud-asc">Menor magnitud</option><option value="profundidad-desc">Mayor profundidad</option><option value="profundidad-asc">Menor profundidad</option><option value="lugar-asc">Ubicación A–Z</option></select></label></div>}
    <div className="table-scroll" role="region" aria-label="Tabla de eventos" tabIndex={0}><table className="events-table"><caption className="sr-only">Eventos observados por IGP / CENSIS. Fechas en hora de Perú y profundidades en kilómetros.</caption><thead><tr><th scope="col">Fecha · Perú</th><th scope="col">Magnitud</th><th scope="col">Ubicación</th><th scope="col">Profundidad</th><th scope="col">Procedencia</th><th scope="col"><span className="sr-only">Detalle</span></th></tr></thead><tbody>{visible.map(event => <tr key={event.id}>
      <td><time dateTime={event.ocurrido_en}>{fecha(event.ocurrido_en)}</time><small>{event.estado_revision === 'reviewed' ? 'Revisado por la fuente' : 'Reportado por la fuente'}</small></td>
      <td><Magnitude value={event.magnitud} type={event.tipo_magnitud} /></td>
      <td className="event-place">{event.lugar}<small>{number(event.latitud, 4)}, {number(event.longitud, 4)}</small></td>
      <td className="numeric">{number(event.profundidad)} <span className="muted">km</span></td>
      <td><a className="source-link" href={igpReportUrl(event)} target="_blank" rel="noreferrer">IGP / CENSIS<Icon name="external" size={13} /><span className="sr-only">, abre en otra pestaña</span></a><small>{event.id_externo}</small></td>
      <td><Button variant="ghost" icon="eye" className="icon-button" aria-label={`Ver detalle de ${event.id_externo}`} title="Ver detalle" onClick={() => onDetail(event)} /></td>
    </tr>)}</tbody></table></div>
    <div className="event-cards">{visible.map(event => <article className="event-card" key={event.id}><div className="event-card-top"><time dateTime={event.ocurrido_en}>{fecha(event.ocurrido_en)} · Perú</time><Magnitude value={event.magnitud} type={event.tipo_magnitud} /></div><h3>{event.lugar}</h3><p className="event-card-depth"><Icon name="depth" size={15} />Profundidad: {number(event.profundidad)} km</p><div className="event-card-bottom"><a className="source-link" href={igpReportUrl(event)} target="_blank" rel="noreferrer">Ver en IGP / CENSIS<Icon name="external" size={14} /></a><Button variant="ghost" icon="eye" onClick={() => onDetail(event)}>Ver detalle</Button></div></article>)}</div>
    {!compact && <div className="pagination"><span>{current * 20 + 1}–{Math.min((current + 1) * 20, events.length)} de {events.length} eventos</span><div><Button variant="ghost" onClick={() => setPage(current - 1)} disabled={current === 0}>Anterior</Button><span className="page-number" aria-live="polite">{current + 1} / {pages}</span><Button variant="ghost" onClick={() => setPage(current + 1)} disabled={current + 1 >= pages}>Siguiente</Button></div></div>}
  </>
}
