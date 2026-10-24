import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { containDialogFocus } from '../lib/accessibility'

export function Button({ variant = 'secondary', icon, loading, children, className = '', disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; icon?: IconName; loading?: boolean }) {
  return <button type="button" {...props} disabled={disabled || loading} aria-busy={loading || undefined} className={`button button--${variant} ${className}`}>
    {loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={17} />}{children}
  </button>
}

export function Badge({ tone = 'neutral', children, icon }: { tone?: string; children: ReactNode; icon?: IconName }) {
  return <span className={`badge badge--${tone}`}>{icon && <Icon name={icon} size={14} />}{children}</span>
}

export function Panel({ title, description, action, children, className = '' }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId()
  return <section className={`panel ${className}`} aria-labelledby={id}><div className="panel-heading"><div><h2 id={id}>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>{children}</section>
}

export function Metric({ title, value, note, icon, accent = false }: { title: string; value: string; note: string; icon: IconName; accent?: boolean }) {
  return <article className={`metric-card ${accent ? 'metric-card--accent' : ''}`}><div className="metric-heading"><p>{title}</p><span className="metric-icon"><Icon name={icon} size={19} /></span></div><div className="metric-value">{value}</div><p className="metric-note">{note}</p></article>
}

export function EmptyState({ icon = 'search', title, description, action }: { icon?: IconName; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={26} /></span><h3>{title}</h3><p>{description}</p>{action}</div>
}

export function LoadingState() {
  return <div className="loading-state" role="status" aria-label="Consultando el catálogo" aria-busy="true"><span className="sr-only">Consultando el catálogo y comprobando la conexión.</span><div className="metrics-grid">{[1, 2, 3, 4].map(i => <div className="metric-card skeleton-card" key={i}><div className="skeleton skeleton-label" /><div className="skeleton skeleton-value" /><div className="skeleton skeleton-note" /></div>)}</div><div className="panel skeleton-table">{[1, 2, 3, 4].map(i => <div className="skeleton skeleton-row" key={i} />)}</div></div>
}

export function Dialog({ open, title, description, onClose, children, eyebrow = 'EVENTO OBSERVADO', busy = false }: { open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode; eyebrow?: string; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    else if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  return <dialog className="detail-dialog" ref={dialog} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onClose={onClose} onCancel={event => { if (busy) event.preventDefault() }} onKeyDown={containDialogFocus} onClick={e => { if (!busy && e.target === e.currentTarget) dialog.current?.close() }}><div className="dialog-shell"><div className="dialog-header"><div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><Button variant="ghost" icon="close" aria-label="Cerrar detalle" disabled={busy} onClick={() => dialog.current?.close()} /></div>{children}</div></dialog>
}

export function ConfirmDialog({ open, title, description, confirmLabel, busy = false, danger = false, onCancel, onConfirm, children }: {
  open: boolean; title: string; description: string; confirmLabel: string; busy?: boolean; danger?: boolean
  onCancel: () => void; onConfirm: () => void; children?: ReactNode
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (open) cancel.current?.focus() }, [open])
  return <Dialog open={open} title={title} description={description} eyebrow="CONFIRMACIÓN" busy={busy} onClose={onCancel}>
    <div className={`confirmation-content${danger ? ' confirmation-content--danger' : ''}`}>
      <span className="confirmation-icon"><Icon name={danger ? 'alert' : 'info'} size={26} /></span>
      {children}
      <div className="confirmation-actions"><button ref={cancel} type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>Cancelar</button><Button variant="primary" className={danger ? 'confirmation-danger' : ''} loading={busy} onClick={onConfirm}>{busy ? 'Procesando…' : confirmLabel}</Button></div>
    </div>
  </Dialog>
}
