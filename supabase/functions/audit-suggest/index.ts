// audit-suggest — Supabase Edge Function
//
// The browser sends: extracted text from the client's uploaded safety file +
// the checklist items. This function calls the Anthropic API server-side (so the
// API key never reaches the browser) and returns a SUGGESTED status per item.
//
// A staff member must still confirm every item in the UI — the suggestion never
// counts toward the compliance score on its own (brief §7).
//
// Deploy:  supabase functions deploy audit-suggest
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// If ANTHROPIC_API_KEY is not set, the function returns 200 with
// { disabled: true } and the UI falls back to fully manual review.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const MODEL = 'claude-sonnet-5'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return json({ disabled: true, reason: 'ANTHROPIC_API_KEY not configured' })
    }

    // Require an authenticated staff caller.
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return json({ error: 'unauthorised' }, 401)
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', userData.user.id).single()
    if (profile?.role !== 'staff') return json({ error: 'forbidden' }, 403)

    const { documentText, items } = await req.json() as {
      documentText: string
      items: { id: string; item_text: string; category?: string; regulation_reference?: string }[]
    }
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
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  })
}

function safeParseJson(s: string) {
  try { return JSON.parse(s) } catch { /* fall through */ }
  const m = s.match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { /* ignore */ } }
  return null
}
