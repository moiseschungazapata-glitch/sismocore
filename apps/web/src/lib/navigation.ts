import { useSyncExternalStore } from 'react'
import type { IconName } from '../components/Icon'

export const pages = [
  { id: 'dashboard', path: '/', title: 'Dashboard', heading: 'Dashboard sísmico', description: 'Una vista clara de la actividad sísmica observada.', icon: 'dashboard', group: 'Monitoreo' },
  { id: 'eventos', path: '/eventos', title: 'Eventos sísmicos', heading: 'Eventos sísmicos', description: 'Consulta las observaciones y verifica su procedencia.', icon: 'event', group: 'Monitoreo' },
  { id: 'mapa', path: '/mapa', title: 'Mapa sísmico', heading: 'Mapa sísmico', description: 'Explora dónde ocurrieron los eventos del catálogo.', icon: 'map', group: 'Monitoreo' },
  { id: 'analisis', path: '/analisis', title: 'Análisis', heading: 'Análisis descriptivo', description: 'Explora la distribución de los datos observados.', icon: 'chart', group: 'Monitoreo' },
  { id: 'fuentes', path: '/fuentes', title: 'Fuentes de datos', heading: 'Fuentes de datos', description: 'Conoce la procedencia y actualización del catálogo.', icon: 'source', group: 'Gestión' },
  { id: 'reportes', path: '/reportes', title: 'Reportes', heading: 'Reportes y exportaciones', description: 'Lleva contigo los datos de la consulta actual.', icon: 'report', group: 'Gestión' },
  { id: 'modelos', path: '/modelos', title: 'Modelos de IA', heading: 'Modelos de inteligencia artificial', description: 'Espacio de experimentación y evaluación de modelos.', icon: 'model', group: 'Gestión', phase: 'Fase 5', pending: true },
  { id: 'alertas', path: '/alertas', title: 'Alertas', heading: 'Centro de alertas', description: 'Reglas y seguimiento de notificaciones operativas.', icon: 'alert', group: 'Gestión', phase: 'Fase 7', pending: true },
  { id: 'usuarios', path: '/usuarios', title: 'Usuarios y roles', heading: 'Usuarios y roles', description: 'Accesos y permisos de la plataforma.', icon: 'users', group: 'Gestión', phase: 'Fase 2', pending: true },
  { id: 'auditoria', path: '/auditoria', title: 'Auditoría', heading: 'Auditoría', description: 'Trazabilidad de las operaciones del sistema.', icon: 'audit', group: 'Gestión', phase: 'Fase 2', pending: true },
] satisfies { id: string; path: string; title: string; heading: string; description: string; icon: IconName; group: string; pending?: boolean; phase?: string }[]

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

