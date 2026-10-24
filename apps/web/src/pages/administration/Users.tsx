import { useEffect, useState, type FormEvent } from 'react'
import { Badge, Button, Dialog, EmptyState, Panel } from '../../components/ui'
import { Icon } from '../../components/Icon'
import { fecha } from '../../lib/format'
import { permissionNames, roleNames } from '../../lib/permissions'
import { createAccount, listAccounts, updateAccount, type Account } from '../../services/administration'
import type { AuthUser } from '../../services/auth'
import './administration.css'

const states = { pendiente:'Pendiente', activo:'Activo', suspendido:'Suspendido' }
const stateTone = (state: string) => state === 'activo' ? 'success' : state === 'suspendido' ? 'danger' : 'warning'

export default function Users({ user }: { user: AuthUser }) {
  const [query, setQuery] = useState({ page:1, role:'', state:'' })
  const [rows, setRows] = useState<Account[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      setLoading(true); setError('')
      try {
        const data = await listAccounts(query.page, query.role, query.state, controller.signal)
        if (!controller.signal.aborted) { setRows(data.usuarios); setTotal(data.total) }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se pudieron cargar las cuentas.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })
    return () => controller.abort()
  }, [query, revision])

  const visible = rows.filter(row => `${row.nombre_completo} ${row.email}`.toLowerCase().includes(search.trim().toLowerCase()))
  function saved() {
    setEditing(null); setMessage('Cuenta guardada. El cambio quedó registrado en auditoría.')
    setRevision(value => value + 1)
    window.dispatchEvent(new Event('sismocore:permissions-changed'))
  }

  return <div className="admin-content"><Panel title="Administración de cuentas" description="Identidades en Supabase Auth y permisos de la plataforma." action={<Button variant="primary" icon="users" onClick={() => setEditing('new')}>Crear usuario</Button>}>
    <div className="admin-info"><Icon name="info" size={18} /><p>Los cambios de rol y estado se aplican en el servidor. Una cuenta pendiente o suspendida no puede acceder. No puedes cambiar tu propio rol ni suspenderte.</p></div>
    <div className="admin-filters"><label className="field"><span>Rol</span><select value={query.role} onChange={event => setQuery({ ...query, role:event.target.value, page:1 })}><option value="">Todos los roles</option>{Object.entries(roleNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field"><span>Estado</span><select value={query.state} onChange={event => setQuery({ ...query, state:event.target.value, page:1 })}><option value="">Todos los estados</option>{Object.entries(states).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label className="field"><span>Buscar en esta página</span><input type="search" placeholder="Nombre o correo" value={search} onChange={event => setSearch(event.target.value)} maxLength={150} /></label><Button icon="refresh" onClick={() => setRevision(value => value + 1)} loading={loading}>Actualizar cuentas</Button></div>
    {message && <p className="admin-success" role="status"><Icon name="check" size={17} />{message}</p>}
    {error && <p className="admin-error" role="alert">{error}</p>}
    {loading ? <p className="admin-loading" role="status"><span className="spinner" /> Consultando cuentas…</p> : !error && (visible.length ? <>
      <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Usuarios registrados"><table className="admin-table"><caption className="sr-only">Cuentas de Supabase y sus permisos</caption><thead><tr><th>Usuario</th><th>Rol y estado</th><th>Último acceso · Perú</th><th>Alta · Perú</th><th>MFA en Supabase</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{visible.map(row => <tr key={row.id}><td><strong>{row.nombre_completo || 'Sin nombre'}</strong><small>{row.email}</small>{row.id === user.id && <Badge tone="info">Tu cuenta</Badge>}</td><td><strong>{roleNames[row.rol]}</strong><Badge tone={stateTone(row.estado)}>{states[row.estado]}</Badge></td><td>{row.ultimo_acceso_en ? fecha(row.ultimo_acceso_en) : 'Sin accesos'}</td><td>{fecha(row.creado_en)}</td><td>{row.mfa_activo ? 'Configurado' : 'Sin configurar'}</td><td><Button icon="users" onClick={() => setEditing(row)} aria-label={`Editar ${row.email}`}>Editar</Button></td></tr>)}</tbody></table></div>
      <div className="account-cards">{visible.map(row => <article className="account-card" key={row.id}><div><strong>{row.nombre_completo || 'Sin nombre'}</strong><p>{row.email}</p></div><div className="account-badges"><Badge>{roleNames[row.rol]}</Badge><Badge tone={stateTone(row.estado)}>{states[row.estado]}</Badge></div><p>Último acceso: {row.ultimo_acceso_en ? fecha(row.ultimo_acceso_en) : 'Sin accesos'}</p><Button onClick={() => setEditing(row)} aria-label={`Editar cuenta de ${row.email}`}>Editar cuenta</Button></article>)}</div>
    </> : <EmptyState icon="users" title="Sin cuentas para este filtro" description="Cambia los filtros o crea una cuenta para un integrante del equipo." />)}
    {!loading && !error && <div className="pagination"><span>{total} cuentas encontradas · página {query.page}</span><div><Button disabled={query.page <= 1} onClick={() => setQuery({ ...query, page:query.page - 1 })}>Anterior</Button><Button disabled={query.page * 20 >= total} onClick={() => setQuery({ ...query, page:query.page + 1 })}>Siguiente</Button></div></div>}
  </Panel>
  <Panel title="Permisos por rol" description="Los permisos se verifican en cada operación de la API."><div className="role-cards"><Role name="Administrador" text="Gestiona cuentas y consulta todas las áreas habilitadas." /><Role name="Analista" text="Consulta el catálogo, las fuentes y exporta reportes; acceso a modelos cuando se habiliten." /><Role name="Operador de alertas" text="Consulta el catálogo y tendrá acceso al centro de alertas." /><Role name="Auditor" text="Consulta la bitácora, las fuentes y reportes; no modifica cuentas." /><Role name="Solo lectura" text="Consulta dashboard, eventos, mapa y análisis descriptivo." /></div></Panel>
  {editing && <AccountEditor key={editing === 'new' ? 'new' : editing.id} account={editing === 'new' ? null : editing} user={user} onClose={() => setEditing(null)} onSaved={saved} />}
  </div>
}

function Role({ name, text }: { name: string; text: string }) { return <article className="role-card"><h3>{name}</h3><p>{text}</p></article> }

function AccountEditor({ account, user, onClose, onSaved }: { account: Account | null; user: AuthUser; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(account?.nombre_completo || '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AuthUser['rol']>(account?.rol || 'lectura')
  const [state, setState] = useState<Account['estado']>(account?.estado || 'pendiente')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const own = account?.id === user.id

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      if (account) await updateAccount(account.id, { nombre_completo:name.trim(), rol:role, estado:state, actualizado_en:account.actualizado_en })
      else await createAccount({ nombre_completo:name.trim(), email:email.trim(), password, rol:role, estado:state })
      setPassword(''); onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar la cuenta.') }
    finally { setBusy(false) }
  }
  return <Dialog open title={account ? 'Editar cuenta' : 'Crear usuario'} eyebrow="USUARIOS Y PERMISOS" description={account ? account.email : 'La identidad y contraseña se gestionan únicamente en Supabase Auth.'} busy={busy} onClose={onClose}><form className="account-form" onSubmit={event => void submit(event)} aria-busy={busy}>
    <label className="field"><span>Nombre completo</span><input name="name" autoComplete="name" value={name} minLength={2} maxLength={120} required disabled={busy} onChange={event => setName(event.target.value)} /></label>
    {!account && <><label className="field"><span>Correo electrónico</span><input name="email" type="email" autoComplete="off" required maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label><label className="field"><span id="account-password-label">Contraseña inicial</span><input aria-labelledby="account-password-label" aria-describedby="account-password-help" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /><small id="account-password-help">Al menos 12 caracteres. No se guarda en el código ni en la tabla de perfiles.</small></label></>}
    <div className="account-form-pair"><label className="field"><span>Rol de la cuenta</span><select value={role} disabled={busy || own} onChange={event => setRole(event.target.value as AuthUser['rol'])}>{Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span>Estado de la cuenta</span><select value={state} disabled={busy || own} onChange={event => setState(event.target.value as Account['estado'])}>{Object.entries(states).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {own && <p className="context-note">Tu rol y estado están protegidos. Puedes actualizar tu nombre.</p>}
    {account && <div className="account-permissions"><strong>Permisos actuales</strong><ul>{account.permisos.map(permission => <li key={permission}>{permissionNames[permission] || permission}</li>)}</ul></div>}
    {error && <p className="admin-error" role="alert">{error}</p>}
    <div className="admin-form-actions"><Button disabled={busy} onClick={onClose}>Cancelar</Button><Button type="submit" variant="primary" loading={busy}>{account ? 'Guardar cambios' : 'Crear cuenta'}</Button></div>
  </form></Dialog>
}
