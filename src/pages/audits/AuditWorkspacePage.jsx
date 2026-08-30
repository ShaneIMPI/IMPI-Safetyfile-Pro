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
  const [items, results, evidence] = await Promise.all([
    supabase.from('checklist_items').select('*, document_templates(id, name, type_code, source_type)')
      .eq('checklist_id', audit.checklist_id).order('sort_order').then(({ data }) => data ?? []),
    db.auditResults(id),
    supabase.from('evidence_documents')
      .select('*, evidence_document_files(id, file_url, file_name)')
      .eq('audit_id', id).order('created_at').then(({ data }) => data ?? []),
  ])
  return { audit, items, results, evidence }
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
    const evByItem = new Map()
    for (const e of data.evidence ?? []) {
      if (!e.checklist_item_id) continue
      if (!evByItem.has(e.checklist_item_id)) evByItem.set(e.checklist_item_id, [])
      evByItem.get(e.checklist_item_id).push(e)
    }
    return data.items.map((it) => ({
      item: it,
      result: byItem.get(it.id) || { checklist_item_id: it.id },
      evidence: evByItem.get(it.id) ?? [],
    }))
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
              {merged.filter((m) => m.item.category === cat).map(({ item, result, evidence }) => {
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
                      {isEvidence
                        ? <>
                            {(needsGap || evidence.length > 0) && (
                              <button className="btn-gold btn-sm" onClick={() => setEvidenceFor(item)}>
                                {evidence.length ? '+ Add evidence' : 'Request / upload evidence'}
                              </button>
                            )}
                            <EvidenceEntryList entries={evidence} />
                          </>
                        : needsGap && (
                            <Link className="btn btn-sm btn-secondary" to={`/documents?client=${audit.client_id}&item=${item.id}`}>Generate document</Link>
                          )}
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

// Compact list of the evidence entries already filed against one checklist item.
// A checklist item may carry several separate entries (e.g. one per crew member).
function EvidenceEntryList({ entries }) {
  if (!entries?.length) return null
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', fontSize: '0.78rem' }}>
      {entries.map((e) => {
        const files = e.evidence_document_files ?? []
        return (
          <li key={e.id} style={{ borderTop: '1px solid var(--rule)', padding: '4px 0' }}>
            <span className="mono">{e.document_ref}</span>{' '}
            <span className={`pill status-${e.status}`} style={{ fontSize: '0.66rem' }}>{e.status}</span>
            <div className="muted">
              {e.issuing_body || '—'}{e.certificate_number ? ` · ${e.certificate_number}` : ''}
              {e.expiry_date ? ` · exp ${e.expiry_date}` : ''}
            </div>
            <div>
              {files.length === 0
                ? <span className="muted">no files</span>
                : files.map((f, i) => (
                    <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>
                      {f.file_name || `file ${i + 1}`}
                    </a>
                  ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const blankEntry = (title) => ({
  title, issuing_body: '', certificate_number: '', issue_date: '', expiry_date: '', files: [],
})

// One modal can create SEVERAL separate evidence_documents rows against the same
// checklist item ("+ Add another certificate"), each with its own metadata and
// its own set of files (front/back scan, multi-page report).
function EvidenceUploadModal({ audit, item, profileId, onClose, onDone }) {
  const { busy, error, runAction } = useAsyncAction()
  const [entries, setEntries] = useState([blankEntry(item.item_text)])

  const setEntry = (idx, patch) =>
    setEntries((es) => es.map((e, i) => (i === idx ? { ...e, ...patch } : e)))
  const addEntry = () => setEntries((es) => [...es, blankEntry(item.item_text)])
  const removeEntry = (idx) => setEntries((es) => es.filter((_, i) => i !== idx))

  async function save() {
    await runAction(async () => {
      for (const entry of entries) {
        const row = await db.insert('evidence_documents', {
          client_id: audit.client_id, checklist_item_id: item.id, audit_id: audit.id,
          title: entry.title || item.item_text,
          issuing_body: entry.issuing_body || null,
          certificate_number: entry.certificate_number || null,
          issue_date: entry.issue_date || null,
          expiry_date: entry.expiry_date || null,
          status: 'pending_review', uploaded_by: profileId ?? null,
        })
        for (let i = 0; i < entry.files.length; i++) {
          const file = entry.files[i]
          const path = `${audit.client_id}/${row.document_ref}/${String(i + 1).padStart(2, '0')}-${file.name}`
          const { url } = await uploadFile('evidence', path, file)
          await db.insert('evidence_document_files', {
            evidence_document_id: row.id, file_url: url, file_name: file.name,
          })
        }
      }
      onDone()
    })
  }

  return (
    <Modal
      title="Evidence for this checklist item"
      wide
      onClose={onClose}
      actions={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button disabled={busy} onClick={save}>
          {busy ? 'Saving…' : `Add ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
        </button>
      </>}
    >
      <ErrorBanner error={error} />
      <p className="muted" style={{ marginTop: 0 }}>
        Third-party issued — IMPI files it, never authors it. Each entry is one certificate / instance
        (one issuing body, one number, one expiry) and enters as <strong>pending review</strong>.
        Attach multiple files to a single entry for a front/back or multi-page scan. Use
        <strong> + Add another certificate</strong> for a genuinely separate certificate
        (e.g. one per crew member).
      </p>

      {entries.map((entry, idx) => (
        <div key={idx} className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-title">
            <strong>Entry {idx + 1}</strong>
            {entries.length > 1 && (
              <button className="btn-ghost btn-sm" onClick={() => removeEntry(idx)}>Remove</button>
            )}
          </div>
          <Field label="Title"><input value={entry.title} onChange={(e) => setEntry(idx, { title: e.target.value })} /></Field>
          <div className="field-row">
            <Field label="Issuing body"><input value={entry.issuing_body} onChange={(e) => setEntry(idx, { issuing_body: e.target.value })} /></Field>
            <Field label="Certificate number"><input value={entry.certificate_number} onChange={(e) => setEntry(idx, { certificate_number: e.target.value })} /></Field>
          </div>
          <div className="field-row">
            <Field label="Issue date"><input type="date" value={entry.issue_date} onChange={(e) => setEntry(idx, { issue_date: e.target.value })} /></Field>
            <Field label="Expiry date" hint="Drives re-flagging when it lapses."><input type="date" value={entry.expiry_date} onChange={(e) => setEntry(idx, { expiry_date: e.target.value })} /></Field>
          </div>
          <Field label="File(s)" hint="Select one or more — all attach to this entry.">
            <input type="file" multiple onChange={(e) => setEntry(idx, { files: Array.from(e.target.files ?? []) })} />
          </Field>
          {entry.files.length > 0 && (
            <div className="muted" style={{ fontSize: '0.78rem' }}>
              {entry.files.map((f) => f.name).join(', ')}
            </div>
          )}
        </div>
      ))}

      <button className="btn-secondary btn-sm" onClick={addEntry}>+ Add another certificate</button>
    </Modal>
  )
}
