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
      // First login for this user: create their own profile row.
      //
      // CORRECTED (2026-09-22): this used to call neonClient.rpc('ensure_profile', ...),
      // a SECURITY DEFINER function that read auth.user_id() itself server-side.
      // That reliably failed on this project's live Data API with Postgres
      // error 23502 ("null value in column id of relation profiles") —
      // auth.user_id() evaluates NULL specifically through the RPC endpoint,
      // even though it's proven reliable for ordinary .from() reads/writes
      // elsewhere in this app. Confirmed via psql (policies/grants correct,
      // pre-existing rows inserted fine under the same auth.user_id()) before
      // concluding this was RPC-specific rather than a config bug — see
      // neon/migrations/0007_profile_insert_policy.sql.
      //
      // Fixed by dropping the RPC call and using .from().upsert() instead,
      // with a plain INSERT policy (own_profile_insert) that checks
      // id = auth.user_id() server-side — the same "can only touch your own
      // row" guarantee ensure_profile() gave, just via the reliable code path.
      // ignoreDuplicates keeps this from clobbering a role an admin already
      // set for an existing row.
      //
      // IMPORTANT: neonClient.rpc(...)/.from(...) never THROW for a
      // request-level failure (network error, RLS denial, ...) — they always
      // resolve, with the failure in the returned `error` field, same
      // convention as postgrest-js/supabase-js. Check `error` explicitly
      // rather than try/catch alone.
      const { error: upsertError } = await neonClient
        .from('profiles')
        .upsert(
          { id: user.id, full_name: user.name ?? user.email ?? null },
          { onConflict: 'id', ignoreDuplicates: true },
        )
      if (upsertError) console.error('[IMPI] profile upsert failed:', upsertError)

      const { data, error: selectError } = await neonClient
        .from('profiles')
        .select('id, role, full_name, phone, client_id')
        .eq('id', user.id)
        .maybeSingle()
      if (selectError) throw selectError

      setProfile(data ?? { id: user.id, role: 'staff', full_name: null })
      // If the upsert failed AND there's still no row, the profile was
      // genuinely never persisted — the fallback above lets the user into the
      // app, but every RLS check keyed on their profiles row will fail, so
      // this needs to be visible rather than a silent, confusing "access
      // denied everywhere" later.
      if (upsertError && !data) setProfileError(upsertError)
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
