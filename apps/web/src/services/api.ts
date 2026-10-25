import { clearPrivateCache, privateCacheGeneration } from './auth'

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export interface HealthResponse {
  estado: string
  servicio: string
  base_datos: 'conectada' | 'desconectada'
  configurada: boolean
  sincronizacion: string
  mensaje: string
}

export interface EventoSismico {
  id: string
  id_externo: string
  magnitud: number | null
  region?: string | null
  recibido_en?: string
  hash_origen?: string
  tipo_magnitud: string | null
  lugar: string
  latitud: number
  longitud: number
  profundidad: number
  ocurrido_en: string
  url_fuente: string
  estado_revision: string
}

export interface EjecucionIngesta {
  estado: string
  iniciado_en: string
  finalizado_en: string | null
  registros_recibidos: number
  registros_insertados: number
  registros_actualizados: number
  registros_sin_cambios?: number
  registros_rechazados: number
  error_resumen: string | null
}

export interface EventosResponse {
  total: number
  alertas_activas?: number
  eventos: EventoSismico[]
  fuente: string
  almacenamiento: string
  periodo_dias: number
  codigo_fuente: string
  frecuencia_segundos: number
  url_fuente: string
  consultado_en: string
  ultima_sincronizacion: string | null
  sincronizacion: string
  ultima_ejecucion: EjecucionIngesta | null
  mensaje: string
}

const CACHE_KEY = 'sismocore.catalogo.igp.v3'

export function recuperarCatalogo(): EventosResponse | null {
  try {
    const snapshot = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null')
    if (!snapshot || snapshot.codigo_fuente !== 'igp' || !Number.isInteger(snapshot.periodo_dias) || snapshot.periodo_dias < 1 || snapshot.periodo_dias > 365 || !Array.isArray(snapshot.eventos) ||
      !Number.isFinite(Date.parse(snapshot.consultado_en)) ||
      Date.now() - Date.parse(snapshot.consultado_en) > 86400000) return null
    const limite = Date.now() - snapshot.periodo_dias * 86400000
    const eventos = snapshot.eventos.filter((evento: EventoSismico) =>
      typeof evento.id === 'string' && typeof evento.lugar === 'string' &&
      Number.isFinite(evento.latitud) && Number.isFinite(evento.longitud) &&
      Number.isFinite(evento.profundidad) &&
      (evento.magnitud === null || Number.isFinite(evento.magnitud)) &&
      Date.parse(evento.ocurrido_en) >= limite)
    return { ...snapshot, eventos, total: eventos.length }
  } catch { return null }
}

async function request<T>(path: string): Promise<T> {
  try {
    const response = await fetch(`${API_URL}${path}`, { signal: AbortSignal.timeout(20000), credentials: 'include' })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        clearPrivateCache()
        window.dispatchEvent(new Event('sismocore:session-ended'))
        throw new Error('Tu sesión ha terminado o ya no tiene acceso. Vuelve a iniciar sesión.')
      }
      let message = response.status === 502 || response.status === 504
        ? 'La API local se está recuperando. La conexión se reintentará automáticamente.'
        : `El servicio devolvió un error (${response.status}).`
      try {
        const body = await response.json()
        if (typeof body.detail === 'string') message = body.detail
      } catch { /* A development proxy can return a plain text 502. */ }
      throw new Error(message)
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('La consulta recibió una página web en lugar de datos. Revisa las rutas de la API en el despliegue.')
    }
    return await response.json() as T
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')) {
      throw new Error('No se pudo contactar con la API. Inicia el proyecto con Iniciar SISMOCORE.cmd o npm run dev desde la carpeta principal.', { cause: error })
    }
    throw error
  }
}

export const verificarAPI = () => request<HealthResponse>('/health')
export async function obtenerEventos(): Promise<EventosResponse> {
  const generation = privateCacheGeneration()
  const datos = await request<EventosResponse>('/api/v1/eventos')
  // A response started before logout must never restore the cleared private cache.
  if (generation === privateCacheGeneration()) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(datos)) } catch { /* Storage can be disabled or full. */ }
  }
  return datos
}
