const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export interface AuthUser {
  id: string
  email: string
  nombre_completo: string
  rol: 'administrador' | 'analista' | 'operador' | 'auditor' | 'lectura'
  estado: 'activo'
}

export class AuthError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export async function authRequest<T>(path: string, body?: object): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}/api/v1/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000),
    })
  } catch {
    throw new AuthError('No se pudo contactar con el servicio de acceso. Comprueba tu conexión y vuelve a intentarlo.', 0)
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new AuthError(typeof data?.detail === 'string' ? data.detail : 'El servicio de acceso no está disponible. Inténtalo de nuevo.', response.status)
  return data as T
}

export const currentUser = () => authRequest<{ user: AuthUser }>('me')
export const signIn = (email: string, password: string) => authRequest<{ user: AuthUser }>('login', { email, password })
export const recoverPassword = (email: string) => authRequest<{ message: string }>('recover', { email })
export const updatePassword = (password: string) => authRequest<{ message: string }>('password', { password })

let cacheGeneration = 0
export const privateCacheGeneration = () => cacheGeneration
export function clearPrivateCache() {
  cacheGeneration++
  try { sessionStorage.removeItem('sismocore.catalogo.igp.v2') } catch { /* Storage may be disabled. */ }
}
