// Neon Postgres + Neon Auth client (replaces src/lib/supabase.js).
//
// @neondatabase/neon-js is ONE unified client (confirmed against the package's
// own shipped README/llms.txt, not just web docs): createClient({ auth, dataApi })
// returns a single object whose `.auth.*` methods are Neon Auth (Managed Better
// Auth: signIn.email, useSession, signOut, ...) and whose `.from()`/`.rpc()`
// methods are the Data API (a PostgREST-compatible REST layer in front of
// Postgres — RLS enforced via `auth.user_id()` instead of Supabase's `auth.uid()`).
// `neonClient` below IS that single client; `authClient` is just `neonClient.auth`,
// split out so AuthProvider/LoginPage don't need to know about `.from()`.
//
// File storage does NOT go through this client at all. Neon Object Storage has
// no per-object/per-folder policy grammar (see DECISIONS.md addendum 2), so
// every upload/download here calls the `file-access` Neon Function instead,
// which checks is_staff()/client_id against Postgres and hands back a scoped,
// time-limited URL. `logos` is the one public_read bucket — its read URL is
// just the bucket's public path, no function round-trip needed.

import { createClient } from '@neondatabase/neon-js'
import { BetterAuthReactAdapter } from '@neondatabase/neon-js/auth/react/adapters'

const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL
const authUrl = import.meta.env.VITE_NEON_AUTH_URL
const fileFnUrl = import.meta.env.VITE_NEON_FILE_FN_URL
const auditFnUrl = import.meta.env.VITE_NEON_AUDIT_FN_URL
const publicFilesBaseUrl = import.meta.env.VITE_NEON_PUBLIC_FILES_URL // logos bucket public base URL

export const isConfigured = Boolean(dataApiUrl && authUrl)

if (!isConfigured) {
  // Not fatal — the app renders a setup notice instead of a blank screen.
  console.warn(
    '[IMPI] VITE_NEON_DATA_API_URL / VITE_NEON_AUTH_URL are not set. ' +
      'Copy .env.example to .env.local (see README).',
  )
}

export const neonClient = createClient({
  auth: { url: authUrl ?? 'http://localhost/auth', adapter: BetterAuthReactAdapter() },
  dataApi: { url: dataApiUrl ?? 'http://localhost/rest/v1' },
})
export const authClient = neonClient.auth

// --- Bearer token for OUR OWN functions (audit-suggest, file-access) -----
//
// NOT used for neonClient's own `.from()`/`.rpc()` calls — those pick up the
// session automatically since they're the same client. This is only for the
// two custom Neon Functions below, which need a plain
// `Authorization: Bearer <token>` header.
//
// CORRECTED (2026-09-22): this used to call authClient.getJWTToken(), which
// the package's own README documents as "Returns JWT token: authenticated
// session → anonymous token → null". That documentation does not match this
// project's actual Neon Auth instance — confirmed by intercepting the real
// fetch calls the client makes: getJWTToken() requests GET /get-jwt-token,
// which 404s here (this was the exact "AuthApiError: HTTP 404" breaking
// Document Builder generation and any other caller of uploadFile()). A
// `typeof authClient.getJWTToken === 'function'` guard never catches this,
// because this client is a Proxy — EVERY property access returns a function,
// whether or not a matching endpoint exists server-side, so that check gives
// false confidence and was removed rather than kept as a guard.
//
// authClient.token() (GET /token) is the endpoint that actually exists on
// this instance — confirmed the same way (intercepted fetch call, got a real
// 401 Unauthorized with no session rather than a 404). If a future Neon Auth
// version changes this again, don't re-add a typeof guard; re-verify with a
// fetch interceptor the way this was diagnosed, not by trusting a method's
// mere existence.
// Matches a JWT's shape: three non-empty base64url segments. Real signed
// tokens from this endpoint are the only thing in its response remotely
// resembling this, so finding one anywhere in the payload is unambiguous.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

// Walk an arbitrary response object looking for a JWT-shaped string, at any
// depth, under any field name. Used instead of reading one guessed field path
// (e.g. res.data.token) because that was guessed wrong twice in a row against
// this project's actual Neon Auth response — confirmed via a real signed-in
// browser console log that a JWT genuinely is in there, just not at either
// guessed path. This makes the exact field name/nesting irrelevant.
function findJwtLike(value, depth = 0) {
  if (depth > 4 || value == null) return null
  if (typeof value === 'string') return JWT_SHAPE.test(value) ? value : null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJwtLike(item, depth + 1)
      if (found) return found
    }
    return null
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const found = findJwtLike(value[key], depth + 1)
      if (found) return found
    }
  }
  return null
}

export async function getAccessToken() {
  try {
    const res = await authClient.token()
    const token = findJwtLike(res)
    if (token) return token
    console.error('[IMPI] authClient.token() succeeded but no JWT-shaped value was found anywhere in the response:', JSON.stringify(res))
  } catch (err) {
    console.error('[IMPI] authClient.token() failed, falling back to session lookup:', err)
  }
  const { data } = await authClient.getSession()
  const fallback = findJwtLike(data) ?? data?.session?.token ?? null
  if (!fallback) {
    console.error('[IMPI] No access token available from either authClient.token() or getSession() — the request below will go out unauthenticated and the Function will correctly reject it.')
  }
  return fallback
}

async function callFunction(url, body) {
  if (!url) throw new Error('This feature is not configured (missing a Neon Function URL).')
  const token = await getAccessToken()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    // TEMPORARY DIAGNOSTIC (2026-09-22) — remove once the persistent
    // "unauthorised" from file-access is root-caused. Confirmed separately
    // (a direct unauthenticated curl to this Function) that
    // NEON_AUTH_JWKS_URL/NEON_AUTH_BASE_URL/DATABASE_URL are genuinely
    // present at runtime, ruling out missing env vars. This re-sends the
    // SAME token this failing request just used to a debug-env action on
    // the same Function, which runs jwtVerify itself and reports the real
    // jose failure reason (expired/wrong issuer/JWKS fetch failure/...)
    // instead of the generic "unauthorised" this call site just got.
    if (url.includes('fileaccess') && token) {
      try {
        const diag = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'debug-env' }),
        }).then((r) => r.json())
        console.error('[IMPI] file-access call failed — diagnostic detail:', diag)
      } catch (diagErr) {
        console.error('[IMPI] file-access diagnostic call itself failed:', diagErr)
      }
    }
    throw new Error(json.error || `Request failed (${res.status})`)
  }
  return json
}

// Call the audit-suggest Function (optional AI audit hints).
export async function callAuditSuggest(body) {
  return callFunction(auditFnUrl, body)
}

// --- File storage, brokered through the file-access Function ------------
//
// Upload a File/Blob and return { path, url } — same contract the app's pages
// already expect, so no page-level code changes were needed for this swap.
export async function uploadFile(bucket, path, file) {
  if (bucket === 'logos') {
    const { uploadUrl } = await callFunction(fileFnUrl, {
      action: 'presign-put', bucket, path, contentType: file.type || undefined,
    })
    await putToPresignedUrl(uploadUrl, file)
    return { path, url: publicLogoUrl(path) }
  }
  const { uploadUrl, readUrl } = await callFunction(fileFnUrl, {
    action: 'presign-put', bucket, path, contentType: file.type || undefined, withReadUrl: true,
  })
  await putToPresignedUrl(uploadUrl, file)
  return { path, url: readUrl }
}

export function publicLogoUrl(path) {
  if (!publicFilesBaseUrl) return null
  return `${publicFilesBaseUrl.replace(/\/$/, '')}/${path}`
}

// Re-mint a fresh read link for a private file (the stored URL is a 7-day
// presigned link and can expire — same limitation the Supabase version had).
export async function refreshFileUrl(bucket, path) {
  const { readUrl } = await callFunction(fileFnUrl, { action: 'presign-get', bucket, path })
  return readUrl
}

async function putToPresignedUrl(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) throw new Error(`Upload failed (${res.status})`)
}
