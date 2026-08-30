export function fmtDate(d) {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: '2-digit' })
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function isExpired(dateStr) {
  if (!dateStr) return false
  return new Date(dateStr) < new Date(new Date().toDateString())
}

export function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86_400_000)
}

// Turn "IMPI-RA-ABCRIG-2026-003-Rev2" style refs into a stable sortable key.
export function refSortKey(ref) {
  return (ref || '').replace(/(\d+)/g, (m) => m.padStart(6, '0'))
}

export const AUDIT_STATUS_LABELS = {
  compliant: 'Compliant',
  partial: 'Partial',
  non_compliant: 'Non-compliant',
  not_applicable: 'N/A',
  not_reviewed: 'Not reviewed',
}
