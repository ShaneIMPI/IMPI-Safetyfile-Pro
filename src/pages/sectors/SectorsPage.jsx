import { useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../../lib/db.js'
import { useQuery, useAsyncAction } from '../../hooks/useQuery.js'
import { Spinner, ErrorBanner, Modal, Field } from '../../components/ui.jsx'

async function load() {
  const [sectors, checklists, templates, tSectors] = await Promise.all([
    db.sectors(), db.checklists(), db.templates(), db.templateSectors(),
  ])
  return { sectors, checklists, templates, tSectors }
}

export default function SectorsPage() {
  const { data, loading, error, refetch } = useQuery(load, [])
  const [sectorModal, setSectorModal] = useState(null)
  const [checklistModal, setChecklistModal] = useState(false)
  const { runAction, error: actErr } = useAsyncAction()

  if (loading) return <Spinner />
  if (error) return <ErrorBanner error={error} />

  return (
    <>
      <header><div className="crumb">Sector & checklist management</div><h1>Sectors & Checklists</h1></header>
      <ErrorBanner error={actErr} />

      <div className="panel">
        <div className="panel-title"><h2>Sectors / trades</h2><button className="btn-sm" onClick={() => setSectorModal({})}>New sector</button></div>
        <p className="muted" style={{ marginTop: 0 }}>Open-ended and admin-editable. Add trades (CCTV, electrical, plumbing…) here as the business expands — no code change needed.</p>
        <table className="data">
          <thead><tr><th>Name</th><th>Description</th><th>Checklists</th><th>Active</th><th /></tr></thead>
          <tbody>
            {data.sectors.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="muted">{s.description}</td>
                <td>{data.checklists.filter((c) => c.sector_id === s.id).length}</td>
                <td>{s.active ? 'Yes' : 'No'}</td>
                <td><button className="btn-ghost btn-sm" onClick={() => setSectorModal(s)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="panel-title"><h2>Checklists</h2><button className="btn-sm" onClick={() => setChecklistModal(true)}>New checklist</button></div>
        <table className="data">
          <thead><tr><th>Name</th><th>Sector</th><th>Version</th><th>Active</th><th /></tr></thead>
          <tbody>
            {data.checklists.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/checklists/${c.id}`}>{c.name}</Link></td>
                <td>{c.sectors?.name}</td>
                <td>{c.version}</td>
                <td>{c.active ? 'Yes' : 'No'}</td>
                <td><Link to={`/checklists/${c.id}`}>Edit items →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="panel-title"><h2>Document template catalogue</h2></div>
        <p className="muted" style={{ marginTop: 0 }}>
          <strong>Generated</strong> = IMPI authors it. <strong>Evidence</strong> = third-party issued; IMPI files it, never authors it.
        </p>
        <table className="data">
          <thead><tr><th>Name</th><th>Code</th><th>Source</th><th>Sectors</th></tr></thead>
          <tbody>
            {data.templates.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="mono">{t.type_code}</td>
                <td><span className={`pill ${t.source_type === 'generated' ? 'status-final' : 'status-pending_review'}`}>{t.source_type}</span></td>
                <td className="muted">
                  {data.tSectors.filter((x) => x.document_template_id === t.id)
                    .map((x) => data.sectors.find((s) => s.id === x.sector_id)?.name).filter(Boolean).join(', ') || 'all'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sectorModal && <SectorModal sector={sectorModal} onClose={() => setSectorModal(null)} onSaved={() => { setSectorModal(null); refetch() }} runAction={runAction} />}
      {checklistModal && <ChecklistModal sectors={data.sectors} onClose={() => setChecklistModal(false)} onSaved={() => { setChecklistModal(false); refetch() }} runAction={runAction} />}
    </>
  )
}

function SectorModal({ sector, onClose, onSaved, runAction }) {
  const [name, setName] = useState(sector.name || '')
  const [description, setDescription] = useState(sector.description || '')
  const [active, setActive] = useState(sector.active ?? true)
  const editing = Boolean(sector.id)
  return (
    <Modal title={editing ? 'Edit sector' : 'New sector'} onClose={onClose}
      actions={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button onClick={() => runAction(async () => {
          if (editing) await db.update('sectors', sector.id, { name, description, active })
          else await db.insert('sectors', { name, description, active })
          onSaved()
        })}>Save</button>
      </>}>
      <Field label="Name *"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
      </label>
    </Modal>
  )
}

function ChecklistModal({ sectors, onClose, onSaved, runAction }) {
  const [form, setForm] = useState({ name: '', sector_id: sectors[0]?.id || '', description: '', version: '1.0' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <Modal title="New checklist" onClose={onClose}
      actions={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button disabled={!form.name || !form.sector_id} onClick={() => runAction(async () => {
          await db.insert('checklists', form); onSaved()
        })}>Create</button>
      </>}>
      <Field label="Name *"><input value={form.name} onChange={set('name')} /></Field>
      <div className="field-row">
        <Field label="Sector *">
          <select value={form.sector_id} onChange={set('sector_id')}>
            {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Version"><input value={form.version} onChange={set('version')} /></Field>
      </div>
      <Field label="Description"><textarea value={form.description} onChange={set('description')} /></Field>
    </Modal>
  )
}
