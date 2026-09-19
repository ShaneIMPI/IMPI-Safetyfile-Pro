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

  const loadProfile = useCallback(async () => {
    if (!user?.id) { setProfile(null); setProfileLoading(false); return }
    setProfileLoading(true)
    // First login for this user: create their own profile row. ensure_profile()
    // is SECURITY DEFINER and reads auth.user_id() itself server-side, so a
    // caller can only ever create/touch their OWN row (0002_functions.sql).
    await neonClient.rpc('ensure_profile', { p_full_name: user.name ?? user.email ?? null }).catch(() => {})
    const { data } = await neonClient
      .from('profiles')
      .select('id, role, full_name, phone, client_id')
      .eq('id', user.id)
      .maybeSingle()
    setProfile(data ?? { id: user.id, role: 'staff', full_name: null })
    setProfileLoading(false)
  }, [user?.id])

  useEffect(() => {
    if (!isConfigured) { setProfileLoading(false); return }
    loadProfile()
  }, [loadProfile])

  const value = {
    session: sessionData,
    user,
    profile,
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
