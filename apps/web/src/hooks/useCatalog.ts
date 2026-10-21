import type { IconName } from '../components/Icon'
import { useCallback, useEffect, useRef, useState } from 'react'
import { obtenerEventos, recuperarCatalogo, verificarAPI, type EventosResponse, type HealthResponse } from '../services/api'

export function useCatalog() {
  const [salud, setSalud] = useState<HealthResponse | null>(null)
  const [datos, setDatos] = useState<EventosResponse | null>(recuperarCatalogo)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)
  const [actualizando, setActualizando] = useState(false)
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
        setError(h.status === 'fulfilled'
          ? h.value.base_datos !== 'conectada' ? h.value.mensaje : ''
          : 'El catálogo se recuperó, pero no se pudo comprobar el estado del servicio.')
      } else {
        setError(e.reason instanceof Error ? e.reason.message : 'No se pudo completar la consulta.')
      }
    } finally {
      setCargando(false)
      setActualizando(false)
      enCurso.current = false
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(cargar)
    const reconectar = () => { if (document.visibilityState === 'visible') void cargar() }
    window.addEventListener('online', reconectar)
    document.addEventListener('visibilitychange', reconectar)
    return () => {
      window.removeEventListener('online', reconectar)
      document.removeEventListener('visibilitychange', reconectar)
    }
  }, [cargar])
  useEffect(() => {
    const timer = window.setInterval(() => void cargar(), error ? 5000 : 30000)
    return () => window.clearInterval(timer)
  }, [cargar, error])

  const connection: { tone: string; label: string; short: string; icon: IconName } = cargando
    ? { tone: 'warning', label: 'Comprobando servicios…', short: 'Conectando', icon: 'clock' }
    : salud?.base_datos === 'conectada'
      ? { tone: 'success', label: 'API y Supabase conectados', short: 'Conectado', icon: 'check' }
      : salud
        ? { tone: 'warning', label: 'API disponible · revisar Supabase', short: 'Revisar conexión', icon: 'info' }
        : datos
          ? { tone: 'warning', label: 'Reconectando con la API…', short: 'Reconectando', icon: 'refresh' }
          : { tone: 'danger', label: 'API no disponible', short: 'Sin conexión', icon: 'alert' }

  return { salud, datos, error, cargando, actualizando, cargar, connection }
}
