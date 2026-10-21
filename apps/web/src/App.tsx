import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { obtenerEventos, verificarAPI, type EventoSismico, type EventosResponse, type HealthResponse } from './services/api'
import MapaSismico from './components/MapaSismico'

type Pagina = 'dashboard' | 'eventos' | 'mapa' | 'analisis' | 'fuentes' | 'reportes' | 'modelos' | 'alertas' | 'usuarios' | 'auditoria'
const paginas: { id: Pagina; nombre: string; icono: string; pendiente?: boolean }[] = [
  { id: 'dashboard', nombre: 'Dashboard', icono: '▦' },
  { id: 'eventos', nombre: 'Eventos sísmicos', icono: '◉' },
  { id: 'mapa', nombre: 'Mapa sísmico', icono: '⌖' },
  { id: 'analisis', nombre: 'Análisis', icono: '▥' },
  { id: 'fuentes', nombre: 'Fuentes de datos', icono: '▧' },
  { id: 'reportes', nombre: 'Reportes', icono: '▤' },
  { id: 'modelos', nombre: 'Modelos de IA', icono: '⌁', pendiente: true },
  { id: 'alertas', nombre: 'Alertas', icono: '♧', pendiente: true },
  { id: 'usuarios', nombre: 'Usuarios y roles', icono: '♙', pendiente: true },
  { id: 'auditoria', nombre: 'Auditoría', icono: '◷', pendiente: true },
]
const fecha = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(value))
  : 'Sin sincronizaciones'
const errorTexto = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la consulta.'

function Indicador({ titulo, valor, nota }: { titulo: string; valor: string; nota: string }) {
  return <article className="metric-card"><p>{titulo}</p><div className="metric-value">{valor}</div><span className="metric-note">{nota}</span></article>
}

function Tabla({ eventos, compacta = false }: { eventos: EventoSismico[]; compacta?: boolean }) {
  const [pagina, setPagina] = useState(0)
  const paginasTotal = Math.max(1, Math.ceil(eventos.length / 20))
  const actual = Math.min(pagina, paginasTotal - 1)
  const visibles = compacta ? eventos.slice(0, 5) : eventos.slice(actual * 20, (actual + 1) * 20)
  if (!eventos.length) return <div className="empty-state"><h4>No hay eventos para este filtro</h4><p>Prueba otra búsqueda o un rango de magnitud diferente.</p></div>
  return <>
    <div className="table-scroll"><table className="events-table"><caption className="sr-only">Eventos observados por USGS, guardados en Supabase. Fechas en hora de Perú.</caption>
      <thead><tr><th scope="col">Fecha · Perú</th><th scope="col">Magnitud</th><th scope="col">Ubicación</th><th scope="col">Profundidad</th><th scope="col">Procedencia</th></tr></thead>
      <tbody>{visibles.map(evento => <tr key={evento.id}>
        <td><time dateTime={evento.ocurrido_en}>{fecha(evento.ocurrido_en)}</time></td>
        <td><strong>{evento.magnitud?.toFixed(1) ?? 'Sin dato'}</strong><small>{evento.tipo_magnitud || ''}</small></td>
        <td>{evento.lugar}<small>{evento.latitud.toFixed(4)}, {evento.longitud.toFixed(4)}</small></td>
        <td>{evento.profundidad.toFixed(1)} km</td>
        <td><a href={evento.url_fuente} target="_blank" rel="noreferrer">USGS ↗<small>{evento.id_externo}</small></a></td>
      </tr>)}</tbody>
    </table></div>
    {!compacta && paginasTotal > 1 && <div className="pagination"><button className="action-button" disabled={actual === 0} onClick={() => setPagina(actual - 1)}>Anterior</button><span>Página {actual + 1} de {paginasTotal}</span><button className="action-button" disabled={actual + 1 >= paginasTotal} onClick={() => setPagina(actual + 1)}>Siguiente</button></div>}
  </>
}

function Analisis({ eventos, corte }: { eventos: EventoSismico[]; corte: string }) {
  const magnitudes = eventos.flatMap(e => e.magnitud === null ? [] : [e.magnitud])
  const profundidad = eventos.length ? eventos.reduce((s, e) => s + e.profundidad, 0) / eventos.length : null
  const rangos = [
    { nombre: 'Menor de 4', n: magnitudes.filter(m => m < 4).length },
    { nombre: '4 a menos de 6', n: magnitudes.filter(m => m >= 4 && m < 6).length },
    { nombre: '6 o más', n: magnitudes.filter(m => m >= 6).length },
  ]
  const dias = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(new Date(corte).getTime() - (7 - i) * 86400000)
    const key = d.toISOString().slice(0, 10)
    return { nombre: key, n: eventos.filter(e => e.ocurrido_en.slice(0, 10) === key).length }
  })
  return <>
    <section className="metrics-grid">
      <Indicador titulo="Tamaño de muestra" valor={String(eventos.length)} nota="Mismos filtros de tabla y mapa" />
      <Indicador titulo="Magnitud promedio" valor={magnitudes.length ? (magnitudes.reduce((s, m) => s + m, 0) / magnitudes.length).toFixed(2) : '—'} nota="Media de magnitudes reportadas" />
      <Indicador titulo="Profundidad promedio" valor={profundidad === null ? '—' : `${profundidad.toFixed(1)} km`} nota="Según los registros seleccionados" />
      <Indicador titulo="Magnitud sin dato" valor={String(eventos.length - magnitudes.length)} nota="Excluida del promedio y distribución" />
    </section>
    <section className="section-grid">
      <article className="panel"><div className="panel-heading"><h3>Distribución por magnitud</h3></div><Barras datos={rangos} /></article>
      <article className="panel"><div className="panel-heading"><h3>Eventos por día · UTC</h3></div><Barras datos={dias} /></article>
    </section>
    <p className="subtitle">Análisis descriptivo de eventos observados. Los conteos dependen de la cobertura de USGS; no representan predicciones ni niveles oficiales de peligro.</p>
  </>
}

function Barras({ datos }: { datos: { nombre: string; n: number }[] }) {
  const maximo = Math.max(1, ...datos.map(d => d.n))
  return <div className="bar-chart" role="img" aria-label={datos.map(d => `${d.nombre}: ${d.n} eventos`).join('; ')}>
    {datos.map(d => <div className="bar-row" key={d.nombre}><span>{d.nombre}</span><div className="bar-track"><div style={{ width: `${d.n / maximo * 100}%` }} /></div><strong>{d.n}</strong></div>)}
    <p className="chart-note">Conteo de eventos · escala desde cero</p>
  </div>
}

function descargarCSV(eventos: EventoSismico[]) {
  const celda = (valor: unknown) => {
    let texto = String(valor ?? '')
    if (/^[=+\-@]/.test(texto)) texto = `'${texto}`
    return `"${texto.replace(/"/g, '""')}"`
  }
  const filas = [['id', 'id_externo', 'fecha_utc', 'magnitud', 'tipo_magnitud', 'lugar', 'profundidad_km', 'latitud', 'longitud', 'fuente_url'],
    ...eventos.map(e => [e.id, e.id_externo, e.ocurrido_en, e.magnitud, e.tipo_magnitud, e.lugar, e.profundidad, e.latitud, e.longitud, e.url_fuente])]
  const blob = new Blob(['\uFEFF' + filas.map(f => f.map(celda).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = `sismocore-eventos-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function App() {
  const [pagina, setPagina] = useState<Pagina>('dashboard')
  const [salud, setSalud] = useState<HealthResponse | null>(null)
  const [datos, setDatos] = useState<EventosResponse | null>(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [actualizando, setActualizando] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [magnitud, setMagnitud] = useState('todos')
  const [fechaDesde, setFechaDesde] = useState('')
  const enCurso = useRef(false)
  const cargar = useCallback(async () => {
    if (enCurso.current) return
    enCurso.current = true
    setActualizando(true)
    try {
      const [h, e] = await Promise.allSettled([verificarAPI(), obtenerEventos()])
      setSalud(h.status === 'fulfilled' ? h.value : null)
      if (e.status === 'fulfilled') {
        setDatos(e.value)
        setError(h.status === 'fulfilled' && h.value.base_datos !== 'conectada' ? h.value.mensaje : '')
      } else {
        setError(errorTexto(e.reason))
      }
    } finally {
      setCargando(false)
      setActualizando(false)
      enCurso.current = false
    }
  }, [])
  useEffect(() => {
    void Promise.resolve().then(cargar)
    const timer = window.setInterval(() => void cargar(), 30000)
    return () => window.clearInterval(timer)
  }, [cargar])
  const eventos = (datos?.eventos ?? []).filter(e => {
    const texto = `${e.lugar} ${e.id_externo} ${e.id}`.toLocaleLowerCase('es')
    return texto.includes(busqueda.trim().toLocaleLowerCase('es')) &&
      (!fechaDesde || e.ocurrido_en.slice(0, 10) >= fechaDesde) &&
      (magnitud === 'todos' || (e.magnitud !== null && (magnitud === 'menor' ? e.magnitud < 4 : magnitud === 'medio' ? e.magnitud >= 4 && e.magnitud < 6 : e.magnitud >= 6)))
  })
  const medidas = eventos.flatMap(e => e.magnitud === null ? [] : [e.magnitud])
  const maximo = medidas.length ? Math.max(...medidas).toFixed(1) : '—'
  const profundidad = eventos.length ? `${(eventos.reduce((s, e) => s + e.profundidad, 0) / eventos.length).toFixed(1)} km` : '—'
  const disponible = salud !== null
  const titulo = paginas.find(p => p.id === pagina)?.nombre ?? 'SISMOCORE'
  const filtrosVisibles = ['dashboard', 'eventos', 'mapa', 'analisis', 'reportes'].includes(pagina)
  function navegar(id: Pagina) { setPagina(id); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  return <div className="app">
    <header className="topbar">
      <button className="brand brand-button" onClick={() => navegar('dashboard')} aria-label="Ir al dashboard"><div className="brand-icon">S</div><div><h1>SISMO<span>CORE</span></h1><p>PLATAFORMA DE MONITOREO SÍSMICO</p></div></button>
      <div className="system-status" role="status"><span className="status-dot" style={{ backgroundColor: cargando ? '#f59e0b' : disponible ? '#22c55e' : '#ef4444' }} />{cargando ? 'Comprobando servicios…' : disponible ? salud.base_datos === 'conectada' ? 'API y Supabase conectados' : 'API disponible · revisar Supabase' : 'API no disponible'}</div>
    </header>
    <div className="layout">
      <aside className="sidebar"><p className="menu-label">MONITOREO Y GESTIÓN</p><nav aria-label="Navegación principal">{paginas.map(p => <button type="button" key={p.id} title={p.nombre} className={`nav-item ${pagina === p.id ? 'active' : ''}`} onClick={() => navegar(p.id)} aria-current={pagina === p.id ? 'page' : undefined}><span aria-hidden="true">{p.icono}</span>{p.nombre}{p.pendiente && <small className="nav-pending" title="Módulo pendiente de implementación">Próx.</small>}</button>)}</nav><div className="sidebar-footer"><span className="status-dot" /><div><strong>USGS → Supabase</strong><p>Eventos observados</p></div></div></aside>
      <main className="main-content">
        <div className="page-heading"><div><p className="eyebrow">CENTRO DE MONITOREO</p><h2>{titulo === 'Dashboard' ? 'Dashboard sísmico' : titulo}</h2><p className="subtitle">Eventos reales de USGS · catálogo persistente en Supabase</p></div><button className="action-button" onClick={() => void cargar()} disabled={actualizando}>{actualizando ? 'Consultando…' : 'Actualizar datos'}</button></div>
        <div className="data-context"><span>Últimos 7 días · magnitud de origen ≥ 2.5 · área alrededor del Perú</span><span>Última sincronización: {fecha(datos?.ultima_sincronizacion)} · hora de Perú</span></div>
        {error && <div className="service-message error-message" role="alert"><strong>No se pudo actualizar la información.</strong><p>{error}</p>{datos && <p>Se conserva la última consulta disponible; sus datos pueden estar desactualizados.</p>}<button className="action-button" onClick={() => void cargar()}>Reintentar conexión</button></div>}
        {filtrosVisibles && <div className="filter-bar shared-filters"><label>Buscar ubicación o ID<input className="filter-control" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Ej. Perú, costa, identificador" /></label><label>Magnitud<select className="filter-control" value={magnitud} onChange={e => setMagnitud(e.target.value)}><option value="todos">Todas</option><option value="menor">Menor de 4</option><option value="medio">4 a menos de 6</option><option value="mayor">6 o más</option></select></label><label>Desde · fecha UTC<input type="date" className="filter-control" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} /></label><button className="action-button" onClick={() => { setBusqueda(''); setMagnitud('todos'); setFechaDesde('') }}>Limpiar filtros</button></div>}
        {cargando ? <section className="panel empty-state" role="status"><h3>Consultando el catálogo…</h3><p>Comprobando API y base de datos.</p></section> : <>
          {datos && datos.total === 0 && <div className="service-message" role="status">{datos.sincronizacion === 'sincronizando' ? 'La primera sincronización está en curso. Esta pantalla se actualizará automáticamente.' : 'No hay eventos guardados dentro de los últimos siete días.'}{datos.ultima_ejecucion?.error_resumen && <p>{datos.ultima_ejecucion.error_resumen}</p>}</div>}
          {pagina === 'dashboard' && <>
            <section className="metrics-grid"><Indicador titulo="Eventos del filtro" valor={datos ? String(eventos.length) : '—'} nota="Observaciones guardadas" /><Indicador titulo="Magnitud máxima" valor={maximo} nota="Del mismo conjunto filtrado" /><Indicador titulo="Profundidad promedio" valor={profundidad} nota="Kilómetros reportados por USGS" /><Indicador titulo="Base de datos" valor={salud?.base_datos === 'conectada' ? 'Conectada' : 'Sin conexión'} nota="Supabase PostgreSQL" /></section>
            <section className="panel"><div className="panel-heading"><div><h3>Eventos más recientes</h3><p>Fecha local, magnitud y enlace de procedencia.</p></div><button className="action-button" onClick={() => navegar('eventos')}>Ver catálogo</button></div><Tabla eventos={eventos} compacta /></section>
            <section className="panel monitoring-panel"><div className="panel-heading"><h3>Ubicación de eventos observados</h3><span className="panel-tag">{eventos.length} EVENTOS</span></div>{eventos.length ? <MapaSismico eventos={eventos} /> : <p className="subtitle">El mapa mostrará los eventos cuando la sincronización termine o cambies los filtros.</p>}</section>
          </>}
          {pagina === 'eventos' && <section className="panel"><div className="panel-heading"><h3>Catálogo de eventos</h3><span className="panel-tag">{eventos.length} / {datos?.total ?? 0}</span></div><Tabla eventos={eventos} /></section>}
          {pagina === 'mapa' && <section className="panel"><div className="panel-heading"><h3>Mapa de epicentros</h3><span className="panel-tag">{eventos.length} EVENTOS</span></div>{eventos.length ? <MapaSismico eventos={eventos} /> : <div className="empty-state"><h4>Sin eventos para este filtro</h4><p>Comprueba los filtros y el estado de sincronización.</p></div>}</section>}
          {pagina === 'analisis' && datos && <Analisis eventos={eventos} corte={datos.consultado_en} />}
          {pagina === 'fuentes' && <>
            <section className="metrics-grid"><Indicador titulo="Fuente de observaciones" valor="USGS" nota="Earthquake Hazards Program" /><Indicador titulo="Registros en el periodo" valor={datos ? String(datos.total) : '—'} nota="Últimos siete días guardados" /><Indicador titulo="Sincronización" valor={datos?.sincronizacion ?? 'Sin conexión'} nota="Consulta automática cada cinco minutos" /><Indicador titulo="Últimos rechazos" valor={datos?.ultima_ejecucion ? String(datos.ultima_ejecucion.registros_rechazados) : '—'} nota="Registros inválidos descartados" /></section>
            <section className="panel"><div className="panel-heading"><h3>Estado del conector</h3></div><dl className="source-details"><dt>Base de datos</dt><dd>{salud?.base_datos === 'conectada' ? 'Supabase conectada' : 'No disponible'}</dd><dt>Último éxito</dt><dd>{fecha(datos?.ultima_sincronizacion)}</dd><dt>Última ejecución</dt><dd>{datos?.ultima_ejecucion?.estado ?? 'Sin ejecuciones'}</dd><dt>Registros recibidos</dt><dd>{datos?.ultima_ejecucion?.registros_recibidos ?? '—'}</dd><dt>Insertados / actualizados</dt><dd>{datos?.ultima_ejecucion ? `${datos.ultima_ejecucion.registros_insertados} / ${datos.ultima_ejecucion.registros_actualizados}` : '—'}</dd></dl><p className="subtitle">Cobertura rectangular alrededor del Perú; no equivale a todos los registros de IGP ni a una delimitación administrativa. <a href="https://earthquake.usgs.gov/earthquakes/" target="_blank" rel="noreferrer">Consultar USGS ↗</a></p>{datos?.ultima_ejecucion?.error_resumen && <p role="alert">{datos.ultima_ejecucion.error_resumen}</p>}</section>
          </>}
          {pagina === 'reportes' && <section className="panel"><div className="panel-heading"><h3>Exportación de eventos</h3><span className="panel-tag">CSV</span></div><p className="subtitle">Descarga las {eventos.length} observaciones de los filtros actuales. Incluye fecha UTC, identificadores, ubicación, magnitud, profundidad y URL original.</p><button className="action-button export-button" disabled={!eventos.length} onClick={() => descargarCSV(eventos)}>Descargar eventos CSV</button><p className="chart-note">Los reportes empresariales PDF/XLSX con historial y solicitante requieren el módulo de identidad y reportes.</p></section>}
          {['modelos', 'alertas', 'usuarios', 'auditoria'].includes(pagina) && <section className="panel empty-state"><span className="panel-tag">PENDIENTE DE IMPLEMENTACIÓN</span><h3>{titulo}</h3><p>{pagina === 'modelos' ? 'El monitoreo ya está conectado. Todavía no hay entrenamiento, evaluación ni modelos de ML implementados.' : pagina === 'alertas' ? 'Todavía no está implementado el motor de reglas ni el envío de notificaciones. No se están emitiendo alertas.' : 'Este módulo requiere autenticación y permisos antes de consultar o modificar información administrativa.'}</p><button className="action-button" onClick={() => navegar('dashboard')}>Volver al monitoreo</button></section>}
        </>}
        <footer className="page-footer"><span>SISMOCORE · eventos observados</span><span>Fuente: USGS · almacenamiento: Supabase · consulta automática cada 30 s</span></footer>
      </main>
    </div>
  </div>
}

export default App
