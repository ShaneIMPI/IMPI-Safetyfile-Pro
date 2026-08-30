import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { db } from '../../lib/db.js'
import { useQuery, useAsyncAction } from '../../hooks/useQuery.js'
import { Spinner, ErrorBanner, Modal, Field, ConfirmButton } from '../../components/ui.jsx'
import { riskBand } from '../../theme/tokens.js'

async function load() {
  const [sectors, hazards, methods, gaps] = await Promise.all([
    db.sectors(),
    db.hazardLibrary(),
    db.methodLibrary(),
    supabase.from('library_gap_flags').select('*').order('created_at', { ascending: false }).then(({ data }) => data ?? []),
  ])
  return { sectors, hazards, methods, gaps }
}

export default function LibraryPage() {
  const { data, loading, error, refetch } = useQuery(load, [])
  const [tab, setTab] = useState('hazard')
  const [modal, setModal] = useState(null)
  const { runAction, error: actErr } = useAsyncAction()

  if (loading) return <Spinner />
  if (error) return <ErrorBanner error={error} />
  const sectorName = (id) => data.sectors.find((s) => s.id === id)?.name

  async function saveHazard(form, sectorIds) {
    await runAction(async () => {
      const payload = {
        activity: form.activity, hazard: form.hazard, who_may_be_harmed: form.who_may_be_harmed,
        standard_controls: form.standard_controls, regulation_reference: form.regulation_reference,
        default_a: +form.default_a || 1, default_b: +form.default_b || 1,
        default_c: +form.default_c || 1, default_d: +form.default_d || 1, active: form.active ?? true,
      }
      const row = form.id ? await db.update('hazard_library', form.id, payload) : await db.insert('hazard_library', payload)
      await supabase.from('hazard_library_sectors').delete().eq('hazard_library_id', row.id)
      if (sectorIds.length) await supabase.from('hazard_library_sectors').insert(sectorIds.map((sid) => ({ hazard_library_id: row.id, sector_id: sid })))
      setModal(null); refetch()
    })
  }
  async function saveMethod(form, sectorIds) {
    await runAction(async () => {
      const payload = {
        activity_type: form.activity_type, step_description: form.step_description,
        key_hazards_controls: form.key_hazards_controls, responsible_role_default: form.responsible_role_default,
        sort_hint: +form.sort_hint || 0, active: form.active ?? true,
      }
      const row = form.id ? await db.update('method_step_library', form.id, payload) : await db.insert('method_step_library', payload)
      await supabase.from('method_step_library_sectors').delete().eq('method_step_library_id', row.id)
      if (sectorIds.length) await supabase.from('method_step_library_sectors').insert(sectorIds.map((sid) => ({ method_step_library_id: row.id, sector_id: sid })))
      setModal(null); refetch()
    })
  }

  return (
    <>
      <header><div className="crumb">Hazard / method library management</div><h1>Hazard / Method Library</h1></header>
      <ErrorBanner error={actErr} />
      <div className="toolbar">
        <button className={tab === 'hazard' ? '' : 'btn-secondary'} onClick={() => setTab('hazard')}>Hazards ({data.hazards.length})</button>
        <button className={tab === 'method' ? '' : 'btn-secondary'} onClick={() => setTab('method')}>Method steps ({data.methods.length})</button>
        <button className={tab === 'gaps' ? '' : 'btn-secondary'} onClick={() => setTab('gaps')}>Gap flags ({data.gaps.filter((g) => g.status === 'open').length})</button>
        <div className="grow" />
        {tab === 'hazard' && <button onClick={() => setModal({ kind: 'hazard', data: { default_a: 3, default_b: 3, default_c: 3, default_d: 2 }, sectorIds: [] })}>New hazard</button>}
        {tab === 'method' && <button onClick={() => setModal({ kind: 'method', data: {}, sectorIds: [] })}>New method step</button>}
      </div>

      {tab === 'hazard' && (
        <div className="panel" style={{ padding: 0 }}>
          <table className="data">
            <thead><tr><th>Activity</th><th>Hazard</th><th>Standard controls</th><th>A·B·C·D = R</th><th>Sectors</th><th /></tr></thead>
            <tbody>
              {data.hazards.map((h) => {
                const R = h.default_a * h.default_b * h.default_c * h.default_d
                return (
                  <tr key={h.id}>
                    <td>{h.activity}</td>
                    <td>{h.hazard}<div className="muted" style={{ fontSize: '0.8rem' }}>{h.who_may_be_harmed}</div></td>
                    <td className="muted" style={{ maxWidth: 380 }}>{h.standard_controls}</td>
                    <td>{h.default_a}·{h.default_b}·{h.default_c}·{h.default_d} = <span className={`pill risk-${riskBand(R).key}`}>{R}</span></td>
                    <td className="muted">{(h.hazard_library_sectors || []).map((x) => sectorName(x.sector_id)).join(', ') || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn-ghost btn-sm" onClick={() => setModal({ kind: 'hazard', data: h, sectorIds: (h.hazard_library_sectors || []).map((x) => x.sector_id) })}>Edit</button>{' '}
                      <ConfirmButton onConfirm={() => runAction(async () => { await db.remove('hazard_library', h.id); refetch() })}>Delete</ConfirmButton>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'method' && (
        <div className="panel" style={{ padding: 0 }}>
          <table className="data">
            <thead><tr><th>Activity type</th><th>Step</th><th>Key hazards & controls</th><th>Responsible</th><th>Sectors</th><th /></tr></thead>
            <tbody>
              {data.methods.map((m) => (
                <tr key={m.id}>
                  <td>{m.activity_type}<div className="muted">#{m.sort_hint}</div></td>
                  <td style={{ maxWidth: 360 }}>{m.step_description}</td>
                  <td className="muted" style={{ maxWidth: 300 }}>{m.key_hazards_controls}</td>
                  <td>{m.responsible_role_default}</td>
                  <td className="muted">{(m.method_step_library_sectors || []).map((x) => sectorName(x.sector_id)).join(', ') || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn-ghost btn-sm" onClick={() => setModal({ kind: 'method', data: m, sectorIds: (m.method_step_library_sectors || []).map((x) => x.sector_id) })}>Edit</button>{' '}
                    <ConfirmButton onConfirm={() => runAction(async () => { await db.remove('method_step_library', m.id); refetch() })}>Delete</ConfirmButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'gaps' && (
        <div className="panel">
          <p className="muted" style={{ marginTop: 0 }}>
            Scenarios flagged from the Document Builder where the library did not fit. Draft a proper entry,
            approve it, and it becomes a permanent library row — the core scaling loop.
          </p>
          {data.gaps.length === 0 ? <div className="muted">No gap flags.</div> : (
            <table className="data">
              <thead><tr><th>Kind</th><th>Context</th><th>Status</th><th>Raised</th><th /></tr></thead>
              <tbody>
                {data.gaps.map((g) => (
                  <tr key={g.id}>
                    <td>{g.kind}</td>
                    <td>{g.context}</td>
                    <td><span className={`pill status-${g.status === 'approved' ? 'final' : g.status === 'open' ? 'pending_review' : 'draft'}`}>{g.status}</span></td>
                    <td className="muted">{new Date(g.created_at).toLocaleDateString('en-ZA')}</td>
                    <td>
                      {g.status !== 'approved' && g.status !== 'dismissed' && (
                        <>
                          <button className="btn-sm btn-secondary" onClick={() => setModal({
                            kind: g.kind === 'method_step' ? 'method' : 'hazard',
                            data: g.proposed || {}, sectorIds: g.sector_id ? [g.sector_id] : [], gapId: g.id,
                          })}>Draft & approve</button>{' '}
                          <button className="btn-ghost btn-sm" onClick={() => runAction(async () => { await db.update('library_gap_flags', g.id, { status: 'dismissed' }); refetch() })}>Dismiss</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modal?.kind === 'hazard' && (
        <HazardModal sectors={data.sectors} entry={modal.data} sectorIds={modal.sectorIds}
          onClose={() => setModal(null)}
          onSave={async (f, s) => { await saveHazard(f, s); if (modal.gapId) await db.update('library_gap_flags', modal.gapId, { status: 'approved' }) }} />
      )}
      {modal?.kind === 'method' && (
        <MethodModal sectors={data.sectors} entry={modal.data} sectorIds={modal.sectorIds}
          onClose={() => setModal(null)}
          onSave={async (f, s) => { await saveMethod(f, s); if (modal.gapId) await db.update('library_gap_flags', modal.gapId, { status: 'approved' }) }} />
      )}
    </>
  )
}

function SectorPicker({ sectors, value, onChange }) {
  return (
    <Field label="Sectors">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {sectors.map((s) => {
          const on = value.includes(s.id)
          return (
            <label key={s.id} style={{ display: 'flex', gap: 5, alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 999, padding: '0.2rem 0.6rem', background: on ? 'var(--risk-low)' : '#fff', cursor: 'pointer' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={on}
                onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))} />
              {s.name}
            </label>
          )
        })}
      </div>
    </Field>
  )
}

function HazardModal({ sectors, entry, sectorIds: initial, onClose, onSave }) {
  const [form, setForm] = useState({ default_a: 3, default_b: 3, default_c: 3, default_d: 2, ...entry })
  const [sel, setSel] = useState(initial)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <Modal title={form.id ? 'Edit hazard' : 'New hazard'} wide onClose={onClose}
      actions={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button disabled={!form.activity || !form.hazard || !form.standard_controls} onClick={() => onSave(form, sel)}>Save</button></>}>
      <div className="field-row">
        <Field label="Activity *"><input value={form.activity || ''} onChange={set('activity')} /></Field>
        <Field label="Regulation reference"><input value={form.regulation_reference || ''} onChange={set('regulation_reference')} /></Field>
      </div>
      <Field label="Hazard *"><input value={form.hazard || ''} onChange={set('hazard')} /></Field>
      <Field label="Who may be harmed"><input value={form.who_may_be_harmed || ''} onChange={set('who_may_be_harmed')} /></Field>
      <Field label="Standard controls *"><textarea value={form.standard_controls || ''} onChange={set('standard_controls')} /></Field>
      <div className="field-row">
        {['default_a', 'default_b', 'default_c', 'default_d'].map((k) => (
          <Field key={k} label={k.replace('default_', '').toUpperCase()}>
            <input type="number" min={1} max={5} value={form[k]} onChange={set(k)} />
          </Field>
        ))}
      </div>
      <SectorPicker sectors={sectors} value={sel} onChange={setSel} />
    </Modal>
  )
}

function MethodModal({ sectors, entry, sectorIds: initial, onClose, onSave }) {
  const [form, setForm] = useState({ sort_hint: 10, ...entry })
  const [sel, setSel] = useState(initial)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <Modal title={form.id ? 'Edit method step' : 'New method step'} wide onClose={onClose}
      actions={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button disabled={!form.activity_type || !form.step_description} onClick={() => onSave(form, sel)}>Save</button></>}>
      <div className="field-row">
        <Field label="Activity type *"><input value={form.activity_type || ''} onChange={set('activity_type')} /></Field>
        <Field label="Sort hint"><input type="number" value={form.sort_hint} onChange={set('sort_hint')} /></Field>
        <Field label="Responsible role (default)"><input value={form.responsible_role_default || ''} onChange={set('responsible_role_default')} /></Field>
      </div>
      <Field label="Step description *"><textarea value={form.step_description || ''} onChange={set('step_description')} /></Field>
      <Field label="Key hazards & controls"><textarea value={form.key_hazards_controls || ''} onChange={set('key_hazards_controls')} /></Field>
      <SectorPicker sectors={sectors} value={sel} onChange={setSel} />
    </Modal>
  )
}
