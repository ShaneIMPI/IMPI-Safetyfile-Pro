// file-access — Neon Function
//
// Brokers all private-file storage access. Neon Object Storage only supports
// bucket-wide "private" or "public_read" access (no per-object/per-folder
// policy), so a browser-only SPA can never safely hold direct write/read
// credentials for a private bucket — this Function is what makes that safe:
// it verifies the caller's Neon Auth JWT, checks their role/client_id in
// Postgres (same rule the old Supabase Storage RLS enforced), and only then
// mints a short-lived presigned S3 URL scoped to exactly one bucket + key.
//
// Buckets: logos (public_read — the only one this function's PUT-side still
// gates), uploads, evidence, generated, safety-files (all private).
//
// CONFIRM BEFORE RELYING ON THIS IN PRODUCTION (see DECISIONS.md addendum 2):
//  - NEON_AUTH_JWKS_URL / NEON_AUTH_BASE_URL: assumed auto-injected by Neon
//    for JWT verification, per Neon's Functions authentication docs.
//  - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_ENDPOINT_URL_S3 /
//    AWS_REGION: assumed auto-injected for Object Storage access, following
//    the same names the AWS SDK reads by convention. If object storage calls
//    fail, check the exact env var names Neon injects for your project under
//    Functions > Environment variables and adjust the two `process.env.*`
//    reads below.
//  - DATABASE_URL: confirmed auto-injected by Neon for every Function.

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { Client } from 'pg'

const PRIVATE_BUCKETS = new Set(['uploads', 'evidence', 'generated', 'safety-files'])
const PUBLIC_BUCKETS = new Set(['logos'])

let jwks
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(process.env.NEON_AUTH_JWKS_URL))
  return jwks
}

async function verifyCaller(request) {
  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getJwks(), { issuer: process.env.NEON_AUTH_BASE_URL })
    return payload.sub ?? null
  } catch {
    return null
  }
}

async function lookupProfile(userId) {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query('select role, client_id from profiles where id = $1', [userId])
    return rows[0] ?? null
  } finally {
    await client.end()
  }
}

function s3() {
  return new S3Client({
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  })
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function authorize(bucket, path, request) {
  if (PUBLIC_BUCKETS.has(bucket)) {
    // Public read; write still requires a signed-in user (Phase 1 = staff-only app).
    const userId = await verifyCaller(request)
    if (!userId) return { ok: false, reason: 'unauthorised' }
    return { ok: true }
  }
  if (!PRIVATE_BUCKETS.has(bucket)) return { ok: false, reason: 'unknown_bucket' }

  const userId = await verifyCaller(request)
  if (!userId) return { ok: false, reason: 'unauthorised' }
  const profile = await lookupProfile(userId)
  if (!profile) return { ok: false, reason: 'no_profile' }
  if (profile.role === 'staff') return { ok: true }
  // Phase 2 (dormant): a client user may only touch objects under their own client_id prefix.
  if (profile.role === 'client' && profile.client_id && path.startsWith(`${profile.client_id}/`)) {
    return { ok: true }
  }
  return { ok: false, reason: 'forbidden' }
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: 'invalid_json' }, 400)
    }

    const { action, bucket, path, contentType, withReadUrl } = body || {}
    if (!action || !bucket || !path) return json({ error: 'action, bucket and path are required' }, 400)

    const auth = await authorize(bucket, path, request)
    if (!auth.ok) return json({ error: auth.reason }, auth.reason === 'unauthorised' ? 401 : 403)

    const client = s3()

    if (action === 'presign-put') {
      const uploadUrl = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: bucket, Key: path, ContentType: contentType }),
        { expiresIn: 300 }, // 5 minutes — the browser uploads immediately after asking
      )
      const result = { uploadUrl }
      if (withReadUrl || PRIVATE_BUCKETS.has(bucket)) {
        result.readUrl = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: bucket, Key: path }),
          { expiresIn: 60 * 60 * 24 * 7 }, // 7 days, same lifetime the Supabase version used
        )
      }
      return json(result)
    }

    if (action === 'presign-get') {
      const readUrl = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: path }),
        { expiresIn: 60 * 60 * 24 * 7 },
      )
      return json({ readUrl })
    }

    return json({ error: 'unknown_action' }, 400)
  },
}
