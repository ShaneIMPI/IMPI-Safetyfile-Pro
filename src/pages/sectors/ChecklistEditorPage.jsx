import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase.js'
import { db } from '../../lib/db.js'
import { useQuery, useAsyncAction } from '../../hooks/useQuery.js'
import { Spinner, ErrorBanner, Modal, Field, ConfirmButton } from '../../components/ui.jsx'

async function load(id) {
  const [checklist, items, templates] = await Promise.all([
    supabase.from('checklists').select('*, sectors(name)').eq('id', id).single().then(({ data }) => data),
    db.checklistItems(id),
    db.templates({ activeOnly: true }),
  ])
  return { checklist, items, templates }
}

const BLANK = {
  category: 'General', item_text: '', source_type: 'evidence', severity_weight: 3,
  regulation_reference: '', guidance_notes: '', required_document_type_id: '', sort_order: 0,
}

export default function ChecklistEditorPage() {
  const { id } = useParams()
  const { data, loading, error, refetch } = useQuery(() => load(id), [id])
  const { runAction, error: actErr } = useAsyncAction()
  const [editItem, setEditItem] = useState(null)

  if (loading) return <Spinner />
  if (error) return <ErrorBanner error={error} />

  const cats = [...new Set(data.items.map((i) => i.category))]

  async function saveItem(form) {
    await runAction(async () => {
      const payload = {
        ...form,
        checklist_id: id,
        severity_weight: Number(form.severity_weight) || 1,
        sort_order: Number(form.sort_order) || 0,
        required_document_type_id: form.required_document_type_id || null,
      }
      if (form.id) await db.update('checklist_items', form.id, payload)
      else await db.insert('checklist_items', payload)
      setEditItem(null)
      refetch()
    })
  }

  return (
    <>
      <header>
        <div className="crumb"><Link to="/sectors">Sectors & Checklists</Link> / {data.checklist?.name}</div>
        <h1>{data.checklist?.name}</h1>
        <div className="muted">{data.checklist?.sectors?.name} · v{data.checklist?.version} · {data.items.length} items</div>
      </header>
      <ErrorBanner error={actErr} />

      <div className="toolbar">
        <button onClick={() => setEditItem({ ...BLANK, sort_order: (data.items.at(-1)?.sort_order ?? 0) + 10 })}>Add item</button>
      </div>

      {cats.map((cat) => (
        <div className="panel" key={cat}>
          <div className="panel-title"><h2>{cat}</h2></div>
          <table className="data">
            <thead><tr><th style={{ width: 40 }}>#</th><th>Item</th><th>Source</th><th>Doc type</th><th>Severity</th><th>Regulation</th><th /></tr></thead>
            <tbody>
              {data.items.filter((i) => i.category === cat).map((i) => (
                <tr key={i.id}>
                  <td className="muted">{i.sort_order}</td>
                  <td>{i.item_text}{i.guidance_notes && <div className="muted" style={{ fontSize: '0.8rem' }}>{i.guidance_notes}</div>}</td>
                  <td><span className={`pill ${i.source_type === 'generated' ? 'status-final' : 'status-pending_review'}`}>{i.source_type}</span></td>
                  <td className="mono">{i.document_templates?.type_code || '—'}</td>
                  <td>{i.severity_weight}</td>
                  <td className="muted">{i.regulation_reference}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-ghost btn-sm" onClick={() => setEditItem(i)}>Edit</button>{' '}
                    <ConfirmButton onConfirm={() => runAction(async () => { await db.remove('checklist_items', i.id); refetch() })}>Delete</ConfirmButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {editItem && (
        <ItemModal item={editItem} templates={data.templates} onClose={() => setEditItem(null)} onSave={saveItem} />
      )}
    </>
  )
}

function ItemModal({ item, templates, onClose, onSave }) {
  const [form, setForm] = useState(item)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const selectedTemplate = templates.find((t) => t.id === form.required_document_type_id)

  return (
    <Modal title={form.id ? 'Edit checklist item' : 'New checklist item'} onClose={onClose} wide
      actions={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button disabled={!form.item_text} onClick={() => onSave(form)}>Save</button>
      </>}>
      <div className="field-row">
        <Field label="Category"><input value={form.category} onChange={set('category')} /></Field>
        <Field label="Sort order"><input type="number" value={form.sort_order} onChange={set('sort_order')} /></Field>
        <Field label="Severity weight (1–5)"><input type="number" min={1} max={5} value={form.severity_weight} onChange={set('severity_weight')} /></Field>
      </div>
      <Field label="Item text *"><textarea value={form.item_text} onChange={set('item_text')} /></Field>
      <div className="field-row">
        <Field label="Source type" hint="Evidence items never offer a Generate action.">
          <select value={form.source_type} onChange={set('source_type')}>
            <option value="generated">generated (IMPI authors)</option>
            <option value="evidence">evidence (third-party issued)</option>
          </select>
        </Field>
        <Field label="Required document type">
          <select value={form.required_document_type_id || ''} onChange={set('required_document_type_id')}>
            <option value="">— none —</option>
            {templates.filter((t) => t.source_type === form.source_type).map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.type_code})</option>
            ))}
          </select>
        </Field>
      </div>
      {selectedTemplate && selectedTemplate.source_type !== form.source_type && (
        <div className="notice">Heads up: the linked template is <strong>{selectedTemplate.source_type}</strong> but this item is <strong>{form.source_type}</strong>.</div>
      )}
      <Field label="Regulation reference"><input value={form.regulation_reference || ''} onChange={set('regulation_reference')} placeholder="e.g. OHS Act s16(2); Construction Reg 10" /></Field>
      <Field label="Guidance notes"><textarea value={form.guidance_notes || ''} onChange={set('guidance_notes')} /></Field>
    </Modal>
  )
}
