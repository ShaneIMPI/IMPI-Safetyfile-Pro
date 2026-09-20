import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { neonClient, authClient, isConfigured } from '../lib/neon.js'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  // authClient.useSession() is Neon Auth's own React hook (Managed Better
  // Auth) — it tracks sign-in/out and token refresh for us, so there's no
  // manual subscription to wire up the way supabase-js needed.
  const { data: sessionData, isPending } = authClient.useSession()
  const user = sessionData?.user ?? null

  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState(null)

  const loadProfile = useCallback(async () => {
    if (!user?.id) { setProfile(null); setProfileLoading(false); setProfileError(null); return }
    setProfileLoading(true)
    setProfileError(null)
    try {
      // First login for this user: create their own profile row. ensure_profile()
      // is SECURITY DEFINER and reads auth.user_id() itself server-side, so a
      // caller can only ever create/touch their OWN row (0002_functions.sql).
      //
      // IMPORTANT (confirmed by inspecting the installed client directly, not
      // assumed): neonClient.rpc(...)/.from(...) never THROW for a request-level
      // failure (network error, RPC error, RLS denial, ...) — they always
      // resolve, with the failure in the returned `error` field, same
      // convention as postgrest-js/supabase-js. So `.catch(...)` chained on the
      // call is both wrong (the returned object isn't a real Promise and has no
      // .catch method — this was the reported crash) and wouldn't have caught a
      // real failure anyway. Check `error` explicitly instead.
      const { error: rpcError } = await neonClient.rpc(
        'ensure_profile', { p_full_name: user.name ?? user.email ?? null },
      )
      if (rpcError) console.error('[IMPI] ensure_profile failed:', rpcError)

      const { data, error: selectError } = await neonClient
        .from('profiles')
        .select('id, role, full_name, phone, client_id')
        .eq('id', user.id)
        .maybeSingle()
      if (selectError) throw selectError

      setProfile(data ?? { id: user.id, role: 'staff', full_name: null })
      // If ensure_profile failed AND there's still no row, the profile was
      // genuinely never persisted — the fallback above lets the user into the
      // app, but every RLS check keyed on their profiles row will fail, so
      // this needs to be visible rather than a silent, confusing "access
      // denied everywhere" later.
      if (rpcError && !data) setProfileError(rpcError)
    } catch (err) {
      // Couldn't even read the profile back — this one really is fatal to
      // rendering the app (we have no way to know the user's role), so it
      // must stop the spinner and surface, not hang forever.
      console.error('[IMPI] Failed to load profile:', err)
      setProfileError(err)
      setProfile(null)
    } finally {
      setProfileLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (!isConfigured) { setProfileLoading(false); return }
    loadProfile()
  }, [loadProfile])

  const value = {
    session: sessionData,
    user,
    profile,
    profileError,
    role: profile?.role ?? null,
    isStaff: profile?.role === 'staff',
    loading: isConfigured ? (isPending || profileLoading) : false,
    signOut: () => authClient.signOut(),
    refreshProfile: loadProfile,
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
