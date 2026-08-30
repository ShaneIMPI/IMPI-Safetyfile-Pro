import { useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../../lib/db.js'
import { useQuery, useAsyncAction } from '../../hooks/useQuery.js'
import { Spinner, ErrorBanner, Modal, Field, Toolbar } from '../../components/ui.jsx'
import { fmtDate } from '../../lib/format.js'

export default function ClientsPage() {
  const { data, loading, error, refetch } = useQuery(() => db.clients(), [])
  const [creating, setCreating] = useState(false)
  const [q, setQ] = useState('')

  if (loading) return <Spinner />
  if (error) return <ErrorBanner error={error} />

  const rows = data.filter((c) =>
    !q || c.company_name.toLowerCase().includes(q.toLowerCase()) || (c.client_code || '').toLowerCase().includes(q.toLowerCase()),
  )

  return (
    <>
      <header><div className="crumb">Client management</div><h1>Clients</h1></header>
      <Toolbar>
        <input className="grow" placeholder="Search company or code…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={() => setCreating(true)}>New client</button>
      </Toolbar>

      <div className="panel" style={{ padding: 0 }}>
        <table className="data">
          <thead><tr><th>Company</th><th>Code</th><th>Contact</th><th>Reg. no</th><th>Added</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/clients/${c.id}`}>{c.company_name}</Link></td>
                <td className="mono">{c.client_code}</td>
                <td>{c.contact_person || '—'}<br /><span className="muted">{c.contact_email}</span></td>
                <td>{c.registration_no || '—'}</td>
                <td>{fmtDate(c.created_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: '1.5rem', textAlign: 'center' }}>No clients.</td></tr>}
          </tbody>
        </table>
      </div>

      {creating && <ClientCreateModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refetch() }} />}
    </>
  )
}

function ClientCreateModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    company_name: '', client_code: '', registration_no: '', address: '',
    contact_person: '', contact_email: '', contact_phone: '',
  })
  const { busy, error, runAction } = useAsyncAction()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function save() {
    await runAction(async () => {
      const payload = { ...form }
      if (!payload.client_code) delete payload.client_code
      await db.insert('clients', payload)
      onSaved()
    })
  }

  return (
    <Modal
      title="New client"
      onClose={onClose}
      actions={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button disabled={busy || !form.company_name} onClick={save}>{busy ? 'Saving…' : 'Create'}</button>
      </>}
    >
      <ErrorBanner error={error} />
      <Field label="Company name *"><input value={form.company_name} onChange={set('company_name')} /></Field>
      <div className="field-row">
        <Field label="Client code" hint="Leave blank to auto-generate from the company name.">
          <input value={form.client_code} onChange={set('client_code')} placeholder="AUTO" />
        </Field>
        <Field label="Registration no."><input value={form.registration_no} onChange={set('registration_no')} /></Field>
      </div>
      <Field label="Address"><textarea value={form.address} onChange={set('address')} /></Field>
      <div className="field-row">
        <Field label="Contact person"><input value={form.contact_person} onChange={set('contact_person')} /></Field>
        <Field label="Contact email"><input value={form.contact_email} onChange={set('contact_email')} /></Field>
        <Field label="Contact phone"><input value={form.contact_phone} onChange={set('contact_phone')} /></Field>
      </div>
    </Modal>
  )
}
