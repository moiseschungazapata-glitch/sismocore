import { useCallback, useEffect, useState } from 'react'

import './App.css'

import {

  obtenerEventos,

  verificarAPI,

  type EventoSismico,

} from './services/api'

import MapaSismico from './components/MapaSismico'

type EstadoAPI = 'comprobando' | 'conectada' | 'desconectada'



type Pagina =

  | 'dashboard'

  | 'eventos'

  | 'mapa'

  | 'analisis'

  | 'modelos'

  | 'alertas'

  | 'reportes'

  | 'usuarios'

  | 'fuentes'

  | 'auditoria'



const navegacionPrincipal: { id: Pagina; icono: string; nombre: string }[] = [

  { id: 'dashboard', icono: '▦', nombre: 'Dashboard' },

  { id: 'eventos', icono: '◉', nombre: 'Eventos sísmicos' },

  { id: 'mapa', icono: '⌖', nombre: 'Mapa sísmico' },

  { id: 'analisis', icono: '▥', nombre: 'Análisis' },

  { id: 'modelos', icono: '⌁', nombre: 'Modelos de IA' },

]



const navegacionGestion: { id: Pagina; icono: string; nombre: string }[] = [

  { id: 'alertas', icono: '♧', nombre: 'Alertas' },

  { id: 'reportes', icono: '▤', nombre: 'Reportes' },

  { id: 'usuarios', icono: '♙', nombre: 'Usuarios y roles' },

  { id: 'fuentes', icono: '▧', nombre: 'Fuentes de datos' },

  { id: 'auditoria', icono: '◷', nombre: 'Auditoría' },

]



const informacionPaginas: Record<

  Exclude<Pagina, 'dashboard'>,

  { titulo: string; descripcion: string; etiqueta: string }

> = {

  eventos: {

    titulo: 'Eventos sísmicos',

    descripcion: 'Consulta y seguimiento de eventos sísmicos registrados.',

    etiqueta: 'MONITOREO',

  },

  mapa: {

    titulo: 'Mapa sísmico',

    descripcion: 'Visualización geográfica de la actividad sísmica.',

    etiqueta: 'GEOGRAFÍA',

  },

  analisis: {

    titulo: 'Análisis sísmico',

    descripcion: 'Herramientas para explorar patrones y estadísticas.',

    etiqueta: 'ANÁLISIS',

  },

  modelos: {

    titulo: 'Modelos de inteligencia artificial',

    descripcion: 'Supervisión de modelos y resultados analíticos.',

    etiqueta: 'INTELIGENCIA ARTIFICIAL',

  },

  alertas: {

    titulo: 'Centro de alertas',

    descripcion: 'Consulta y gestión de las notificaciones del sistema.',

    etiqueta: 'NOTIFICACIONES',

  },

  reportes: {

    titulo: 'Reportes',

    descripcion: 'Consulta y preparación de informes del sistema.',

    etiqueta: 'INFORMES',

  },

  usuarios: {

    titulo: 'Usuarios y roles',

    descripcion: 'Administración de accesos y permisos de la plataforma.',

    etiqueta: 'ADMINISTRACIÓN',

  },

  fuentes: {

    titulo: 'Fuentes de datos',

    descripcion: 'Configuración y supervisión de las fuentes de información.',

    etiqueta: 'INTEGRACIONES',

  },

  auditoria: {

    titulo: 'Auditoría del sistema',

    descripcion: 'Seguimiento de las operaciones y actividades registradas.',

    etiqueta: 'SEGURIDAD',

  },

}



function App() {

  const [estadoAPI, setEstadoAPI] = useState<EstadoAPI>('comprobando')

  const [pagina, setPagina] = useState<Pagina>('dashboard')



  const comprobarAPI = useCallback(async () => {

    setEstadoAPI('comprobando')

    try {

      await verificarAPI()

      setEstadoAPI('conectada')

    } catch {

      setEstadoAPI('desconectada')

    }

  }, [])



  useEffect(() => {

    void comprobarAPI()

  }, [comprobarAPI])



  function cambiarPagina(nuevaPagina: Pagina) {

    setPagina(nuevaPagina)

    window.scrollTo({ top: 0, behavior: 'smooth' })

  }



  return (

    <div className="app">

      <header className="topbar">

        <button

          className="brand brand-button"

          onClick={() => cambiarPagina('dashboard')}

          aria-label="Ir al dashboard principal"

          type="button"

        >

          <div className="brand-icon">S</div>

          <div>

            <h1>

              SISMO<span>CORE</span>

            </h1>

            <p>PLATAFORMA DE MONITOREO SÍSMICO</p>

          </div>

        </button>



        <div className="system-status">

          <span

            className="status-dot"

            style={{

              backgroundColor:

                estadoAPI === 'conectada'

                  ? '#22c55e'

                  : estadoAPI === 'desconectada'

                    ? '#ef4444'

                    : '#f59e0b',

            }}

          />

          {estadoAPI === 'comprobando'

            ? 'Conectando con la API...'

            : estadoAPI === 'conectada'

              ? 'API conectada'

              : 'API desconectada'}

        </div>

      </header>



      <div className="layout">

        <aside className="sidebar">

          <p className="menu-label">PRINCIPAL</p>

          <nav aria-label="Navegación principal">

            {navegacionPrincipal.map((item) => (

              <button

                key={item.id}

                type="button"

                className={`nav-item ${pagina === item.id ? 'active' : ''}`}

                onClick={() => cambiarPagina(item.id)}

                aria-current={pagina === item.id ? 'page' : undefined}

                title={item.nombre}

              >

                <span>{item.icono}</span>

                {item.nombre}

              </button>

            ))}

          </nav>



          <p className="menu-label secondary-label">GESTIÓN</p>

          <nav aria-label="Gestión del sistema">

            {navegacionGestion.map((item) => (

              <button

                key={item.id}

                type="button"

                className={`nav-item ${pagina === item.id ? 'active' : ''}`}

                onClick={() => cambiarPagina(item.id)}

                aria-current={pagina === item.id ? 'page' : undefined}

                title={item.nombre}

              >

                <span>{item.icono}</span>

                {item.nombre}

              </button>

            ))}

          </nav>



          <div className="sidebar-footer">

            <span

              className="status-dot"

              style={{

                backgroundColor:

                  estadoAPI === 'conectada'

                    ? '#22c55e'

                    : estadoAPI === 'desconectada'

                      ? '#ef4444'

                      : '#f59e0b',

              }}

            />

            <div>

              <strong>Infraestructura</strong>

              <p>

                {estadoAPI === 'conectada'

                  ? 'API disponible'

                  : estadoAPI === 'desconectada'

                    ? 'API no disponible'

                    : 'Verificando servicios'}

              </p>

            </div>

          </div>

        </aside>



        <main className="main-content" key={pagina}>

          {pagina === 'dashboard' ? (

            <Dashboard

              estadoAPI={estadoAPI}

              alReintentar={comprobarAPI}

              alNavegar={cambiarPagina}

            />

          ) : (

            <PantallaModulo pagina={pagina} alNavegar={cambiarPagina} />

          )}

        </main>

      </div>

    </div>

  )

}



function Dashboard({

  estadoAPI,

  alReintentar,

  alNavegar,

}: {

  estadoAPI: EstadoAPI

  alReintentar: () => void

  alNavegar: (pagina: Pagina) => void

}) {

  return (

    <>

      <div className="page-heading">

        <div>

          <p className="eyebrow">CENTRO DE OPERACIONES</p>

          <h2>Dashboard sísmico</h2>

          <p className="subtitle">

            Vista general de la actividad sísmica del sistema.

          </p>

        </div>

        <div className="date-label">

          <span>●</span> Entorno de demostración

        </div>

      </div>



      <section className="metrics-grid">

        <TarjetaIndicador titulo="Eventos registrados" valor="—" nota="Fuente de datos pendiente" />

        <TarjetaIndicador titulo="Magnitud máxima" valor="—" nota="Sin mediciones disponibles" />

        <TarjetaIndicador titulo="Estaciones sísmicas" valor="—" nota="Integración pendiente" />

        <TarjetaIndicador titulo="Alertas activas" valor="—" nota="Módulo de alertas pendiente" />

      </section>



      <section className="content-grid">

        <article className="panel activity-panel">

          <div className="panel-heading">

            <div>

              <h3>Actividad sísmica</h3>

              <p>Resumen de eventos y monitoreo</p>

            </div>

            <span className="panel-tag">EN ESPERA</span>

          </div>

          <div className="empty-state">

            <div className="wave-icon">〰</div>

            <h4>Centro de monitoreo</h4>

            <p>

              Aquí visualizaremos los eventos sísmicos, las magnitudes y su

              evolución cuando conectemos la fuente de datos.

            </p>

            <button className="action-button" onClick={() => alNavegar('eventos')}>

              Explorar eventos

            </button>

          </div>

        </article>



        <article className="panel status-panel">

          <div className="panel-heading">

            <div>

              <h3>Estado de servicios</h3>

              <p>Componentes de la plataforma</p>

            </div>

          </div>

          <FilaServicio titulo="Frontend" descripcion="Interfaz web" estado="Activo" correcto />

          <FilaServicio

            titulo="API sísmica"

            descripcion={

              estadoAPI === 'conectada'

                ? 'Backend respondiendo'

                : estadoAPI === 'desconectada'

                  ? 'No se pudo conectar'

                  : 'Comprobando conexión'

            }

            estado={

              estadoAPI === 'conectada'

                ? 'Conectado'

                : estadoAPI === 'desconectada'

                  ? 'Desconectado'

                  : 'Verificando'

            }

            correcto={estadoAPI === 'conectada'}

          />

          <FilaServicio titulo="Base de datos" descripcion="Configuración pendiente" estado="Pendiente" />

          <FilaServicio titulo="Modelos de IA" descripcion="Integración pendiente" estado="Pendiente" />

          <button

            className="action-button full-width-button"

            onClick={alReintentar}

            disabled={estadoAPI === 'comprobando'}

          >

            {estadoAPI === 'comprobando'

              ? 'Comprobando conexión...'

              : 'Volver a comprobar API'}

          </button>

        </article>

      </section>



      <section className="dashboard-section">

        <div className="section-heading">

          <div>

            <p className="eyebrow">ACCESO RÁPIDO</p>

            <h3>Módulos del sistema</h3>

          </div>

        </div>

        <section className="section-grid">

          <TarjetaModulo icono="◉" titulo="Eventos sísmicos" descripcion="Consulta y seguimiento de eventos." onClick={() => alNavegar('eventos')} />

          <TarjetaModulo icono="⌖" titulo="Mapa sísmico" descripcion="Visualización geográfica." onClick={() => alNavegar('mapa')} />

          <TarjetaModulo icono="▥" titulo="Análisis" descripcion="Explora estadísticas y patrones." onClick={() => alNavegar('analisis')} />

          <TarjetaModulo icono="⌁" titulo="Modelos de IA" descripcion="Consulta el área de modelos." onClick={() => alNavegar('modelos')} />

        </section>

      </section>

      <PiePagina />

    </>

  )

}



function PantallaModulo({

  pagina,

  alNavegar,

}: {

  pagina: Exclude<Pagina, 'dashboard'>

  alNavegar: (pagina: Pagina) => void

}) {

  const informacion = informacionPaginas[pagina]



  return (

    <>

      <div className="page-heading">

        <div>

          <p className="eyebrow">{informacion.etiqueta}</p>

          <h2>{informacion.titulo}</h2>

          <p className="subtitle">{informacion.descripcion}</p>

        </div>

        <div className="date-label">

          <span>●</span> Entorno de demostración

        </div>

      </div>



      {pagina === 'eventos' && <ContenidoEventos />}

      {pagina === 'mapa' && <ContenidoMapa />}

      {pagina === 'analisis' && <ContenidoAnalisis />}

      {pagina === 'modelos' && <ContenidoModelos />}

      {pagina === 'alertas' && <ContenidoAlertas />}

      {pagina === 'reportes' && <ContenidoReportes />}

      {pagina === 'usuarios' && <ContenidoUsuarios />}

      {pagina === 'fuentes' && <ContenidoFuentes />}

      {pagina === 'auditoria' && <ContenidoAuditoria />}



      <div className="back-navigation">

        <button className="action-button" onClick={() => alNavegar('dashboard')}>

          ← Volver al dashboard

        </button>

      </div>

      <PiePagina />

    </>

  )

}



function TarjetaIndicador({

  titulo,

  valor,

  nota,

}: {

  titulo: string

  valor: string

  nota: string

}) {

  return (

    <article className="metric-card">

      <p>{titulo}</p>

      <div className="metric-value">{valor}</div>

      <span className="metric-note">{nota}</span>

    </article>

  )

}



function FilaServicio({

  titulo,

  descripcion,

  estado,

  correcto = false,

}: {

  titulo: string

  descripcion: string

  estado: string

  correcto?: boolean

}) {

  return (

    <div className="service-row">

      <div>

        <strong>{titulo}</strong>

        <p>{descripcion}</p>

      </div>

      <span className={correcto ? 'service-badge' : 'pending-badge'}>{estado}</span>

    </div>

  )

}



function TarjetaModulo({

  icono,

  titulo,

  descripcion,

  onClick,

}: {

  icono: string

  titulo: string

  descripcion: string

  onClick: () => void

}) {

  return (

    <button className="module-card" onClick={onClick}>

      <span className="module-icon">{icono}</span>

      <span className="module-card-title">{titulo}</span>

      <span className="module-card-description">{descripcion}</span>

      <span className="module-card-link">Abrir módulo →</span>

    </button>

  )

}



function PanelVacio({

  icono,

  titulo,

  descripcion,

}: {

  icono: string

  titulo: string

  descripcion: string

}) {

  return (

    <article className="panel">

      <div className="empty-state">

        <div className="wave-icon">{icono}</div>

        <h4>{titulo}</h4>

        <p>{descripcion}</p>

      </div>

    </article>

  )

}



function ContenidoEventos() {

  const [busqueda, setBusqueda] = useState('')

  const [filtro, setFiltro] = useState('todos')

  const [eventos, setEventos] = useState<EventoSismico[]>([])

  const [cargando, setCargando] = useState(true)

  const [error, setError] = useState('')



  const cargarEventos = useCallback(async () => {

    setCargando(true)

    setError('')

    try {

      const respuesta = await obtenerEventos()

      setEventos(respuesta.eventos)

    } catch {

      setError('No se pudieron cargar los eventos. Verifica que el backend esté activo.')

    } finally {

      setCargando(false)

    }

  }, [])



  useEffect(() => {

    void cargarEventos()

  }, [cargarEventos])



  const eventosFiltrados = eventos.filter((evento) => {

    const texto = busqueda.toLowerCase()

    const coincideBusqueda =

      (evento.lugar ?? '').toLowerCase().includes(texto) ||

      evento.id.toLowerCase().includes(texto)



    const magnitud = evento.magnitud

    const coincideFiltro =

      filtro === 'todos' ||

      (magnitud !== null &&

        (filtro === 'leve'

          ? magnitud < 4

          : filtro === 'moderado'

            ? magnitud >= 4 && magnitud < 6

            : magnitud >= 6))



    return coincideBusqueda && coincideFiltro

  })



  const magnitudes = eventos

    .map((evento) => evento.magnitud)

    .filter((magnitud): magnitud is number => magnitud !== null)



  const promedio =

    magnitudes.length > 0

      ? (

          magnitudes.reduce((suma, magnitud) => suma + magnitud, 0) /

          magnitudes.length

        ).toFixed(1)

      : '—'



  const magnitudMaxima =

    magnitudes.length > 0 ? Math.max(...magnitudes).toFixed(1) : '—'



  return (

    <>

      <section className="metrics-grid">

        <TarjetaIndicador

          titulo="Eventos encontrados"

          valor={cargando ? '…' : String(eventosFiltrados.length)}

          nota="Según búsqueda y filtro"

        />

        <TarjetaIndicador

          titulo="Magnitud promedio"

          valor={cargando ? '…' : promedio}

          nota="De los eventos recibidos"

        />

        <TarjetaIndicador

          titulo="Magnitud máxima"

          valor={cargando ? '…' : magnitudMaxima}

          nota="Mayor magnitud registrada"

        />

        <TarjetaIndicador titulo="Fuente" valor="API" nota="Backend SISMOCORE" />

      </section>



      <article className="panel">

        <div className="panel-heading">

          <div>

            <h3>Registro de eventos</h3>

            <p>Busca y filtra los eventos sísmicos recibidos.</p>

          </div>

          <span className="panel-tag">

            {cargando ? 'CARGANDO' : error ? 'ERROR' : `${eventos.length} REGISTROS`}

          </span>

        </div>



        <div className="filter-bar">

          <input

            className="filter-control"

            value={busqueda}

            onChange={(event) => setBusqueda(event.target.value)}

            placeholder="Buscar por ubicación o identificador..."

            aria-label="Buscar eventos"

          />

          <select

            className="filter-control"

            value={filtro}

            onChange={(event) => setFiltro(event.target.value)}

            aria-label="Filtrar por magnitud"

          >

            <option value="todos">Todas las magnitudes</option>

            <option value="leve">Menor de 4.0</option>

            <option value="moderado">De 4.0 a 5.9</option>

            <option value="alto">6.0 o más</option>

          </select>

        </div>



        {cargando ? (

          <div className="empty-state">

            <h4>Cargando eventos sísmicos...</h4>

            <p>Consultando el backend de SISMOCORE.</p>

          </div>

        ) : error ? (

          <div className="empty-state">

            <h4>No se pudo conectar</h4>

            <p>{error}</p>

            <button className="action-button" onClick={() => void cargarEventos()}>

              Volver a intentar

            </button>

          </div>

        ) : eventosFiltrados.length === 0 ? (

          <div className="empty-state">

            <h4>No hay eventos para mostrar</h4>

            <p>Prueba con otra búsqueda o cambia el filtro de magnitud.</p>

          </div>

        ) : (

          <div style={{ overflowX: 'auto', marginTop: '20px' }}>

            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>

              <thead>

                <tr>

                  {['ID', 'Magnitud', 'Ubicación', 'Profundidad', 'Latitud', 'Longitud'].map(

                    (titulo) => (

                      <th

                        key={titulo}

                        style={{

                          padding: '14px 12px',

                          borderBottom: '1px solid #334155',

                          color: '#94a3b8',

                          fontSize: '12px',

                        }}

                      >

                        {titulo}

                      </th>

                    ),

                  )}

                </tr>

              </thead>

              <tbody>

                {eventosFiltrados.map((evento) => (

                  <tr key={evento.id}>

                    <td style={{ padding: '14px 12px', borderBottom: '1px solid #263449' }}>

                      {evento.id}

                    </td>

                    <td

                      style={{

                        padding: '14px 12px',

                        borderBottom: '1px solid #263449',

                        fontWeight: 700,

                      }}

                    >

                      {evento.magnitud === null ? 'No disponible' : evento.magnitud.toFixed(1)}

                    </td>

                    <td style={{ padding: '14px 12px', borderBottom: '1px solid #263449' }}>

                      {evento.lugar}

                    </td>

                    <td style={{ padding: '14px 12px', borderBottom: '1px solid #263449' }}>

                      {evento.profundidad} km

                    </td>

                    <td style={{ padding: '14px 12px', borderBottom: '1px solid #263449' }}>

                      {evento.latitud.toFixed(4)}

                    </td>

                    <td style={{ padding: '14px 12px', borderBottom: '1px solid #263449' }}>

                      {evento.longitud.toFixed(4)}

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        )}

      </article>

    </>

  )

}



function ContenidoMapa() {
  const [eventos, setEventos] = useState<EventoSismico[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const cargarEventos = useCallback(async () => {
    setCargando(true)
    setError('')

    try {
      const respuesta = await obtenerEventos()
      setEventos(respuesta.eventos)
    } catch {
      setError(
        'No se pudieron cargar los eventos sísmicos. Verifica que el backend esté activo e inténtalo nuevamente.',
      )
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargarEventos()
  }, [cargarEventos])

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>Área geográfica de monitoreo</h3>
          <p>
            Ubicación de los eventos sísmicos recibidos desde la fuente USGS.
          </p>
        </div>
        <span className="panel-tag">
          {cargando ? 'CARGANDO' : error ? 'ERROR' : `${eventos.length} EVENTOS`}
        </span>
      </div>

      {cargando ? (
        <div className="empty-state">
          <h4>Cargando mapa sísmico...</h4>
          <p>Consultando los eventos del backend de SISMOCORE.</p>
        </div>
      ) : error ? (
        <div className="empty-state">
          <h4>No se pudo cargar el mapa</h4>
          <p>{error}</p>
          <button
            className="action-button"
            type="button"
            onClick={() => void cargarEventos()}
          >
            Volver a intentar
          </button>
        </div>
      ) : eventos.length === 0 ? (
        <div className="empty-state">
          <h4>No hay eventos sísmicos para mostrar</h4>
          <p>La fuente no devolvió eventos para el periodo consultado.</p>
          <button
            className="action-button"
            type="button"
            onClick={() => void cargarEventos()}
          >
            Actualizar eventos
          </button>
        </div>
      ) : (
        <>
          <MapaSismico eventos={eventos} />

          <div className="section-grid map-details">
            <TarjetaModulo
              icono="◎"
              titulo="Epicentros"
              descripcion={`${eventos.length} eventos recibidos con coordenadas geográficas.`}
              onClick={() => {}}
            />
            <TarjetaModulo
              icono="⌖"
              titulo="Fuente de datos"
              descripcion="Eventos sísmicos consultados desde USGS."
              onClick={() => {}}
            />
          </div>

          <p className="subtitle" style={{ marginTop: '16px' }}>
            Selecciona un marcador para consultar la magnitud, ubicación,
            profundidad y coordenadas del evento.
          </p>
        </>
      )}
    </section>
  )
}

function ContenidoAnalisis() {

  return (

    <section className="section-grid">

      <PanelVacio icono="▥" titulo="Distribución de magnitudes" descripcion="El gráfico se generará cuando existan registros sísmicos disponibles." />

      <PanelVacio icono="⌁" titulo="Evolución temporal" descripcion="Aquí analizaremos la frecuencia de eventos a lo largo del tiempo." />

      <PanelVacio icono="◷" titulo="Estadísticas descriptivas" descripcion="Promedios, máximos y distribución calculados a partir de datos reales." />

      <PanelVacio icono="⌖" titulo="Distribución geográfica" descripcion="Análisis por región cuando la fuente proporcione coordenadas." />

    </section>

  )

}



function ContenidoModelos() {

  return (

    <>

      <section className="metrics-grid">

        <TarjetaIndicador titulo="Modelos registrados" valor="—" nota="Sin modelos integrados" />

        <TarjetaIndicador titulo="Estado de entrenamiento" valor="—" nota="No iniciado" />

        <TarjetaIndicador titulo="Última evaluación" valor="—" nota="Sin evaluaciones" />

        <TarjetaIndicador titulo="Versión activa" valor="—" nota="Sin versión desplegada" />

      </section>

      <PanelVacio

        icono="⌁"

        titulo="Centro de inteligencia artificial"

        descripcion="Este espacio permitirá consultar modelos, métricas y resultados. No hay predicciones disponibles porque todavía no se ha integrado un modelo."

      />

    </>

  )

}



function ContenidoAlertas() {

  const [filtro, setFiltro] = useState('todas')

  return (

    <article className="panel">

      <div className="panel-heading">

        <div>

          <h3>Notificaciones del sistema</h3>

          <p>Consulta las alertas registradas.</p>

        </div>

        <span className="pending-badge">Sin datos</span>

      </div>

      <div className="filter-bar">

        <select className="filter-control" value={filtro} onChange={(event) => setFiltro(event.target.value)} aria-label="Filtrar alertas">

          <option value="todas">Todas las alertas</option>

          <option value="activas">Activas</option>

          <option value="resueltas">Resueltas</option>

        </select>

      </div>

      <PanelVacio

        icono="♧"

        titulo="No hay alertas registradas"

        descripcion={`Filtro seleccionado: ${filtro}. Las alertas reales estarán disponibles al implementar las reglas de detección y su fuente de datos.`}

      />

    </article>

  )

}



function ContenidoReportes() {

  const [tipo, setTipo] = useState('actividad')

  return (

    <article className="panel">

      <div className="panel-heading">

        <div>

          <h3>Generador de reportes</h3>

          <p>Selecciona el tipo de informe que deseas preparar.</p>

        </div>

        <span className="panel-tag">PREPARACIÓN</span>

      </div>

      <div className="filter-bar">

        <select className="filter-control" value={tipo} onChange={(event) => setTipo(event.target.value)} aria-label="Tipo de reporte">

          <option value="actividad">Actividad sísmica</option>

          <option value="alertas">Resumen de alertas</option>

          <option value="estaciones">Estado de estaciones</option>

        </select>

      </div>

      <div className="empty-state">

        <div className="wave-icon">▤</div>

        <h4>Informe listo para configurar</h4>

        <p>

          Tipo seleccionado: {tipo}. La generación y exportación se implementarán cuando estén

          disponibles los datos.

        </p>

      </div>

    </article>

  )

}



function ContenidoUsuarios() {

  return (

    <section className="section-grid">

      <PanelVacio icono="♙" titulo="Usuarios" descripcion="El listado de cuentas aparecerá cuando se integre la autenticación y la base de datos." />

      <PanelVacio icono="♧" titulo="Roles y permisos" descripcion="Aquí se configurarán los permisos de cada tipo de usuario." />

    </section>

  )

}



function ContenidoFuentes() {

  return (

    <>

      <section className="metrics-grid">

        <TarjetaIndicador titulo="Fuentes configuradas" valor="0" nota="Ninguna registrada" />

        <TarjetaIndicador titulo="Fuentes disponibles" valor="—" nota="Verificación pendiente" />

        <TarjetaIndicador titulo="Última sincronización" valor="—" nota="Sin sincronizaciones" />

        <TarjetaIndicador titulo="Estado de ingesta" valor="Inactivo" nota="Sin procesos de ingesta" />

      </section>

      <PanelVacio

        icono="▧"

        titulo="Configuración de fuentes"

        descripcion="Aquí conectaremos las fuentes sísmicas y supervisaremos la recepción de datos."

      />

    </>

  )

}



function ContenidoAuditoria() {

  return (

    <article className="panel">

      <div className="panel-heading">

        <div>

          <h3>Registro de actividad</h3>

          <p>Operaciones registradas dentro de la plataforma.</p>

        </div>

        <span className="panel-tag">AUDITORÍA</span>

      </div>

      <div className="empty-state">

        <div className="wave-icon">◷</div>

        <h4>Sin registros de auditoría</h4>

        <p>

          El historial aparecerá cuando implementemos el registro de acciones de los usuarios y

          servicios.

        </p>

      </div>

    </article>

  )

}



function PiePagina() {

  return (

    <footer className="page-footer">

      <span>SISMOCORE · Plataforma de monitoreo sísmico</span>

      <span>Datos reales pendientes de integración</span>

    </footer>

  )

}



export default App
