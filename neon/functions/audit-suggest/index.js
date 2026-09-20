// audit-suggest — Neon Function (ported from the original Supabase Edge Function)
//
// The browser sends: extracted text from the client's uploaded safety file +
// the checklist items. This function calls the Anthropic API server-side (so the
// API key never reaches the browser) and returns a SUGGESTED status per item.
//
// A staff member must still confirm every item in the UI — the suggestion never
// counts toward the compliance score on its own (brief §7).
//
// Deploy: see README.md step 6 (Neon Functions deploy — confirm the exact
// command in your Neon console/CLI help; this feature is new).
// Secret:  set ANTHROPIC_API_KEY as a Function environment variable in the
// Neon console (Functions > audit-suggest > Environment variables).
//
// If ANTHROPIC_API_KEY is not set, the function returns 200 with
// { disabled: true } and the UI falls back to fully manual review.

import { createRemoteJWKSet, jwtVerify } from 'jose'
import { Client } from 'pg'

const MODEL = 'claude-sonnet-5'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

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

async function isStaff(userId) {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query('select role from profiles where id = $1', [userId])
    return rows[0]?.role === 'staff'
  } finally {
    await client.end()
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

    try {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) return json({ disabled: true, reason: 'ANTHROPIC_API_KEY not configured' })

      const userId = await verifyCaller(request)
      if (!userId) return json({ error: 'unauthorised' }, 401)
      if (!(await isStaff(userId))) return json({ error: 'forbidden' }, 403)

      const { documentText, items } = await request.json()
      if (!documentText || !Array.isArray(items) || items.length === 0) {
        return json({ error: 'documentText and items[] are required' }, 400)
      }

      // Keep the prompt bounded.
      const text = documentText.slice(0, 120_000)
      const itemList = items
        .map((it, i) => `${i + 1}. [${it.id}] (${it.category ?? 'General'}) ${it.item_text}` +
          (it.regulation_reference ? `  — ref: ${it.regulation_reference}` : ''))
        .join('\n')

      const system =
        'You are a South African OHS safety-file auditor assistant. You are given the extracted ' +
        'text of a contractor/company safety file and a checklist. For EACH checklist item decide ' +
        'whether the uploaded file appears to satisfy it. Output STRICT JSON only.\n' +
        'status must be one of: "compliant" (clearly present and adequate), "partial" (present but ' +
        'incomplete/outdated/unsigned), "non_compliant" (absent or inadequate), "not_applicable".\n' +
        'Be conservative: if you cannot find clear evidence, use "non_compliant" or "partial", never ' +
        '"compliant". Include a one-sentence rationale and, where possible, the page or section where ' +
        'you found evidence. Never invent content that is not in the text.'

      const user =
        `CHECKLIST ITEMS:\n${itemList}\n\n` +
        `SAFETY FILE TEXT (may be truncated):\n"""\n${text}\n"""\n\n` +
        'Return JSON of shape: {"results":[{"id":"<item id>","status":"...","rationale":"...","page_ref":"..."}]}'

      const resp = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4000,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      })

      if (!resp.ok) {
        const detail = await resp.text()
        return json({ error: 'anthropic_error', detail: detail.slice(0, 500) }, 502)
      }
      const data = await resp.json()
      const raw = (data?.content?.[0]?.text ?? '').trim()
      const parsed = safeParseJson(raw)
      if (!parsed?.results) return json({ error: 'bad_model_output', raw: raw.slice(0, 500) }, 502)

      return json({ disabled: false, results: parsed.results })
    } catch (e) {
      return json({ error: String(e) }, 500)
    }
  },
}

// The app is served from GitHub Pages, a different origin from this Function
// — every call is cross-origin, so CORS headers are required on every
// response (including errors) and the preflight OPTIONS request must be
// answered directly, or the browser blocks the request before it reaches
// the handler above.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })
}

function safeParseJson(s) {
  try { return JSON.parse(s) } catch { /* fall through */ }
  const m = s.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { /* ignore */ } }
  return null
}
