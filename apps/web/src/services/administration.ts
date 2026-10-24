import { protectedRequest, type AuthUser } from './auth'
import type { EventoSismico } from './api'
import type { Filters } from '../lib/filters'

export interface Account {
  id: string; nombre_completo: string; email: string; rol: AuthUser['rol']; estado: 'pendiente' | 'activo' | 'suspendido'
  creado_en: string; actualizado_en: string; ultimo_acceso_en: string | null; mfa_activo: boolean; permisos: string[]
}
export interface Page<T> { total: number; pagina: number; tamano: number; usuarios: T[] }
export interface AuditEntry {
  id: string; actor_id: string | null; actor_tipo: string; accion: string; entidad: string; entidad_id: string | null
  antes: Record<string, unknown> | null; despues: Record<string, unknown> | null; resultado: string; ocurrido_en: string
  correlacion_id: string | null; actor: { nombre_completo: string } | null
}
export type ProfileChange = Pick<Account, 'nombre_completo' | 'rol' | 'estado' | 'actualizado_en'>
export type NewAccount = Omit<ProfileChange, 'actualizado_en'> & { email: string; password: string }
export interface ExportSnapshot {
  eventos: EventoSismico[]; total: number; consultado_en: string; ultima_sincronizacion: string | null
  periodo_dias: number; solicitante: { id: string; nombre: string }; exportacion_id: string; correlacion_id: string
}

export function listAccounts(page: number, role: string, state: string, signal: AbortSignal) {
  const params = new URLSearchParams({ pagina: String(page), tamano: '20' })
  if (role) params.set('rol', role)
  if (state) params.set('estado', state)
  return protectedRequest<Page<Account>>(`usuarios?${params}`, undefined, undefined, signal)
}
export const createAccount = (account: NewAccount) => protectedRequest<{ usuario: Account }>('usuarios', account)
export const updateAccount = (id: string, changes: ProfileChange) => protectedRequest<{ usuario: Account }>(`usuarios/${id}`, changes, 'PATCH')
export function listAudit(filters: Record<string, string>, signal: AbortSignal) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ''))
  return protectedRequest<{ registros: AuditEntry[]; total: number; pagina: number; tamano: number; fecha_corte: string }>(`auditoria?${params}`, undefined, undefined, signal)
}
export const authorizeExport = (filters: Filters) => protectedRequest<ExportSnapshot>('reportes/exportar', {
  q: filters.q, magnitud: filters.magnitude, desde: filters.since || null,
})
