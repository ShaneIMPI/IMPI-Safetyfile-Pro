import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { db } from '../../lib/db.js'
import { useQuery } from '../../hooks/useQuery.js'
import { Spinner, ErrorBanner, Toolbar } from '../../components/ui.jsx'
import { fmtDate, refSortKey } from '../../lib/format.js'

async function load() {
  const [rows, clients] = await Promise.all([
    supabase.from('document_control_register').select('*').then(({ data, error }) => { if (error) throw error; return data }),
    db.clients(),
  ])
  const cmap = Object.fromEntries(clients.map((c) => [c.id, c.company_name]))
  return { rows: rows.map((r) => ({ ...r, client_name: cmap[r.client_id] || '—' })), clients }
}

export default function DocumentRegisterPage() {
  const { data, loading, error } = useQuery(load, [])
  const [q, setQ] = useState('')
  const [src, setSrc] = useState('')
  const [client, setClient] = useState('')

  const filtered = useMemo(() => {
    if (!data) return []
    return data.rows
      .filter((r) => !src || r.source_type === src)
      .filter((r) => !client || r.client_id === client)
      .filter((r) => {
        if (!q) return true
        const s = q.toLowerCase()
        return [r.document_ref, r.document_title, r.prepared_by, r.status, r.client_name].some((v) => (v || '').toLowerCase().includes(s))
      })
      .sort((a, b) => refSortKey(a.document_ref).localeCompare(refSortKey(b.document_ref)))
  }, [data, q, src, client])

  if (loading) return <Spinner />
  if (error) return <ErrorBanner error={error} />

  function exportCsv() {
    const cols = ['document_ref', 'document_title', 'source_type', 'revision', 'client_name', 'prepared_by', 'reviewed_by', 'approved_by', 'status', 'doc_date']
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [cols.join(','), ...filtered.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `document-control-register-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <header><div className="crumb">Document control</div><h1>Document Control Register</h1></header>
      <p className="muted">Every generated and evidence document ever produced or filed. Derived automatically — not entered here.</p>

      <Toolbar>
        <input className="grow" placeholder="Search ref, title, party, status…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={src} onChange={(e) => setSrc(e.target.value)}>
          <option value="">All sources</option>
          <option value="generated">Generated</option>
          <option value="evidence">Evidence</option>
        </select>
        <select value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">All clients</option>
          {data.clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <button className="btn-secondary" onClick={exportCsv}>Export CSV</button>
      </Toolbar>

      <div className="panel" style={{ padding: 0 }}>
        <table className="data">
          <thead>
            <tr><th>Ref</th><th>Title</th><th>Source</th><th>Rev</th><th>Client</th><th>Prepared by / issuing body</th><th>Reviewed</th><th>Approved</th><th>Status</th><th>Date</th></tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.document_ref}>
                <td className="mono">{r.document_ref}</td>
                <td>{r.document_title}</td>
                <td><span className={`pill ${r.source_type === 'generated' ? 'status-final' : 'status-pending_review'}`}>{r.source_type}</span></td>
                <td>{r.revision ?? '—'}</td>
                <td>{r.client_name}</td>
                <td>{r.prepared_by || '—'}</td>
                <td>{r.reviewed_by || '—'}</td>
                <td>{r.approved_by || '—'}</td>
                <td><span className={`pill status-${r.status}`}>{r.status}</span></td>
                <td>{fmtDate(r.doc_date)}</td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>No documents match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
