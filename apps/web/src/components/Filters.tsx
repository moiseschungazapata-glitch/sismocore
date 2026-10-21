import { Icon } from './Icon'
import { Button, Badge } from './ui'
import type { Filters as FilterValues } from '../lib/filters'

export function Filters({ values, onChange, onClear, total, filtered, cutoff }: { values: FilterValues; onChange: (values: FilterValues) => void; onClear: () => void; total: number; filtered: number; cutoff?: string }) {
  const active = Number(Boolean(values.q)) + Number(values.magnitude !== 'todos') + Number(Boolean(values.since))
  return <details className="filters-panel" open><summary><span><Icon name="filter" size={18} />Filtrar catálogo{active > 0 && <Badge tone="info">{active} activos</Badge>}</span><span className="filter-count">{filtered} de {total} eventos<Icon name="chevron" size={15} /></span></summary><div className="filter-body"><div className="shared-filters">
    <label className="field field--search"><span>Buscar ubicación o ID</span><span className="input-with-icon"><Icon name="search" size={18} /><input value={values.q} onChange={e => onChange({ ...values, q: e.target.value })} placeholder="Ubicación o identificador…" maxLength={200} autoComplete="off" /></span></label>
    <label className="field"><span>Magnitud</span><select value={values.magnitude} onChange={e => onChange({ ...values, magnitude: e.target.value })}><option value="todos">Todas las magnitudes</option><option value="menor">Menor de 4</option><option value="medio">4 a menos de 6</option><option value="mayor">6 o más</option></select></label>
    <label className="field"><span>Desde · fecha UTC</span><input type="date" value={values.since} max={cutoff?.slice(0, 10)} onChange={e => onChange({ ...values, since: e.target.value })} /></label>
    <Button variant="ghost" icon="close" onClick={onClear} disabled={active === 0}>Limpiar filtros</Button>
  </div><p className="field-help">Estos filtros se comparten entre dashboard, tabla, mapa, análisis y exportación.</p></div></details>
}
