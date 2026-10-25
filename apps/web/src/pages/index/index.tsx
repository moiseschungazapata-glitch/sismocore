import { useCallback, useEffect, useRef, useState, type ComponentType, type FormEvent } from 'react'
import { Icon } from '../../components/Icon'
import { Button } from '../../components/ui'
import { Link } from '../../components/Link'
import { navigate, useLocation } from '../../lib/navigation'
import { AuthError, authRequest, clearPrivateCache, currentUser, recoverPassword, signIn, updatePassword, type AuthUser } from '../../services/auth'
import './index.css'
import SeismicBackdrop from './SeismicBackdrop'
import { currentPushDevice, forgetPushDevice } from '../../services/notifications'

function destination(search: string) {
  const target = new URLSearchParams(search).get('next') || '/'
  return target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/index') && !target.includes('\\') ? target : '/'
}

export default function AccessGate({ component: Screen }: { component: ComponentType<{ user: AuthUser; onLogout: () => Promise<void> }> }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const { path, search } = useLocation()
  const channel = useRef<BroadcastChannel | null>(null)
  const version = useRef(0)
  const check = useCallback(async () => {
    const ticket = ++version.current
    try {
      const data = await currentUser()
      if (ticket !== version.current) return
      setUser(data.user); setError('')
    } catch (failure) {
      if (ticket !== version.current) return
      if (failure instanceof AuthError && [401, 403].includes(failure.status)) {
        setUser(null); clearPrivateCache()
        setError(failure.status === 403 ? failure.message : '')
      } else setError(failure instanceof Error ? failure.message : 'No se pudo comprobar tu sesión.')
    } finally { if (ticket === version.current) setLoading(false) }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(check)
    const onFocus = () => { if (document.visibilityState === 'visible') void check() }
    const expired = () => { ++version.current; setUser(null); clearPrivateCache(); setError('Tu sesión ha terminado. Vuelve a iniciar sesión.') }
    const timer = window.setInterval(() => void check(), 240000)
    window.addEventListener('sismocore:session-ended', expired)
    window.addEventListener('sismocore:permissions-changed', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('sismocore.auth')
      channel.current.onmessage = () => { clearPrivateCache(); void check() }
    }
    const invalidate = () => { ++version.current }
    const authChannel = channel.current
    return () => { invalidate(); window.clearInterval(timer); authChannel?.close(); window.removeEventListener('sismocore:session-ended', expired); window.removeEventListener('sismocore:permissions-changed', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [check])

  useEffect(() => {
    if (loading) return
    if (!user && !path.startsWith('/index')) navigate(`/index?next=${encodeURIComponent(path + search)}`, true)
    else if (user && (path === '/index' || path === '/index/recuperar')) navigate(destination(search), true)
  }, [user, loading, path, search, error])

  async function logout() {
    setLogoutError('')
    try {
      await authRequest('logout', { dispositivo_id:user ? currentPushDevice(user.id) : null })
      forgetPushDevice()
      ++version.current; setUser(null); clearPrivateCache(); setError('')
      channel.current?.postMessage('changed'); navigate('/index', true)
    } catch (failure) {
      // A network failure must not pretend that the server deleted its cookies.
      setLogoutError(failure instanceof Error ? failure.message : 'No se pudo cerrar la sesión.')
      void check()
    }
  }
  function signedIn(value: AuthUser) {
    ++version.current; clearPrivateCache(); setUser(value); setError('')
    channel.current?.postMessage('changed'); navigate(destination(search), true)
  }

  if (loading) return <div className="auth-loading" role="status"><span className="brand-icon"><Icon name="wave" size={28} /></span><h1>SISMOCORE</h1><p><span className="spinner" aria-hidden="true" /> Comprobando tu sesión…</p></div>
  if (!user || path === '/index/restablecer') return <LoginScreen key={path} mode={path === '/index/recuperar' ? 'recover' : path === '/index/restablecer' ? 'reset' : 'login'} onSignedIn={signedIn} initialError={error} onRetry={() => void check()} />
  return <>{logoutError && <div className="auth-global-error" role="alert">{logoutError}<Button onClick={() => void logout()}>Reintentar cierre</Button></div>}<Screen user={user} onLogout={logout} /></>
}

function LoginScreen({ mode, onSignedIn, initialError, onRetry }: { mode: 'login' | 'recover' | 'reset'; onSignedIn: (user: AuthUser) => void; initialError: string; onRetry: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [recoveryReady, setRecoveryReady] = useState(false)
  const recovery = useRef<Promise<unknown> | null>(null)
  const title = mode === 'recover' ? 'Recuperar contraseña' : mode === 'reset' ? 'Nueva contraseña' : 'Iniciar sesión'
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { document.title = `${title} · SISMOCORE`; heading.current?.focus() }, [title])

  useEffect(() => {
    if (mode !== 'reset') return
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const access = fragment.get('access_token')
    const refresh = fragment.get('refresh_token')
    // Remove tokens immediately; never leave them in history, storage, logs or links.
    window.history.replaceState({}, '', window.location.pathname + window.location.search)
    if (!recovery.current) recovery.current = access && refresh
      ? authRequest('session', { access_token: access, refresh_token: refresh })
      : Promise.reject(new Error('Este enlace no es válido o ya fue utilizado. Solicita uno nuevo.'))
    let alive = true
    recovery.current.then(() => { if (alive) setRecoveryReady(true) }).catch(failure => { if (alive) setError(failure instanceof Error ? failure.message : 'No se pudo verificar el enlace.') })
    return () => { alive = false }
  }, [mode])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('')
    if (mode === 'reset' && password !== confirm) { setError('Las contraseñas no coinciden.'); return }
    setBusy(true)
    try {
      if (mode === 'login') {
        const { user } = await signIn(email.trim(), password)
        setPassword(''); onSignedIn(user)
      } else if (mode === 'recover') setMessage((await recoverPassword(email.trim())).message)
      else {
        const result = await updatePassword(password)
        setPassword(''); setConfirm(''); setMessage(result.message)
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo completar la solicitud.') }
    finally { setBusy(false) }
  }

  return <main className="login-page"><section className="login-story" aria-label="SISMOCORE, monitoreo sísmico"><div className="login-brand"><span className="brand-icon"><Icon name="wave" size={38} /></span><div><span className="brand-name">SISMO<span>CORE</span></span><span className="brand-caption">MONITOREO SÍSMICO</span></div></div><div className="login-intro"><h2>Observa. Analiza.<br />Comprende.</h2><p>Plataforma de monitoreo sísmico</p></div><SeismicBackdrop /><p className="login-story-note"><span />Datos sísmicos para decisiones informadas.</p></section><section className="login-form-area" aria-labelledby="login-title"><div className="login-card"><span className="login-lock"><Icon name="lock" size={32} /></span><h1 id="login-title" ref={heading} tabIndex={-1}>{title}</h1><p className="login-subtitle">{mode === 'recover' ? 'Te enviaremos un enlace para recuperar tu acceso.' : mode === 'reset' ? 'Elige una contraseña de al menos 12 caracteres.' : 'Accede a tu espacio de monitoreo'}</p>
    {(error || initialError) && <div className="login-message login-message--error" role="alert"><Icon name="info" size={18} /><div><p>{error || initialError}</p>{initialError && !error && <button type="button" className="login-text-button" onClick={onRetry}>Volver a comprobar</button>}</div></div>}
    {message && <div className="login-message login-message--success" role="status"><Icon name="check" size={18} /><p>{message}</p></div>}
    {!(mode === 'reset' && message) && <form onSubmit={event => void submit(event)} aria-busy={busy}>
      {mode !== 'reset' && <div className="login-field"><label htmlFor="login-email">Correo electrónico</label><div className="login-input-wrap"><Icon name="mail" size={21} /><input id="login-email" name="email" type="email" autoComplete="username" placeholder="tu@correo.com" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} spellCheck={false} autoCapitalize="none" /></div></div>}
      {mode !== 'recover' && <div className="login-field"><label htmlFor="login-password">{mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}</label><div className="login-input-wrap"><Icon name="lock" size={21} /><input id="login-password" name="password" type={visible ? 'text' : 'password'} autoComplete={mode === 'reset' ? 'new-password' : 'current-password'} placeholder="Introduce tu contraseña" required minLength={mode === 'reset' ? 12 : 1} maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} disabled={busy || mode === 'reset' && !recoveryReady} /><button type="button" className="login-show-password" aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible} onClick={() => setVisible(!visible)}><Icon name={visible ? 'eyeOff' : 'eye'} size={21} /></button></div></div>}
      {mode === 'reset' && <div className="login-field"><label htmlFor="login-confirm">Confirmar contraseña</label><div className="login-input-wrap"><Icon name="lock" size={21} /><input id="login-confirm" name="confirm" type={visible ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={1024} value={confirm} onChange={event => setConfirm(event.target.value)} disabled={busy || !recoveryReady} /></div></div>}
      {mode === 'login' && <div className="login-recovery-link"><Link href="/index/recuperar">¿Olvidaste tu contraseña?</Link></div>}
      <Button type="submit" variant="primary" loading={busy} disabled={mode === 'reset' && !recoveryReady} className="login-submit">{busy ? 'Procesando…' : mode === 'recover' ? 'Enviar enlace' : mode === 'reset' ? 'Guardar contraseña' : 'Ingresar'}{!busy && <Icon name="arrow" size={20} />}</Button>
    </form>}
    {mode !== 'login' && <Link className="login-back" href={mode === 'reset' && !message ? '/index/recuperar' : '/index'}>{mode === 'reset' && !message ? 'Solicitar otro enlace' : 'Volver al inicio de sesión'}</Link>}
    <div className="login-contact">¿Necesitas acceso? Contacta al administrador.</div></div><p className="login-footer">SISMOCORE · Monitoreo sísmico</p></section></main>
}
