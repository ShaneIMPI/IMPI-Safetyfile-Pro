import { useEffect } from 'react'

export function Spinner({ label = 'Loading…' }) {
  return <div className="empty">{label}</div>
}

export function ErrorBanner({ error }) {
  if (!error) return null
  const msg = typeof error === 'string' ? error : error.message || String(error)
  return <div className="error-banner">{msg}</div>
}

export function EmptyState({ children }) {
  return <div className="empty">{children}</div>
}

export function Pill({ kind, children }) {
  return <span className={`pill ${kind || ''}`}>{children}</span>
}

export function StatusPill({ status }) {
  const label = String(status || 'not_reviewed').replace(/_/g, ' ')
  return <span className={`pill status-${status || 'not_reviewed'}`}>{label}</span>
}

export function Toolbar({ children }) {
  return <div className="toolbar">{children}</div>
}

export function Field({ label, children, hint }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

export function Modal({ title, children, onClose, wide, actions }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="panel-title">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

export function ConfirmButton({ onConfirm, children, className = 'btn-danger btn-sm', confirmLabel = 'Confirm?' }) {
  return (
    <button
      className={className}
      onClick={(e) => {
        if (e.currentTarget.dataset.armed === '1') { onConfirm() }
        else {
          e.currentTarget.dataset.armed = '1'
          const t = e.currentTarget
          const orig = t.textContent
          t.textContent = confirmLabel
          setTimeout(() => { if (t) { t.dataset.armed = '0'; t.textContent = orig } }, 2500)
        }
      }}
    >
      {children}
    </button>
  )
}
