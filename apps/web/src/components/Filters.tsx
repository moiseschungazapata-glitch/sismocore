import { useId } from 'react'
import { Icon } from './Icon'
import { Button, Badge } from './ui'
import type { Filters as FilterValues } from '../lib/filters'
import { filterError, invalidDateRange } from '../lib/filters'

export function Filters({ values, onChange, onClear, total, filtered, cutoff, regions = [] }: { values: FilterValues; onChange: (values: FilterValues) => void; onClear: () => void; total: number; filtered: number; cutoff?: string; regions?: string[] }) {
  const errorId = useId()
  const invalid = invalidDateRange(values)
  const error = filterError(values)
  const active = Number(Boolean(values.q)) + Number(values.magnitude !== 'todos') + Number(Boolean(values.since)) + Number(Boolean(values.until)) + Object.entries(values).filter(([k,v])=>!['q','magnitude','since','until'].includes(k)&&!!v).length
  return <details className="filters-panel" open><summary><span><Icon name="filter" size={18} />Filtrar catálogo{active > 0 && <Badge tone="info">{active} activos</Badge>}</span><span className="filter-count">{filtered} de {total} eventos<Icon name="chevron" size={15} /></span></summary><div className="filter-body"><div className="shared-filters">
    <label className="field field--search"><span>Buscar ubicación o ID</span><span className="input-with-icon"><Icon name="search" size={18} /><input value={values.q} onChange={e => onChange({ ...values, q: e.target.value })} placeholder="Ubicación o identificador…" maxLength={200} autoComplete="off" /></span></label>
    <label className="field"><span>Magnitud</span><select value={values.magnitude} onChange={e => onChange({ ...values, magnitude: e.target.value })}><option value="todos">Todas las magnitudes</option><option value="menor">Menor de 4</option><option value="medio">4 a menos de 6</option><option value="mayor">6 o más</option></select></label>
    <label className="field"><span>Desde · fecha UTC</span><input type="date" value={values.since} max={values.until && (!cutoff || values.until < cutoff.slice(0, 10)) ? values.until : cutoff?.slice(0, 10)} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} onChange={e => onChange({ ...values, since: e.target.value })} /></label>
    <label className="field"><span>Hasta · fecha UTC</span><input type="date" value={values.until} min={values.since || undefined} max={cutoff?.slice(0, 10)} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} onChange={e => onChange({ ...values, until: e.target.value })} /></label>
    <Button variant="ghost" icon="close" onClick={onClear} disabled={active === 0}>Limpiar filtros</Button>
  </div><details className="advanced-filters"><summary>Filtros avanzados · magnitud, profundidad y zona</summary><div className="advanced-grid">
    {([['minMagnitude','Magnitud mínima',0,10],['maxMagnitude','Magnitud máxima',0,10],['minDepth','Profundidad mínima (km)',0,1000],['maxDepth','Profundidad máxima (km)',0,1000]] as const).map(([key,label,min,max])=><label className="field" key={key}><span>{label}</span><input type="number" min={min} max={max} step="any" value={values[key]||''} onChange={e=>onChange({...values,[key]:e.target.value})}/></label>)}
    <label className="field"><span>Región</span><select aria-label="Región" value={values.region||''} onChange={e=>onChange({...values,region:e.target.value})}><option value="">Todas las regiones</option>{Array.from(new Set([...regions,...(values.region?[values.region]:[])])).sort().map(r=><option key={r}>{r}</option>)}</select></label>
    <label className="field"><span>Proveedor</span><select aria-label="Proveedor" value={values.source||''} onChange={e=>onChange({...values,source:e.target.value})}><option value="">Todas las fuentes disponibles</option><option value="igp">IGP / CENSIS</option></select></label>
    {([['latitude','Centro · latitud',-90,90],['longitude','Centro · longitud',-180,180],['radius','Radio (km)',0.001,2000]] as const).map(([key,label,min,max])=><label className="field" key={key}><span>{label}</span><input type="number" min={min} max={max} step="any" value={values[key]||''} onChange={e=>onChange({...values,[key]:e.target.value})}/></label>)}
    <label className="field polygon-field"><span>Polígono · coordenadas [latitud, longitud]</span><textarea rows={2} maxLength={3000} placeholder="[[-12,-77],[-11,-76],[-13,-75]]" value={values.polygon||''} onChange={e=>onChange({...values,polygon:e.target.value})}/></label>
    </div><p className="field-help">Los límites son inclusivos. Puedes dibujar el polígono en Mapa sísmico. Si usas radio y polígono, se aplica su intersección.</p></details>{error && <p id={errorId} className="inline-error" role="alert">{error}</p>}<p className="field-help">Rango inclusivo en UTC. Estos filtros se comparten entre dashboard, tabla, mapa, análisis y exportación.</p></div></details>
}
