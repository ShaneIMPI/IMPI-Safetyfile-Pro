import { useState } from 'react'
import { supabase, isConfigured } from '../lib/supabase.js'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('password') // 'password' | 'magic'
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setErr(null); setMsg(null); setBusy(true)
    try {
      if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin + window.location.pathname },
        })
        if (error) throw error
        setMsg('Check your email for a sign-in link.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (e2) {
      setErr(e2.message || String(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="panel login-card">
        <div className="brand" style={{ color: 'var(--navy)', fontWeight: 700, fontSize: '1.15rem', marginBottom: 4 }}>
          IMPI SafetyFile Pro
        </div>
        <div className="muted" style={{ fontSize: '0.8rem', marginBottom: '1.25rem' }}>
          IMPI Protection Agency — staff sign in
        </div>

        {!isConfigured && (
          <div className="error-banner">
            Supabase is not configured. Set <span className="mono">VITE_SUPABASE_URL</span> and{' '}
            <span className="mono">VITE_SUPABASE_ANON_KEY</span> (see README).
          </div>
        )}

        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>
          {mode === 'password' && (
            <div className="field">
              <label>Password</label>
              <input
                type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
              />
            </div>
          )}
          {err && <div className="error-banner">{err}</div>}
          {msg && <div className="notice">{msg}</div>}
          <button type="submit" disabled={busy || !isConfigured} style={{ width: '100%', marginTop: 4 }}>
            {busy ? 'Working…' : mode === 'magic' ? 'Send magic link' : 'Sign in'}
          </button>
        </form>

        <button
          className="btn-ghost btn-sm" style={{ marginTop: 12, width: '100%' }}
          onClick={() => { setMode(mode === 'password' ? 'magic' : 'password'); setErr(null); setMsg(null) }}
        >
          {mode === 'password' ? 'Use a magic link instead' : 'Use a password instead'}
        </button>
      </div>
    </div>
  )
}
