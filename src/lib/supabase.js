import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

if (!isConfigured) {
  // Not fatal — the app renders a setup notice instead of a blank screen.
  console.warn(
    '[IMPI] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. ' +
      'Copy .env.example to .env.local (see README).',
  )
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
  auth: { persistSession: true, autoRefreshToken: true },
})

// Upload a File/Blob to a bucket and return its stored path + a usable URL.
export async function uploadFile(bucket, path, file, { upsert = true } = {}) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert,
    contentType: file.type || undefined,
  })
  if (error) throw error
  if (bucket === 'logos') {
    return { path, url: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl }
  }
  const { data, error: sErr } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 7)
  if (sErr) throw sErr
  return { path, url: data.signedUrl }
}

export async function signedUrl(bucket, path, seconds = 3600) {
  if (!path) return null
  if (bucket === 'logos') return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds)
  if (error) throw error
  return data.signedUrl
}

export async function downloadFile(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error) throw error
  return data // Blob
}
