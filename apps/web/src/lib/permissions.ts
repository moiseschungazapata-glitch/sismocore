import type { AuthUser } from '../services/auth'

export const roleNames: Record<AuthUser['rol'], string> = {
  administrador: 'Administrador', analista: 'Analista', operador: 'Operador de alertas', auditor: 'Auditor', lectura: 'Solo lectura',
}
export const permissionNames: Record<string, string> = {
  'notificaciones.propias':'Administrar las notificaciones de tus propios dispositivos',
  'catalogo.leer':'Consultar eventos, mapa y análisis', 'fuentes.leer':'Consultar estado de fuentes',
  'reportes.exportar':'Exportar reportes', 'usuarios.administrar':'Administrar usuarios y roles',
  'auditoria.leer':'Consultar auditoría', 'modelos.leer':'Consultar modelos cuando se habiliten',
  'alertas.leer':'Consultar alertas cuando se habiliten',
}
export const can = (user: AuthUser, permission: string) => user.permisos?.includes(permission) === true
