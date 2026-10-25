import { useSyncExternalStore } from 'react'
import type { IconName } from '../components/Icon'

export const pages = [
  { id: 'dashboard', permission: 'catalogo.leer', path: '/', title: 'Dashboard', heading: 'Dashboard sísmico', description: 'Una vista clara de la actividad sísmica observada.', icon: 'dashboard', group: 'Monitoreo' },
  { id: 'eventos', permission: 'catalogo.leer', path: '/eventos', title: 'Eventos sísmicos', heading: 'Eventos sísmicos', description: 'Consulta las observaciones y verifica su procedencia.', icon: 'event', group: 'Monitoreo' },
  { id: 'mapa', permission: 'catalogo.leer', path: '/mapa', title: 'Mapa sísmico', heading: 'Mapa sísmico', description: 'Explora dónde ocurrieron los eventos del catálogo.', icon: 'map', group: 'Monitoreo' },
  { id: 'analisis', permission: 'catalogo.leer', path: '/analisis', title: 'Análisis', heading: 'Análisis descriptivo', description: 'Explora la distribución de los datos observados.', icon: 'chart', group: 'Monitoreo' },
  { id: 'fuentes', permission: 'fuentes.leer', path: '/fuentes', title: 'Fuentes de datos', heading: 'Fuentes de datos', description: 'Conoce la procedencia y actualización del catálogo.', icon: 'source', group: 'Gestión' },
  { id: 'reportes', permission: 'reportes.exportar', path: '/reportes', title: 'Reportes', heading: 'Reportes y exportaciones', description: 'Lleva contigo los datos de la consulta actual.', icon: 'report', group: 'Gestión' },
  { id: 'modelos', permission: 'modelos.leer', path: '/modelos', title: 'Modelos de IA', heading: 'Modelos de inteligencia artificial', description: 'Datasets, entrenamiento y evaluación de experimentos supervisados.', icon: 'model', group: 'Gestión', phase: 'Fase 6' },
  { id: 'alertas', permission: 'notificaciones.propias', path: '/alertas', title: 'Alertas', heading: 'Centro de alertas', description: 'Administra tus reglas, canales de entrega e historial de avisos.', icon: 'alert', group: 'Gestión' },
  { id: 'usuarios', permission: 'usuarios.administrar', path: '/usuarios', title: 'Usuarios y roles', heading: 'Usuarios y roles', description: 'Accesos y permisos de la plataforma.', icon: 'users', group: 'Gestión' },
  { id: 'auditoria', permission: 'auditoria.leer', path: '/auditoria', title: 'Auditoría', heading: 'Auditoría', description: 'Trazabilidad de las operaciones del sistema.', icon: 'audit', group: 'Gestión' },
] satisfies { id: string; path: string; title: string; heading: string; description: string; icon: IconName; group: string; permission: string; pending?: boolean; phase?: string }[]

function subscribe(callback: () => void) {
  const pop = () => {
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close())
    callback()
  }
  window.addEventListener('popstate', pop)
  window.addEventListener('sismocore:navigate', callback)
  return () => {
    window.removeEventListener('popstate', pop)
    window.removeEventListener('sismocore:navigate', callback)
  }
}
const snapshot = () => window.location.pathname + window.location.search

export function useLocation() {
  const location = useSyncExternalStore(subscribe, snapshot)
  const [pathname, search = ''] = location.split('?')
  const path = pathname.replace(/\/+$/, '') || '/'
  return { path, search: search ? `?${search}` : '', page: pages.find(page => page.path === path) }
}

export function navigate(to: string, replace = false) {
  const url = new URL(to, window.location.origin)
  if (url.origin !== window.location.origin) return
  if (url.pathname + url.search === snapshot()) return
  window.history[replace ? 'replaceState' : 'pushState']({}, '', url.pathname + url.search)
  window.dispatchEvent(new Event('sismocore:navigate'))
}

