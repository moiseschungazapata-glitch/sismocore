import { igpReportUrl } from './lib/igp'
import { useEffect, useRef, useState } from 'react'
import './App.css'
import { useCatalog } from './hooks/useCatalog'
import { navigate, pages, useLocation } from './lib/navigation'
import { Link } from './components/Link'
import { readFilters, filterSearch, invalidDateRange, type Filters as FilterValues } from './lib/filters'
import { fecha, number } from './lib/format'
import { containDialogFocus } from './lib/accessibility'
import { descargarReporte } from './lib/export'
import { Icon, type IconName } from './components/Icon'
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, LoadingState, Metric, Panel } from './components/ui'
import { EventTable, Magnitude } from './components/EventTable'
import { Filters } from './components/Filters'
import { Statistics } from './components/Statistics'
import MapaSismico from './components/MapaSismico'
import type { EventoSismico } from './services/api'
import AccessGate from './pages/index'
import type { AuthUser } from './services/auth'
import { can, roleNames } from './lib/permissions'
import Users from './pages/administration/Users'
import Audit from './pages/administration/Audit'
import { authorizeExport } from './services/administration'

function Monitoring({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const { datos, salud, error, cargando, actualizando, cargar, connection } = useCatalog()
  const { path, search, page } = useLocation()
  const filters = readFilters(search)
  const [selected, setSelected] = useState<EventoSismico | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [exported, setExported] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const drawer = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const previousPath = useRef(path)
  const emptyFilters = { q: '', magnitude: 'todos', since: '', until: '' }
  const updateFilters = (values: FilterValues) => navigate(path + filterSearch(values), true)
  const clearFilters = () => updateFilters(emptyFilters)
  const route = (target: string) => target + filterSearch(filters)
  const events = (datos?.eventos ?? []).filter(event => {
    const text = `${event.lugar} ${event.id_externo} ${event.id}`.toLocaleLowerCase('es')
    return !invalidDateRange(filters) && text.includes(filters.q.trim().toLocaleLowerCase('es')) &&
      (!filters.since || event.ocurrido_en.slice(0, 10) >= filters.since) &&
      (!filters.until || event.ocurrido_en.slice(0, 10) <= filters.until) &&
      (filters.magnitude === 'todos' || (event.magnitud !== null && (filters.magnitude === 'menor' ? event.magnitud < 4 : filters.magnitude === 'medio' ? event.magnitud >= 4 && event.magnitud < 6 : event.magnitud >= 6)))
  })
  const magnitudes = events.flatMap(event => event.magnitud === null ? [] : [event.magnitud])
  const max = magnitudes.length ? number(Math.max(...magnitudes)) : '—'
  const averageDepth = events.length ? `${number(events.reduce((sum, event) => sum + event.profundidad, 0) / events.length)} km` : '—'
  const filterKey = JSON.stringify(filters)
  const allowed = !page || can(user, page.permission)
  const administrative = page && ['usuarios','auditoria'].includes(page.id)
  const pending = page && 'pending' in page && page.pending
  const showFilters = allowed && page && ['dashboard', 'eventos', 'mapa', 'analisis', 'reportes'].includes(page.id)
  const initialLoading = cargando && !datos
  const linkAction = <Link className="button button--secondary" href={route('/eventos')}>Ver catálogo<Icon name="arrow" size={16} /></Link>

  useEffect(() => {
    document.title = `${page?.heading || 'Página no encontrada'} · SISMOCORE`
    if (previousPath.current !== path) {
      heading.current?.focus({ preventScroll: true })
      window.scrollTo({ top: 0, behavior: 'instant' })
      previousPath.current = path
    }
  }, [page, path])
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const closeDesktop = () => { if (media.matches) drawer.current?.close() }
    media.addEventListener('change', closeDesktop)
    return () => media.removeEventListener('change', closeDesktop)
  }, [])

  const navigation = (mobile = false) => <>
    {['Monitoreo', 'Gestión'].map(group => <div className="nav-group" key={group}><p className="menu-label">{group}</p><nav aria-label={`${group}${mobile ? ' móvil' : ''}`}>{pages.filter(item => item.group === group && can(user, item.permission)).map(item => <Link className={`nav-item ${page?.id === item.id ? 'active' : ''}`} href={route(item.path)} key={item.id} aria-current={page?.id === item.id ? 'page' : undefined} onClick={() => { if (mobile) drawer.current?.close() }}><Icon name={item.icon} size={19} /><span>{item.title}</span>{'pending' in item && item.pending && <span className="nav-pending" aria-hidden="true">Próx.</span>}</Link>)}</nav></div>)}
  </>

  async function downloadReport() {
    if (exporting || invalidDateRange(filters)) return
    setExporting(true)
    setExported(false)
    setExportError('')
    try {
      const snapshot = await authorizeExport(filters)
      await descargarReporte(snapshot.eventos, { filters, lastSync:snapshot.ultima_sincronizacion, days:snapshot.periodo_dias, requestedBy:snapshot.solicitante.nombre, cutoff:snapshot.consultado_en, exportId:snapshot.exportacion_id })
      setExported(true)
    } catch {
      setExportError('No se pudo preparar el reporte. Vuelve a intentarlo.')
    } finally {
      setExporting(false)
    }
  }

  function openMenu() { drawer.current?.showModal(); setMenuOpen(true) }
  async function logout() {
    if (signingOut) return
    setSigningOut(true)
    try { await onLogout() }
    finally { setSigningOut(false); setConfirmLogout(false) }
  }
  const tableProps = { events, onDetail: setSelected, onClear: clearFilters }
  const connectionIcon = connection.icon as IconName

  return <div className="app">
    <ConfirmDialog open={confirmLogout} title="¿Cerrar sesión?" description="Tendrás que iniciar sesión de nuevo para acceder a SISMOCORE." confirmLabel="Sí, cerrar sesión" busy={signingOut} onCancel={() => { if (!signingOut) setConfirmLogout(false) }} onConfirm={() => void logout()} />
    <a className="skip-link" href="#contenido">Saltar al contenido</a>
    <header className="topbar"><div className="topbar-brand"><Button variant="ghost" icon="menu" className="menu-toggle icon-button" aria-label="Abrir menú de navegación" aria-controls="mobile-menu" aria-expanded={menuOpen} onClick={openMenu} /><Link className="brand" href={route('/')} title="Ir al dashboard"><span className="brand-icon"><Icon name="wave" size={26} /></span><span><span className="brand-name">SISMO<span>CORE</span></span><span className="brand-caption">MONITOREO SÍSMICO</span></span></Link></div><div className="topbar-right"><span className="topbar-description">Observaciones, análisis y seguimiento</span><Button variant="ghost" icon="logout" className="session-mobile" aria-label="Cerrar sesión" loading={signingOut} onClick={() => setConfirmLogout(true)} /><div className="system-status" role="status" aria-label={connection.label}><Badge tone={connection.tone} icon={connectionIcon}><span className="status-full">{connection.label}</span><span className="status-short" aria-hidden="true">{connection.short}</span></Badge></div></div></header>
    <aside className="sidebar" aria-label="Menú lateral">{navigation()}<div className="sidebar-footer"><span className="source-mark"><Icon name="users" size={18} /></span><div className="session-account"><strong>{user.nombre_completo || user.email}</strong><p>{roleNames[user.rol]}</p><Button className="session-logout" variant="ghost" icon="logout" loading={signingOut} onClick={() => setConfirmLogout(true)}>Cerrar sesión</Button></div></div></aside>
    <dialog className="mobile-drawer" id="mobile-menu" ref={drawer} aria-labelledby="mobile-menu-title" onKeyDown={containDialogFocus} onClose={() => setMenuOpen(false)} onClick={event => { if (event.target === event.currentTarget) drawer.current?.close() }}><div className="drawer-shell"><div className="drawer-header"><h2 id="mobile-menu-title">Navegación</h2><Button variant="ghost" icon="close" className="icon-button" aria-label="Cerrar menú" onClick={() => drawer.current?.close()} /></div>{navigation(true)}<div className="drawer-account"><strong>{user.nombre_completo || user.email}</strong><p>{roleNames[user.rol]}</p></div><p className="drawer-note">Fuente de datos: IGP / CENSIS<br />Almacenamiento: Supabase</p></div></dialog>
    <main className="main-content" id="contenido" tabIndex={-1}>
      <div className="page-heading"><div><p className="eyebrow">{page?.group || 'NAVEGACIÓN'}<span className="eyebrow-separator">/</span>SISMOCORE</p><h1 ref={heading} tabIndex={-1}>{page?.heading || 'Página no encontrada'}</h1><p className="subtitle">{page?.description || 'La dirección no corresponde a un módulo de la plataforma.'}</p></div>{page && allowed && !pending && !administrative && <Button variant="primary" icon="refresh" onClick={() => void cargar()} loading={actualizando}>{actualizando ? 'Consultando…' : 'Actualizar datos'}</Button>}</div>
      {page && allowed && !pending && !administrative && <div className="data-context"><div className="coverage"><span className="context-icon"><Icon name="map" size={19} /></span><div><strong>Cobertura del catálogo</strong><p>Últimos {datos?.periodo_dias ?? 30} días <span>·</span> Reportes del IGP <span>·</span> Perú</p></div></div><div className="sync-context"><Icon name="clock" size={16} /><span>Última sincronización<strong>{fecha(datos?.ultima_sincronizacion)} <span>· Perú</span></strong></span></div></div>}
      {error && page && allowed && !pending && !administrative && <section className={`service-message ${datos ? 'service-message--warning' : 'service-message--danger'}`} role="alert"><Icon name={datos ? 'info' : 'alert'} size={21} /><div><strong>{datos ? 'Mostrando la última consulta disponible' : 'No se pudo actualizar la información'}</strong><p>{error}</p>{datos && <p>Se conserva la última consulta disponible; sus datos pueden estar desactualizados.</p>}</div><Button variant="secondary" icon="refresh" onClick={() => void cargar()} loading={actualizando}>Reintentar conexión</Button></section>}
      {showFilters && <Filters values={filters} onChange={updateFilters} onClear={clearFilters} filtered={events.length} total={datos?.total ?? 0} cutoff={datos?.consultado_en} />}
      {!page ? <Panel title="Esta página no está disponible"><EmptyState icon="map" title="Volvamos al monitoreo" description="Puedes abrir un módulo desde el menú o regresar al dashboard." action={<Link className="button button--primary" href="/">Ir al dashboard<Icon name="arrow" size={16} /></Link>} /></Panel>
        : !allowed ? <Panel title="Acceso restringido"><div className="access-denied"><EmptyState icon="lock" title="Tu rol no tiene acceso a este módulo" description="Puedes consultar las áreas habilitadas desde el menú. Si necesitas otro permiso, contacta al administrador." action={<Link className="button button--primary" href="/">Volver al dashboard</Link>} /></div></Panel>
        : page.id === 'usuarios' ? <Users user={user} />
        : page.id === 'auditoria' ? <Audit />
        : pending ? <section className="pending-panel"><div className="pending-illustration"><Icon name={page.icon} size={34} /></div><Badge tone="neutral" icon="clock">{'phase' in page ? page.phase : ''} · En preparación</Badge><h2>{page.title}</h2><p>{page.id === 'modelos' ? 'Aquí se incorporarán los experimentos, entrenamientos y métricas de evaluación. Todavía no hay modelos ni estimaciones implementados.' : page.id === 'alertas' ? 'Este módulo incorporará reglas, aprobaciones y seguimiento de entregas. Actualmente no se están emitiendo alertas.' : 'El acceso ya se valida con Supabase Auth. La administración de usuarios y el historial de auditoría se incorporarán en la siguiente fase.'}</p><div className="pending-actions"><Link className="button button--primary" href={route('/')}>Volver al monitoreo<Icon name="arrow" size={16} /></Link></div><span className="pending-footnote">El catálogo, el mapa y las exportaciones ya están disponibles.</span></section>
          : initialLoading ? <LoadingState />
            : !datos ? <Panel title="Catálogo no disponible"><EmptyState icon="database" title="Estamos intentando recuperar la conexión" description="Todavía no hay una consulta disponible en este navegador. La pantalla volverá a intentarlo automáticamente." action={<Button icon="refresh" onClick={() => void cargar()} loading={actualizando}>Volver a intentar</Button>} /></Panel>
              : <>
                {datos.total === 0 && <div className="service-message service-message--info" role="status"><Icon name="info" /><div><strong>{datos.sincronizacion === 'sincronizando' ? 'Sincronización en curso' : 'Sin observaciones en el periodo'}</strong><p>{datos.sincronizacion === 'sincronizando' ? 'Los primeros registros aparecerán automáticamente al finalizar la consulta.' : 'La fuente no tiene eventos guardados dentro de la cobertura y el periodo actuales.'}</p>{datos.ultima_ejecucion?.error_resumen && <p>{datos.ultima_ejecucion.error_resumen}</p>}</div></div>}
                {page.id === 'dashboard' && <>
                  <div className="metrics-grid"><Metric title="Eventos del filtro" value={String(events.length)} note="Observaciones guardadas" icon="event" accent /><Metric title="Magnitud máxima" value={max} note="Del mismo conjunto seleccionado" icon="wave" /><Metric title="Profundidad promedio" value={averageDepth} note="Kilómetros reportados por la fuente" icon="depth" /><Metric title="Base de datos" value={salud ? salud.base_datos === 'conectada' ? 'Conectada' : 'Sin conexión' : 'Sin verificar'} note="Persistencia en Supabase" icon="database" /></div>
                  <Panel title="Eventos más recientes" description="Hora de Perú, magnitud y procedencia original." action={linkAction}><EventTable {...tableProps} compact key={filterKey} /></Panel>
                </>}
                {page.id === 'eventos' && <Panel title="Catálogo de eventos" description="Consulta cada observación y su fuente original." action={<Badge tone="info">{events.length} eventos</Badge>}><EventTable {...tableProps} key={filterKey} /></Panel>}
                {page.id === 'mapa' && <><Panel title="Mapa de epicentros" description="Ubicación geográfica de las observaciones seleccionadas." action={<Badge tone="info">{events.length} eventos</Badge>}>{events.length ? <MapaSismico eventos={events} /> : <EmptyState icon="map" title="Sin eventos para este filtro" description="No se encontraron observaciones con las condiciones seleccionadas." action={<Button onClick={clearFilters}>Restablecer filtros</Button>} />}</Panel><Panel title="Observaciones del mapa" description="Alternativa de consulta por teclado y detalle de cada registro."><EventTable {...tableProps} key={filterKey} /></Panel></>}
                {page.id === 'analisis' && (events.length ? <Statistics events={events} cutoff={datos.consultado_en} days={datos.periodo_dias} /> : <Panel title="Análisis descriptivo"><EmptyState icon="chart" title="Sin muestra para analizar" description="Restablece los filtros para visualizar las observaciones disponibles." action={<Button onClick={clearFilters}>Restablecer filtros</Button>} /></Panel>)}
                {page.id === 'fuentes' && <><div className="metrics-grid"><Metric title="Fuente de observaciones" value="IGP / CENSIS" note="Instituto Geofísico del Perú" icon="source" accent /><Metric title="Registros en el periodo" value={String(datos.total)} note="Reportes guardados del IGP" icon="event" /><Metric title="Última ejecución" value={datos.ultima_ejecucion?.estado === 'completada' ? 'Completada' : datos.ultima_ejecucion?.estado === 'fallida' ? 'Con errores' : datos.ultima_ejecucion ? 'En proceso' : 'Pendiente'} note="Historial de sincronización" icon="refresh" /><Metric title="Últimos rechazos" value={datos.ultima_ejecucion ? String(datos.ultima_ejecucion.registros_rechazados) : '—'} note="Registros inválidos descartados" icon="audit" /></div><Panel title="Conector IGP / CENSIS" description="Estado y procedencia de la información recibida." action={<Badge tone={salud?.base_datos === 'conectada' ? 'success' : 'warning'} icon={salud?.base_datos === 'conectada' ? 'check' : 'info'}>{salud?.base_datos === 'conectada' ? 'Supabase conectada' : 'Estado sin confirmar'}</Badge>}><dl className="source-details"><div><dt>Último éxito · hora de Perú</dt><dd>{fecha(datos.ultima_sincronizacion)}</dd></div><div><dt>Frecuencia configurada</dt><dd>Aproximadamente cada {Math.round((datos.frecuencia_segundos ?? 600) / 60)} minutos</dd></div><div><dt>Última ejecución</dt><dd>{datos.ultima_ejecucion?.estado || 'Sin ejecuciones'}</dd></div><div><dt>Registros recibidos</dt><dd>{datos.ultima_ejecucion?.registros_recibidos ?? '—'}</dd></div><div><dt>Insertados / actualizados</dt><dd>{datos.ultima_ejecucion ? `${datos.ultima_ejecucion.registros_insertados} / ${datos.ultima_ejecucion.registros_actualizados}` : '—'}</dd></div><div><dt>Almacenamiento</dt><dd>Supabase PostgreSQL</dd></div></dl><div className="information-note"><Icon name="info" /><p>Se muestran los reportes publicados por el IGP dentro del periodo seleccionado. Consultar cada diez minutos no garantiza nuevos eventos ni publicación inmediata. <a href="https://ultimosismo.igp.gob.pe/productos/reportes-sismicos" target="_blank" rel="noreferrer">Consultar IGP / CENSIS<Icon name="external" size={13} /></a></p></div>{datos.ultima_ejecucion?.error_resumen && <p className="inline-error">{datos.ultima_ejecucion.error_resumen}</p>}</Panel></>}
                {page.id === 'reportes' && <Panel title="Reporte del catálogo" description="Descarga las observaciones de tus filtros actuales." action={<Badge tone="info">Reporte disponible</Badge>}><div className="export-card"><span className="export-icon"><Icon name="report" size={32} /></span><div><h3>Reporte de eventos sísmicos</h3><p>{events.length} observaciones con fecha, ubicación, magnitud, profundidad y fuente. Incluye resumen y filtros aplicados.</p><div className="export-tags"><Badge>Fuente: IGP / CENSIS</Badge><Badge>Consulta filtrada</Badge><Badge>Enlaces de procedencia</Badge></div></div><Button variant="primary" icon="download" disabled={!events.length || exporting} loading={exporting} onClick={() => void downloadReport()}>Descargar reporte</Button></div>{exported && <p className="export-success" role="status"><Icon name="check" size={17} />Reporte preparado. Tu navegador gestiona la descarga del archivo.</p>}{exportError && <p className="inline-error" role="alert">{exportError}</p>}<div className="information-note"><Icon name="info" /><p>El reporte se abre en Excel con columnas organizadas, filtros y encabezados fijos. Las fechas incluyen hora de Perú y UTC.</p></div></Panel>}
              </>}
      <footer className="page-footer"><span><Icon name="wave" size={15} />SISMOCORE · eventos observados</span><span>IGP / CENSIS · Supabase <span className="footer-separator">/</span> Consulta cada 30 s</span></footer>
    </main>
    <Dialog open={selected !== null} title={selected?.lugar || 'Detalle del evento'} description="Observación reportada por IGP / CENSIS. No representa una predicción ni una alerta oficial." onClose={() => setSelected(null)}>{selected && <><div className="detail-summary"><Magnitude value={selected.magnitud} type={selected.tipo_magnitud} /><span><Icon name="clock" size={17} />{fecha(selected.ocurrido_en)} · Perú</span></div><dl className="source-details event-details"><div><dt>Profundidad</dt><dd>{number(selected.profundidad)} km</dd></div><div><dt>Latitud / longitud</dt><dd>{number(selected.latitud, 4)}, {number(selected.longitud, 4)}</dd></div><div><dt>Fecha UTC</dt><dd>{new Date(selected.ocurrido_en).toLocaleString('es-PE', { timeZone: 'UTC' })}</dd></div><div><dt>Identificador de origen</dt><dd>{selected.id_externo}</dd></div><div><dt>Estado de revisión</dt><dd>{selected.estado_revision === 'reportado_igp' ? 'Reportado por el IGP' : selected.estado_revision}</dd></div><div><dt>Proveedor</dt><dd>IGP / CENSIS</dd></div></dl><a className="button button--primary detail-source" href={igpReportUrl(selected)} target="_blank" rel="noreferrer">Ver evento original en IGP / CENSIS<Icon name="external" size={16} /></a></>}</Dialog>
  </div>
}

export default function App() {
  return <AccessGate component={Monitoring} />
}
