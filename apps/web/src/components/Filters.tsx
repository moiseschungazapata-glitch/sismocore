import { useId } from 'react'
import { Icon } from './Icon'
import { Button, Badge } from './ui'
import type { Filters as FilterValues } from '../lib/filters'
import { invalidDateRange } from '../lib/filters'

export function Filters({ values, onChange, onClear, total, filtered, cutoff }: { values: FilterValues; onChange: (values: FilterValues) => void; onClear: () => void; total: number; filtered: number; cutoff?: string }) {
  const errorId = useId()
  const invalid = invalidDateRange(values)
  const active = Number(Boolean(values.q)) + Number(values.magnitude !== 'todos') + Number(Boolean(values.since)) + Number(Boolean(values.until))
  return <details className="filters-panel" open><summary><span><Icon name="filter" size={18} />Filtrar catálogo{active > 0 && <Badge tone="info">{active} activos</Badge>}</span><span className="filter-count">{filtered} de {total} eventos<Icon name="chevron" size={15} /></span></summary><div className="filter-body"><div className="shared-filters">
    <label className="field field--search"><span>Buscar ubicación o ID</span><span className="input-with-icon"><Icon name="search" size={18} /><input value={values.q} onChange={e => onChange({ ...values, q: e.target.value })} placeholder="Ubicación o identificador…" maxLength={200} autoComplete="off" /></span></label>
    <label className="field"><span>Magnitud</span><select value={values.magnitude} onChange={e => onChange({ ...values, magnitude: e.target.value })}><option value="todos">Todas las magnitudes</option><option value="menor">Menor de 4</option><option value="medio">4 a menos de 6</option><option value="mayor">6 o más</option></select></label>
    <label className="field"><span>Desde · fecha UTC</span><input type="date" value={values.since} max={values.until && (!cutoff || values.until < cutoff.slice(0, 10)) ? values.until : cutoff?.slice(0, 10)} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} onChange={e => onChange({ ...values, since: e.target.value })} /></label>
    <label className="field"><span>Hasta · fecha UTC</span><input type="date" value={values.until} min={values.since || undefined} max={cutoff?.slice(0, 10)} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} onChange={e => onChange({ ...values, until: e.target.value })} /></label>
    <Button variant="ghost" icon="close" onClick={onClear} disabled={active === 0}>Limpiar filtros</Button>
  </div>{invalid && <p id={errorId} className="inline-error" role="alert">La fecha Hasta debe ser igual o posterior a Desde.</p>}<p className="field-help">Rango inclusivo en UTC. Estos filtros se comparten entre dashboard, tabla, mapa, análisis y exportación.</p></div></details>
}
