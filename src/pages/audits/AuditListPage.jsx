import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, uploadFile } from '../../lib/supabase.js'
import { db } from '../../lib/db.js'
import { useAuth } from '../../auth/AuthProvider.jsx'
import { useQuery, useAsyncAction } from '../../hooks/useQuery.js'
import { Spinner, ErrorBanner, Modal, Field, Toolbar } from '../../components/ui.jsx'
import { fmtDate, today } from '../../lib/format.js'

export default function AuditListPage() {
  const { data, loading, error, refetch } = useQuery(() => db.audits(), [])
  const [creating, setCreating] = useState(false)

  if (loading) return <Spinner />
  if (error) return <ErrorBanner error={error} />

  return (
    <>
      <header><div className="crumb">Audit workflow</div><h1>Audits</h1></header>
      <Toolbar><div className="grow" /><button onClick={() => setCreating(true)}>New audit</button></Toolbar>

      <div className="panel" style={{ padding: 0 }}>
        <table className="data">
          <thead><tr><th>Client</th><th>Checklist</th><th>Date</th><th>Status</th><th>Score</th><th /></tr></thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td>{a.clients?.company_name}</td>
                <td>{a.checklists?.name}</td>
                <td>{fmtDate(a.audit_date)}</td>
                <td><span className={`pill status-${a.status === 'complete' ? 'complete' : 'draft'}`}>{a.status}</span></td>
                <td>{a.overall_score == null ? '—' : `${a.overall_score}%`}</td>
                <td><Link to={`/audits/${a.id}`}>Open</Link></td>
              </tr>
            ))}
            {data.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>No audits yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {creating && <NewAuditModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refetch() }} />}
    </>
  )
}

function NewAuditModal({ onClose, onCreated }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { data } = useQuery(async () => {
    const [clients, checklists] = await Promise.all([db.clients(), db.checklists()])
    return { clients, checklists }
  }, [])
  const { busy, error, runAction } = useAsyncAction()
  const [clientId, setClientId] = useState('')
  const [checklistId, setChecklistId] = useState('')
  const [auditDate, setAuditDate] = useState(today())
  const [file, setFile] = useState(null)

  const checklists = data?.checklists ?? []

  async function create() {
    await runAction(async () => {
      const audit = await db.insert('audits', {
        client_id: clientId, checklist_id: checklistId, audit_date: auditDate,
        audited_by: profile?.id ?? null, status: 'in_progress',
      })
      if (file) {
        const { url } = await uploadFile('uploads', `${clientId}/${audit.id}/${file.name}`, file)
        await db.update('audits', audit.id, { uploaded_file_url: url })
      }
      // Seed audit_results with one row per checklist item.
      const { data: items } = await supabase.from('checklist_items').select('id').eq('checklist_id', checklistId)
      if (items?.length) {
        await supabase.from('audit_results').insert(items.map((it) => ({ audit_id: audit.id, checklist_item_id: it.id })))
      }
      onCreated()
      navigate(`/audits/${audit.id}`)
    })
  }

  return (
    <Modal title="New audit" onClose={onClose}
      actions={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button disabled={busy || !clientId || !checklistId} onClick={create}>{busy ? 'Creating…' : 'Create & open'}</button>
      </>}>
      <ErrorBanner error={error} />
      <Field label="Client *">
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">— select —</option>
          {(data?.clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
      </Field>
      <Field label="Checklist *" hint="Pick the checklist for this client's sector / trade.">
        <select value={checklistId} onChange={(e) => setChecklistId(e.target.value)}>
          <option value="">— select —</option>
          {checklists.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div className="field-row">
        <Field label="Audit date"><input type="date" value={auditDate} onChange={(e) => setAuditDate(e.target.value)} /></Field>
        <Field label="Client's existing safety file (PDF)"><input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      </div>
    </Modal>
  )
}
