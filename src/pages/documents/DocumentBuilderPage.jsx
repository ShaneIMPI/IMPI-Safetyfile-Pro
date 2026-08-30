import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase, uploadFile } from '../../lib/supabase.js'
import { db } from '../../lib/db.js'
import { useAuth } from '../../auth/AuthProvider.jsx'
import { useQuery, useAsyncAction } from '../../hooks/useQuery.js'
import { Spinner, ErrorBanner, Field, ConfirmButton } from '../../components/ui.jsx'
import { today } from '../../lib/format.js'
import { generatorFor } from '../../docgen/index.js'
import { saveDocx, docxBlob } from '../../docgen/shared.js'
import QuestionnaireForm from './QuestionnaireForm.jsx'

async function loadBuilder() {
  const [clients, sectors, templates, tSectors, hazards, methods] = await Promise.all([
    db.clients(), db.sectors(), db.templates({ activeOnly: true, sourceType: 'generated' }),
    db.templateSectors(), db.hazardLibrary(), db.methodLibrary(),
  ])
  return { clients, sectors, templates, tSectors, hazards, methods }
}

export default function DocumentBuilderPage() {
  const [params] = useSearchParams()
  const { profile } = useAuth()
  const { data, loading, error } = useQuery(loadBuilder, [])
  const { busy, error: genErr, runAction } = useAsyncAction()

  const [clientId, setClientId] = useState(params.get('client') || '')
  const [templateId, setTemplateId] = useState('')
  const [responses, setResponses] = useState({})
  const [libRows, setLibRows] = useState([])
  const [control, setControl] = useState({
    revision_date: today(), prepared_by: '', reviewed_by: '', approved_by: '', status: 'Draft',
    site_project_name: '',
  })
  const [result, setResult] = useState(null)
  const clientSectorIds = useClientSectors(clientId)

  if (loading) return <Spinner />
  if (error) return <ErrorBanner error={error} />

  const client = data.clients.find((c) => c.id === clientId)
  const template = data.templates.find((t) => t.id === templateId)

  // Templates available for the chosen client's sectors (fallback: all).
  // The Audit Report (AUD) is produced from the Audit screen, not here.
  const availableTemplates = data.templates.filter((t) => t.type_code !== 'AUD').filter((t) => {
    const linked = data.tSectors.filter((x) => x.document_template_id === t.id).map((x) => x.sector_id)
    if (linked.length === 0) return true
    if (!clientSectorIds.length) return true
    return linked.some((s) => clientSectorIds.includes(s))
  })

  const schema = Array.isArray(template?.questionnaire_schema) ? template.questionnaire_schema : []
  const dynamicOptions = {
    'hazard_library.activity': [...new Set(data.hazards
      .filter((h) => sectorMatch(h.hazard_library_sectors, clientSectorIds)).map((h) => h.activity))],
    'method_step_library.activity_type': [...new Set(data.methods
      .filter((m) => sectorMatch(m.method_step_library_sectors, clientSectorIds)).map((m) => m.activity_type))],
  }

  function refreshLibraryRows(nextResponses) {
    if (!template) return
    if (template.type_code === 'RA') {
      const activities = nextResponses.activities || []
      const rows = data.hazards
        .filter((h) => activities.includes(h.activity))
        .map((h) => ({
          id: h.id, activity: h.activity, hazard: h.hazard, who_may_be_harmed: h.who_may_be_harmed,
          standard_controls: h.standard_controls, additional_controls: '', responsible: '',
          a: h.default_a, b: h.default_b, c: h.default_c, d: h.default_d,
        }))
      setLibRows(rows)
    } else if (template.type_code === 'MS') {
      const at = nextResponses.activity_type
      const rows = data.methods
        .filter((m) => m.activity_type === at)
        .sort((x, y) => x.sort_hint - y.sort_hint)
        .map((m) => ({ id: m.id, step_description: m.step_description, key_hazards_controls: m.key_hazards_controls, responsible_role_default: m.responsible_role_default }))
      setLibRows(rows)
    }
  }

  const onResponses = (next) => { setResponses(next); refreshLibraryRows(next) }
  const bespoke = template && ['RA', 'MS'].includes(template.type_code)

  async function generate({ finalize }) {
    await runAction(async () => {
      const gen = generatorFor(template.type_code)
      const documentControl = {
        documentRef: 'DRAFT', revision: 1, revisionDate: control.revision_date,
        preparedBy: control.prepared_by, reviewedBy: control.reviewed_by, approvedBy: control.approved_by,
        status: finalize ? 'Final' : control.status, siteProjectName: control.site_project_name,
      }
      const ctx = {
        client, template, responses: { ...responses, site_project_name: control.site_project_name },
        documentControl,
        hazardRows: libRows, stepRows: libRows,
      }

      // Persist questionnaire responses.
      const qr = await db.insert('questionnaire_responses', {
        client_id: clientId, document_template_id: templateId,
        responses, created_by: profile?.id ?? null,
      })

      // Insert the generated_documents row first so the DB trigger assigns the real ref.
      const row = await db.insert('generated_documents', {
        client_id: clientId, document_template_id: templateId,
        questionnaire_response_id: qr.id,
        title: template.name, site_project_name: control.site_project_name,
        prepared_by_name: control.prepared_by, reviewed_by_name: control.reviewed_by,
        approved_by_name: control.approved_by, revision_date: control.revision_date,
        status: finalize ? 'final' : 'draft', generated_by: profile?.id ?? null,
      })

      ctx.documentControl.documentRef = row.document_ref
      ctx.documentControl.revision = row.revision

      const { doc, filename } = await gen.build(ctx)
      const blob = await docxBlob(doc)

      const path = `${clientId}/${row.document_ref}.docx`
      const { url } = await uploadFile('generated', path, new File([blob], filename, { type: blob.type }))
      await db.update('generated_documents', row.id, { file_url: url })

      // Also hand the .docx to the user immediately.
      await saveDocx(doc, filename)

      setResult({ ref: row.document_ref, url, filename })
    })
  }

  async function flagGap() {
    await runAction(async () => {
      await db.insert('library_gap_flags', {
        kind: template.type_code === 'MS' ? 'method_step' : 'hazard',
        sector_id: clientSectorIds[0] || null,
        context: `Client ${client?.company_name}: ${template?.name} — ${JSON.stringify(responses).slice(0, 400)}`,
        proposed: {}, status: 'open',
      })
      alert('Flagged for manual drafting. Resolve it in Hazard / Method Library › Gap flags.')
    })
  }

  return (
    <>
      <header><div className="crumb">Document builder</div><h1>Document Builder</h1></header>
      <ErrorBanner error={genErr} />

      <div className="panel">
        <div className="field-row">
          <Field label="Client *">
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); setTemplateId(''); setResult(null) }}>
              <option value="">— select client —</option>
              {data.clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </Field>
          <Field label="Document template *" hint="Generated (IMPI-authored) templates only.">
            <select value={templateId} disabled={!clientId} onChange={(e) => { setTemplateId(e.target.value); setResponses({}); setLibRows([]); setResult(null) }}>
              <option value="">— select template —</option>
              {availableTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.type_code})</option>)}
            </select>
          </Field>
        </div>
        {template?.description && <p className="muted">{template.description}</p>}
      </div>

      {template && (
        <>
          <div className="panel">
            <div className="panel-title"><h2>Questionnaire</h2></div>
            {schema.length === 0
              ? <p className="muted">This template has no questionnaire fields.</p>
              : <QuestionnaireForm schema={schema} value={responses} onChange={onResponses} dynamicOptions={dynamicOptions} />}
          </div>

          {bespoke && (
            <div className="panel">
              <div className="panel-title">
                <h2>{template.type_code === 'RA' ? 'Risk register lines' : 'Method steps'} — from library</h2>
                <ConfirmButton className="btn-gold btn-sm" confirmLabel="Flag gap?" onConfirm={flagGap}>Library doesn't fit — flag gap</ConfirmButton>
              </div>
              {libRows.length === 0
                ? <p className="muted">Select {template.type_code === 'RA' ? 'activities' : 'an activity'} above to pull matching library entries. Edit them here before generating.</p>
                : <LibRowEditor typeCode={template.type_code} rows={libRows} onChange={setLibRows} />}
            </div>
          )}

          <div className="panel">
            <div className="panel-title"><h2>Document control</h2></div>
            <div className="field-row">
              <Field label="Site / project name"><input value={control.site_project_name} onChange={(e) => setControl({ ...control, site_project_name: e.target.value })} /></Field>
              <Field label="Revision date"><input type="date" value={control.revision_date} onChange={(e) => setControl({ ...control, revision_date: e.target.value })} /></Field>
              <Field label="Status"><input value={control.status} onChange={(e) => setControl({ ...control, status: e.target.value })} /></Field>
            </div>
            <div className="field-row">
              <Field label="Prepared by"><input value={control.prepared_by} onChange={(e) => setControl({ ...control, prepared_by: e.target.value })} /></Field>
              <Field label="Reviewed by"><input value={control.reviewed_by} onChange={(e) => setControl({ ...control, reviewed_by: e.target.value })} /></Field>
              <Field label="Approved by"><input value={control.approved_by} onChange={(e) => setControl({ ...control, approved_by: e.target.value })} /></Field>
            </div>
          </div>

          <div className="toolbar">
            <button className="btn-secondary" disabled={busy} onClick={() => generate({ finalize: false })}>{busy ? 'Generating…' : 'Generate draft .docx'}</button>
            <button disabled={busy} onClick={() => generate({ finalize: true })}>{busy ? 'Generating…' : 'Generate & finalize'}</button>
          </div>

          {result && (
            <div className="notice">
              Generated <span className="mono">{result.ref}</span>. The .docx download has started; a copy is filed under the client.
              {' '}<a href={result.url} target="_blank" rel="noreferrer">Open stored copy</a>
            </div>
          )}
        </>
      )}
    </>
  )
}

function sectorMatch(links, clientSectorIds) {
  if (!clientSectorIds.length) return true
  const ids = (links || []).map((x) => x.sector_id)
  if (!ids.length) return true
  return ids.some((s) => clientSectorIds.includes(s))
}

function useClientSectors(clientId) {
  const { data } = useQuery(async () => {
    if (!clientId) return []
    const { data } = await supabase.from('client_sectors').select('sector_id').eq('client_id', clientId)
    return (data ?? []).map((r) => r.sector_id)
  }, [clientId])
  return data ?? []
}

function LibRowEditor({ typeCode, rows, onChange }) {
  const set = (i, k, v) => onChange(rows.map((r, ri) => (ri === i ? { ...r, [k]: v } : r)))
  const del = (i) => onChange(rows.filter((_, ri) => ri !== i))
  if (typeCode === 'MS') {
    return (
      <ol style={{ paddingLeft: '1.2rem' }}>
        {rows.map((r, i) => (
          <li key={i} style={{ marginBottom: 10 }}>
            <textarea value={r.step_description} onChange={(e) => set(i, 'step_description', e.target.value)} />
            <input style={{ marginTop: 4 }} placeholder="Key hazards & controls" value={r.key_hazards_controls || ''} onChange={(e) => set(i, 'key_hazards_controls', e.target.value)} />
            <div style={{ marginTop: 4, display: 'flex', gap: 8 }}>
              <input placeholder="Responsible" value={r.responsible_role_default || ''} onChange={(e) => set(i, 'responsible_role_default', e.target.value)} />
              <button className="btn-ghost btn-sm" onClick={() => del(i)}>Remove</button>
            </div>
          </li>
        ))}
      </ol>
    )
  }
  return (
    <table className="data">
      <thead><tr><th>Activity</th><th>Hazard</th><th>Controls</th><th>A</th><th>B</th><th>C</th><th>D</th><th>Additional controls</th><th /></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td><input value={r.activity} onChange={(e) => set(i, 'activity', e.target.value)} /></td>
            <td><input value={r.hazard} onChange={(e) => set(i, 'hazard', e.target.value)} /></td>
            <td><textarea style={{ minHeight: '3rem' }} value={r.standard_controls} onChange={(e) => set(i, 'standard_controls', e.target.value)} /></td>
            {['a', 'b', 'c', 'd'].map((k) => (
              <td key={k} style={{ width: 44 }}><input type="number" min={1} max={5} value={r[k]} onChange={(e) => set(i, k, e.target.value)} /></td>
            ))}
            <td><textarea style={{ minHeight: '3rem' }} value={r.additional_controls} onChange={(e) => set(i, 'additional_controls', e.target.value)} /></td>
            <td><button className="btn-ghost btn-sm" onClick={() => del(i)}>✕</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
