import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase, uploadFile } from '../../lib/supabase.js'
import { db } from '../../lib/db.js'
import { useAuth } from '../../auth/AuthProvider.jsx'
import { useQuery, useAsyncAction } from '../../hooks/useQuery.js'
import { Spinner, ErrorBanner, Modal, Field, StatusPill } from '../../components/ui.jsx'
import { fmtDate } from '../../lib/format.js'
import { extractPdfText } from '../../lib/pdf.js'
import { auditReport } from '../../docgen/index.js'
import { docxBlob, saveDocx } from '../../docgen/shared.js'

const STATUSES = ['compliant', 'partial', 'non_compliant', 'not_applicable']

async function load(id) {
  const audit = await db.audit(id)
  const [items, results] = await Promise.all([
    supabase.from('checklist_items').select('*, document_templates(id, name, type_code, source_type)')
      .eq('checklist_id', audit.checklist_id).order('sort_order').then(({ data }) => data ?? []),
    db.auditResults(id),
  ])
  return { audit, items, results }
}

export default function AuditWorkspacePage() {
  const { id } = useParams()
  const { profile } = useAuth()
  const { data, loading, error, refetch } = useQuery(() => load(id), [id])
  const { busy, error: actErr, runAction } = useAsyncAction()
  const [aiState, setAiState] = useState(null) // null | 'running' | 'done' | 'disabled'
  const [evidenceFor, setEvidenceFor] = useState(null)
  const [reportUrl, setReportUrl] = useState(null)

  const merged = useMemo(() => {
    if (!data) return []
    const byItem = new Map(data.results.map((r) => [r.checklist_item_id, r]))
    return data.items.map((it) => ({ item: it, result: byItem.get(it.id) || { checklist_item_id: it.id } }))
  }, [data])

  if (loading) return <Spinner />
  if (error) return <ErrorBanner error={error} />

  const { audit } = data
  const confirmed = merged.filter((m) => m.result.reviewed_at)
  const cats = [...new Set(merged.map((m) => m.item.category))]

  async function runAi() {
    setAiState('running')
    try {
      const fileUrl = audit.uploaded_file_url
      if (!fileUrl) { setAiState('disabled'); return }
      const blob = await (await fetch(fileUrl)).blob()
      const text = await extractPdfText(blob)
      const items = merged.map((m) => ({
        id: m.item.id, item_text: m.item.item_text, category: m.item.category,
        regulation_reference: m.item.regulation_reference,
      }))
      const { data: resp, error: fnErr } = await supabase.functions.invoke('audit-suggest', { body: { documentText: text, items } })
      if (fnErr) throw fnErr
      if (resp?.disabled) { setAiState('disabled'); return }
      const map = new Map((resp.results || []).map((r) => [r.id, r]))
      for (const m of merged) {
        const s = map.get(m.item.id)
        if (!s) continue
        await supabase.from('audit_results')
          .update({ ai_suggested_status: normalise(s.status), ai_rationale: [s.rationale, s.page_ref && `(${s.page_ref})`].filter(Boolean).join(' ') })
          .eq('audit_id', id).eq('checklist_item_id', m.item.id)
      }
      setAiState('done')
      refetch()
    } catch (e) {
      setAiState('error')
      alert(`AI suggestion failed: ${e.message || e}`)
    }
  }

  async function patchResult(itemId, patch) {
    await runAction(async () => {
      await supabase.from('audit_results').update(patch).eq('audit_id', id).eq('checklist_item_id', itemId)
      refetch()
    })
  }
  const confirm = (itemId, status) =>
    patchResult(itemId, { status, reviewed_by: profile?.id ?? null, reviewed_at: new Date().toISOString() })

  async function generateReport() {
    await runAction(async () => {
      const client = audit.clients
      const row = await db.insert('generated_documents', {
        client_id: audit.client_id,
        document_template_id: (await templateIdByCode('AUD')),
        audit_id: id, title: 'Safety File Audit Report',
        site_project_name: audit.site_project_name || '',
        prepared_by_name: profile?.full_name || '', status: 'draft', generated_by: profile?.id ?? null,
      })
      const results = merged.map((m) => ({
        category: m.item.category, item_text: m.item.item_text, regulation_reference: m.item.regulation_reference,
        severity_weight: m.item.severity_weight, status: m.result.status || 'not_reviewed',
        reviewer_notes: m.result.reviewer_notes, action_required: m.result.action_required,
        confirmed: Boolean(m.result.reviewed_at),
      }))
      const { doc, filename } = await auditReport.build({
        client, audit: { ...audit, audited_by_name: profile?.full_name }, checklist: audit.checklists, results,
        documentControl: { documentRef: row.document_ref, revision: row.revision, preparedBy: profile?.full_name, status: 'Draft' },
      })
      const blob = await docxBlob(doc)
      const { url } = await uploadFile('generated', `${audit.client_id}/${row.document_ref}.docx`, new File([blob], filename, { type: blob.type }))
      await db.update('generated_documents', row.id, { file_url: url })
      await saveDocx(doc, filename)
      setReportUrl(url)
    })
  }

  return (
    <>
      <header>
        <div className="crumb"><Link to="/audits">Audits</Link> / {audit.clients?.company_name}</div>
        <h1>{audit.clients?.company_name} — {audit.checklists?.name}</h1>
        <div className="muted">{fmtDate(audit.audit_date)} · {confirmed.length}/{merged.length} items confirmed · Score {audit.overall_score == null ? '—' : `${audit.overall_score}%`}</div>
      </header>
      <ErrorBanner error={actErr} />

      <div className="toolbar">
        {audit.uploaded_file_url
          ? <a className="btn btn-secondary btn-sm" href={audit.uploaded_file_url} target="_blank" rel="noreferrer">View uploaded file</a>
          : <span className="muted">No file uploaded — manual review.</span>}
        <button className="btn-secondary btn-sm" disabled={!audit.uploaded_file_url || aiState === 'running'} onClick={runAi}>
          {aiState === 'running' ? 'Analysing…' : 'Extract text & get AI suggestions'}
        </button>
        <div className="grow" />
        <button className="btn-secondary btn-sm" disabled={busy} onClick={generateReport}>Generate Audit Report</button>
        <button className="btn-sm" disabled={busy || confirmed.length === 0}
          onClick={() => runAction(async () => { await db.update('audits', id, { status: audit.status === 'complete' ? 'in_progress' : 'complete' }); refetch() })}>
          {audit.status === 'complete' ? 'Reopen audit' : 'Mark audit complete'}
        </button>
      </div>

      {aiState === 'disabled' && <div className="notice">AI suggestions are not configured (no <span className="mono">ANTHROPIC_API_KEY</span> on the Edge Function). Review every item manually — see DECISIONS.md item 2.</div>}
      {aiState === 'done' && <div className="notice">AI suggestions loaded. Each is a hint only — nothing counts toward the score until you press <strong>Confirm</strong>.</div>}
      {reportUrl && <div className="notice">Audit report generated. <a href={reportUrl} target="_blank" rel="noreferrer">Open stored copy</a></div>}

      {cats.map((cat) => (
        <div className="panel" key={cat}>
          <div className="panel-title"><h2>{cat}</h2></div>
          <table className="data">
            <thead>
              <tr><th style={{ width: '26%' }}>Item</th><th>AI suggestion</th><th>Status</th><th>Notes / action required</th><th>Gap</th><th /></tr>
            </thead>
            <tbody>
              {merged.filter((m) => m.item.category === cat).map(({ item, result }) => {
                const isEvidence = item.source_type === 'evidence'
                const needsGap = result.reviewed_at && ['partial', 'non_compliant'].includes(result.status)
                return (
                  <tr key={item.id} style={result.reviewed_at ? { background: '#f2f8f1' } : undefined}>
                    <td>
                      {item.item_text}
                      <div className="muted" style={{ fontSize: '0.78rem' }}>
                        {item.regulation_reference} · <span className={`pill ${isEvidence ? 'status-pending_review' : 'status-final'}`} style={{ fontSize: '0.68rem' }}>{item.source_type}</span>
                      </div>
                    </td>
                    <td style={{ maxWidth: 220 }}>
                      {result.ai_suggested_status
                        ? <><StatusPill status={result.ai_suggested_status} /><div className="muted" style={{ fontSize: '0.75rem' }}>{result.ai_rationale}</div>
                            {!result.reviewed_at && <button className="btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => confirm(item.id, result.ai_suggested_status)}>Accept</button>}
                          </>
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      <select value={result.status || ''} onChange={(e) => patchResult(item.id, { status: e.target.value || null })}>
                        <option value="">— not set —</option>
                        {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                      </select>
                    </td>
                    <td>
                      <input placeholder="Reviewer notes" defaultValue={result.reviewer_notes || ''}
                        onBlur={(e) => e.target.value !== (result.reviewer_notes || '') && patchResult(item.id, { reviewer_notes: e.target.value })} />
                      <input style={{ marginTop: 4 }} placeholder="Action required" defaultValue={result.action_required || ''}
                        onBlur={(e) => e.target.value !== (result.action_required || '') && patchResult(item.id, { action_required: e.target.value })} />
                    </td>
                    <td>
                      {needsGap && (isEvidence
                        ? <button className="btn-gold btn-sm" onClick={() => setEvidenceFor(item)}>Request / upload evidence</button>
                        : <Link className="btn btn-sm btn-secondary" to={`/documents?client=${audit.client_id}&item=${item.id}`}>Generate document</Link>)}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {result.reviewed_at
                        ? <span className="muted" style={{ fontSize: '0.75rem' }}>✓ {fmtDate(result.reviewed_at)}</span>
                        : <button className="btn-sm" disabled={!result.status} onClick={() => confirm(item.id, result.status)}>Confirm</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      {evidenceFor && (
        <EvidenceUploadModal audit={audit} item={evidenceFor} profileId={profile?.id}
          onClose={() => setEvidenceFor(null)} onDone={() => { setEvidenceFor(null); refetch() }} />
      )}
    </>
  )
}

const normalise = (s) => (STATUSES.includes(s) ? s : s === 'compliant' ? 'compliant' : 'non_compliant')

async function templateIdByCode(code) {
  const { data } = await supabase.from('document_templates').select('id').eq('type_code', code).single()
  return data?.id
}

function EvidenceUploadModal({ audit, item, profileId, onClose, onDone }) {
  const { busy, error, runAction } = useAsyncAction()
  const [form, setForm] = useState({ title: item.item_text, issuing_body: '', certificate_number: '', issue_date: '', expiry_date: '' })
  const [file, setFile] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function save() {
    await runAction(async () => {
      const row = await db.insert('evidence_documents', {
        client_id: audit.client_id, checklist_item_id: item.id, audit_id: audit.id,
        title: form.title, issuing_body: form.issuing_body || null, certificate_number: form.certificate_number || null,
        issue_date: form.issue_date || null, expiry_date: form.expiry_date || null,
        status: 'pending_review', uploaded_by: profileId ?? null,
      })
      if (file) {
        const { url } = await uploadFile('evidence', `${audit.client_id}/${row.document_ref}/${file.name}`, file)
        await db.update('evidence_documents', row.id, { file_url: url })
      }
      onDone()
    })
  }

  return (
    <Modal title="Evidence document" onClose={onClose}
      actions={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add evidence'}</button></>}>
      <ErrorBanner error={error} />
      <p className="muted" style={{ marginTop: 0 }}>Third-party issued — IMPI files it, never authors it. It enters as <strong>pending review</strong>.</p>
      <Field label="Title"><input value={form.title} onChange={set('title')} /></Field>
      <div className="field-row">
        <Field label="Issuing body"><input value={form.issuing_body} onChange={set('issuing_body')} /></Field>
        <Field label="Certificate number"><input value={form.certificate_number} onChange={set('certificate_number')} /></Field>
      </div>
      <div className="field-row">
        <Field label="Issue date"><input type="date" value={form.issue_date} onChange={set('issue_date')} /></Field>
        <Field label="Expiry date" hint="Drives re-flagging when it lapses."><input type="date" value={form.expiry_date} onChange={set('expiry_date')} /></Field>
      </div>
      <Field label="File"><input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
    </Modal>
  )
}
