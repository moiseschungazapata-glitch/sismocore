import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Dialog, EmptyState, Panel } from '../../components/ui'
import { fecha } from '../../lib/format'
import { listAudit, type AuditEntry } from '../../services/administration'
import './administration.css'

const actions: Record<string, string> = {
  'sesion.iniciar':'Inicio de sesión', 'sesion.rechazada':'Acceso rechazado', 'sesion.cerrar':'Cierre de sesión',
  'contrasena.actualizar':'Cambio de contraseña', 'acceso.denegado':'Operación denegada',
  'usuario.crear':'Creación de cuenta', 'usuario.consultar':'Consulta de cuentas',
  'auditoria.consultar':'Consulta de auditoría', 'reporte.exportar':'Exportación autorizada',
  INSERT:'Creación de registro', UPDATE:'Cambio de registro', DELETE:'Eliminación de registro',
}
const labels: Record<string, string> = { correcto:'Correcto', error:'Error', denegado:'Denegado' }

export default function Audit() {
  const [filters, setFilters] = useState({ pagina:'1', tamano:'20', accion:'', resultado:'', desde:'', hasta:'' })
  const [revision, setRevision] = useState(0)
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<AuditEntry | null>(null)
  const cutoff = useRef('')
  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      setLoading(true); setError('')
      try {
        const data = await listAudit({ ...filters, fecha_corte:cutoff.current }, controller.signal)
        if (!controller.signal.aborted) { setRows(data.registros); setTotal(data.total); cutoff.current = data.fecha_corte }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se pudo consultar la auditoría.') }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })
    return () => controller.abort()
  }, [filters, revision])
  function change(key: keyof typeof filters, value: string) {
    if (key !== 'pagina') cutoff.current = ''
    setFilters({ ...filters, [key]:value, ...(key !== 'pagina' ? { pagina:'1' } : {}) })
  }
  return <div className="admin-content"><Panel title="Bitácora de operaciones" description="Historial protegido. Las fechas de la tabla se muestran en hora de Perú." action={<Badge tone="info">Solo consulta</Badge>}>
    <div className="admin-info"><p>Registra accesos, operaciones administrativas y solicitudes de exportación. No contiene contraseñas ni tokens. Cada consulta de esta bitácora también queda registrada.</p></div>
    <div className="admin-filters audit-filters"><label className="field"><span>Acción</span><select value={filters.accion} onChange={event => change('accion',event.target.value)}><option value="">Todas las acciones</option>{Object.entries(actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field"><span>Resultado</span><select value={filters.resultado} onChange={event => change('resultado',event.target.value)}><option value="">Todos los resultados</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field"><span>Desde · fecha UTC</span><input type="date" value={filters.desde} onChange={event => change('desde',event.target.value)} /></label><label className="field"><span>Hasta · fecha UTC</span><input type="date" value={filters.hasta} min={filters.desde || undefined} onChange={event => change('hasta',event.target.value)} /></label><Button icon="refresh" loading={loading} onClick={() => { cutoff.current = ''; setFilters({ ...filters, pagina:'1' }); setRevision(value => value + 1) }}>Actualizar bitácora</Button></div>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {loading ? <p className="admin-loading" role="status"><span className="spinner" /> Consultando operaciones…</p> : !error && (rows.length ? <>
      <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Historial de auditoría"><table className="admin-table"><caption className="sr-only">Operaciones de la plataforma</caption><thead><tr><th>Fecha · Perú</th><th>Responsable</th><th>Acción</th><th>Entidad</th><th>Resultado</th><th><span className="sr-only">Detalle</span></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{fecha(row.ocurrido_en)}</td><td>{row.actor?.nombre_completo || (row.actor_tipo === 'sistema' ? 'Sistema' : 'Usuario')}<small>{row.actor_id || 'Sin cuenta asociada'}</small></td><td>{actions[row.accion] || row.accion}</td><td>{row.entidad}</td><td><Badge tone={row.resultado === 'correcto' ? 'success' : row.resultado === 'denegado' ? 'warning' : 'danger'}>{labels[row.resultado] || row.resultado}</Badge></td><td><Button icon="eye" aria-label={`Ver detalle de operación ${row.id}`} onClick={() => setSelected(row)}>Detalle</Button></td></tr>)}</tbody></table></div>
      <div className="account-cards">{rows.map(row => <article className="account-card" key={row.id}><strong>{actions[row.accion] || row.accion}</strong><p>{fecha(row.ocurrido_en)} · Perú</p><p>{row.actor?.nombre_completo || (row.actor_tipo === 'sistema' ? 'Sistema' : 'Usuario')} · {row.entidad}</p><Badge tone={row.resultado === 'correcto' ? 'success' : 'warning'}>{labels[row.resultado] || row.resultado}</Badge><Button onClick={() => setSelected(row)} aria-label={`Ver detalle de operación ${row.id}`}>Ver detalle</Button></article>)}</div>
    </> : <EmptyState icon="audit" title="Sin operaciones para este filtro" description="Cambia el periodo o el tipo de operación." />)}
    {!loading && !error && <div className="pagination"><span>{total} operaciones · página {filters.pagina}</span><div><Button disabled={Number(filters.pagina) <= 1} onClick={() => change('pagina', String(Number(filters.pagina) - 1))}>Anterior</Button><Button disabled={Number(filters.pagina) * 20 >= total} onClick={() => change('pagina', String(Number(filters.pagina) + 1))}>Siguiente</Button></div></div>}
  </Panel><Dialog open={selected !== null} title={selected ? actions[selected.accion] || selected.accion : 'Detalle de operación'} eyebrow="AUDITORÍA" description="Registro de consulta; no puede editarse desde la aplicación." onClose={() => setSelected(null)}>{selected && <><dl className="source-details audit-details"><div><dt>Fecha UTC</dt><dd>{new Date(selected.ocurrido_en).toISOString()}</dd></div><div><dt>Entidad</dt><dd>{selected.entidad} · {selected.entidad_id || 'Sin registro específico'}</dd></div><div><dt>Responsable</dt><dd>{selected.actor?.nombre_completo || selected.actor_id || 'Sistema'}</dd></div><div><dt>Correlación de solicitud</dt><dd>{selected.correlacion_id || 'Registro anterior sin correlación'}</dd></div></dl><div className="audit-json"><section><h3>Antes</h3><pre>{JSON.stringify(selected.antes, null, 2) || 'Sin datos'}</pre></section><section><h3>Después / contexto</h3><pre>{JSON.stringify(selected.despues, null, 2) || 'Sin datos'}</pre></section></div></>}</Dialog></div>
}
