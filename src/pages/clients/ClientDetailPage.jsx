import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase, uploadFile } from '../../lib/supabase.js'
import { db } from '../../lib/db.js'
import { useQuery, useAsyncAction } from '../../hooks/useQuery.js'
import { Spinner, ErrorBanner, Field } from '../../components/ui.jsx'
import { fmtDate, isExpired } from '../../lib/format.js'
import { useAuth } from '../../auth/AuthProvider.jsx'

async function loadClientBundle(id) {
  const [client, sectors, links, generated, evidence, files] = await Promise.all([
    db.client(id),
    db.sectors(),
    supabase.from('client_sectors').select('sector_id').eq('client_id', id).then(({ data }) => data ?? []),
    db.generatedDocs(id),
    db.evidenceDocs(id),
    db.safetyFiles(id),
  ])
  return { client, sectors, linkedSectorIds: links.map((l) => l.sector_id), generated, evidence, files }
}

export default function ClientDetailPage() {
  const { id } = useParams()
  const { data, loading, error, refetch } = useQuery(() => loadClientBundle(id), [id])
  const { busy, error: saveErr, runAction } = useAsyncAction()
  const [form, setForm] = useState(null)

  if (loading) return <Spinner />
  if (error) return <ErrorBanner error={error} />

  const c = form ?? data.client
  const set = (k) => (e) => setForm({ ...c, [k]: e.target.value })

  async function save() {
    await runAction(async () => {
      await db.update('clients', id, {
        company_name: c.company_name, client_code: c.client_code, registration_no: c.registration_no,
        address: c.address, contact_person: c.contact_person, contact_email: c.contact_email,
        contact_phone: c.contact_phone,
      })
      setForm(null)
      refetch()
    })
  }

  async function onLogo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    await runAction(async () => {
      const ext = file.name.split('.').pop()
      const { url } = await uploadFile('logos', `${id}/logo-${Date.now()}.${ext}`, file)
      await db.update('clients', id, { logo_url: url })
      refetch()
    })
  }

  async function toggleSector(sectorId, on) {
    await runAction(async () => {
      if (on) await supabase.from('client_sectors').insert({ client_id: id, sector_id: sectorId })
      else await supabase.from('client_sectors').delete().eq('client_id', id).eq('sector_id', sectorId)
      refetch()
    })
  }

  return (
    <>
      <header>
        <div className="crumb"><Link to="/clients">Clients</Link> / {data.client.company_name}</div>
        <h1>{data.client.company_name} <span className="mono muted" style={{ fontSize: '1rem' }}>{data.client.client_code}</span></h1>
      </header>
      <ErrorBanner error={saveErr} />

      <div className="panel">
        <div className="panel-title"><h2>Profile</h2>
          {form
            ? <span><button className="btn-secondary btn-sm" onClick={() => setForm(null)}>Cancel</button>{' '}
                <button className="btn-sm" disabled={busy} onClick={save}>Save</button></span>
            : <button className="btn-secondary btn-sm" onClick={() => setForm(data.client)}>Edit</button>}
        </div>
        <div className="field-row">
          <Field label="Company name"><input disabled={!form} value={c.company_name || ''} onChange={set('company_name')} /></Field>
          <Field label="Client code" hint="Used in document numbering. Change with care."><input disabled={!form} value={c.client_code || ''} onChange={set('client_code')} /></Field>
          <Field label="Registration no."><input disabled={!form} value={c.registration_no || ''} onChange={set('registration_no')} /></Field>
        </div>
        <Field label="Address"><textarea disabled={!form} value={c.address || ''} onChange={set('address')} /></Field>
        <div className="field-row">
          <Field label="Contact person"><input disabled={!form} value={c.contact_person || ''} onChange={set('contact_person')} /></Field>
          <Field label="Contact email"><input disabled={!form} value={c.contact_email || ''} onChange={set('contact_email')} /></Field>
          <Field label="Contact phone"><input disabled={!form} value={c.contact_phone || ''} onChange={set('contact_phone')} /></Field>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title"><h2>Logo</h2></div>
        <p className="muted" style={{ marginTop: 0 }}>
          Primary branding on every generated document (cover + page header). PNG or JPG, ideally on a transparent or white background.
        </p>
        {data.client.logo_url && (
          <img src={data.client.logo_url} alt="logo" style={{ maxHeight: 90, maxWidth: 280, background: '#fff', border: '1px solid var(--rule)', borderRadius: 4, padding: 8 }} />
        )}
        <div style={{ marginTop: 12 }}>
          <input type="file" accept="image/png,image/jpeg" onChange={onLogo} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-title"><h2>Sectors / trades</h2></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {data.sectors.map((s) => {
            const on = data.linkedSectorIds.includes(s.id)
            return (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--rule)', borderRadius: 999, padding: '0.25rem 0.7rem', background: on ? 'var(--risk-low)' : '#fff', cursor: 'pointer' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={on} onChange={(e) => toggleSector(s.id, e.target.checked)} />
                {s.name}
              </label>
            )
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title"><h2>Documents on file</h2>
          <span>
            <Link className="btn btn-sm btn-secondary" to={`/documents?client=${id}`}>Build document</Link>{' '}
            <Link className="btn btn-sm btn-secondary" to={`/assembly?client=${id}`}>Assemble file</Link>
          </span>
        </div>
        <h3>Generated ({data.generated.length})</h3>
        <DocList rows={data.generated.map((g) => ({ ref: g.document_ref, name: g.document_templates?.name, status: g.status, when: g.generated_at, url: g.pdf_url || g.file_url }))} />
        <h3 style={{ marginTop: 16 }}>Evidence ({data.evidence.length})</h3>
        <EvidenceTable rows={data.evidence} onReview={(row, patch) => runAction(async () => { await db.update('evidence_documents', row.id, patch); refetch() })} />
        <h3 style={{ marginTop: 16 }}>Assembled safety files ({data.files.length})</h3>
        <DocList rows={data.files.map((f) => ({ ref: f.document_ref, name: f.title || 'Health & Safety File', status: 'final', when: f.compiled_at, url: f.final_pdf_url }))} />
      </div>
    </>
  )
}

function EvidenceTable({ rows, onReview }) {
  const { profile } = useAuth()
  if (!rows.length) return <div className="muted">None.</div>
  return (
    <table className="data">
      <thead><tr><th>Ref</th><th>Title</th><th>Issuing body</th><th>Cert no.</th><th>Expiry</th><th>Status</th><th>Files</th><th /></tr></thead>
      <tbody>
        {rows.map((e) => {
          const files = e.evidence_document_files ?? []
          return (
          <tr key={e.id}>
            <td className="mono">{e.document_ref}</td>
            <td>{e.title || '—'}</td>
            <td>{e.issuing_body || '—'}</td>
            <td>{e.certificate_number || '—'}</td>
            <td>{e.expiry_date ? <span className={`pill ${isExpired(e.expiry_date) ? 'risk-extreme' : 'risk-low'}`}>{fmtDate(e.expiry_date)}</span> : '—'}</td>
            <td><span className={`pill status-${e.status}`}>{e.status}</span></td>
            <td>
              {files.length === 0
                ? <span className="muted">—</span>
                : files.map((f, i) => (
                    <div key={f.id}>
                      <a href={f.file_url} target="_blank" rel="noreferrer">{f.file_name || `File ${i + 1}`}</a>
                    </div>
                  ))}
            </td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {e.status === 'pending_review' && (
                <>
                  <button className="btn-sm" onClick={() => onReview(e, { status: 'accepted', reviewed_by: profile?.id ?? null })}>Accept</button>{' '}
                  <button className="btn-danger btn-sm" onClick={() => onReview(e, { status: 'rejected', reviewed_by: profile?.id ?? null })}>Reject</button>
                </>
              )}
              {e.status === 'rejected' && (
                <button className="btn-ghost btn-sm" onClick={() => onReview(e, { status: 'pending_review', reviewed_by: null })}>Reopen</button>
              )}
            </td>
          </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function DocList({ rows }) {
  if (!rows.length) return <div className="muted">None.</div>
  return (
    <table className="data">
      <thead><tr><th>Ref</th><th>Title</th><th>Status</th><th>Date</th><th /></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="mono">{r.ref}</td>
            <td>{r.name || '—'}</td>
            <td><span className={`pill status-${r.status}`}>{r.status}</span></td>
            <td>{fmtDate(r.when)}</td>
            <td>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">Open</a> : <span className="muted">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
