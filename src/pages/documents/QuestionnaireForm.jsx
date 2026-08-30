import { Field } from '../../components/ui.jsx'

// Renders a dynamic form from a document_template.questionnaire_schema array.
// Field types: text, textarea, date, number, select, multiselect, repeater,
// select_dynamic / multiselect_dynamic (options supplied via `dynamicOptions[field.source]`).
export default function QuestionnaireForm({ schema = [], value, onChange, dynamicOptions = {} }) {
  const set = (key, v) => onChange({ ...value, [key]: v })

  return (
    <>
      {schema.map((f) => {
        const v = value[f.key]
        const opts = f.options || dynamicOptions[f.source] || []
        switch (f.type) {
          case 'textarea':
            return <Field key={f.key} label={label(f)}><textarea value={v || ''} onChange={(e) => set(f.key, e.target.value)} /></Field>
          case 'date':
            return <Field key={f.key} label={label(f)}><input type="date" value={v || ''} onChange={(e) => set(f.key, e.target.value)} /></Field>
          case 'number':
            return <Field key={f.key} label={label(f)}><input type="number" value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} /></Field>
          case 'select':
          case 'select_dynamic':
            return (
              <Field key={f.key} label={label(f)}>
                <select value={v || f.default || ''} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">— select —</option>
                  {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            )
          case 'multiselect':
          case 'multiselect_dynamic':
            return (
              <Field key={f.key} label={label(f)} hint="Toggle all that apply.">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {opts.map((o) => {
                    const arr = Array.isArray(v) ? v : []
                    const on = arr.includes(o)
                    return (
                      <label key={o} style={{ display: 'flex', gap: 5, alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 999, padding: '0.2rem 0.6rem', background: on ? 'var(--risk-low)' : '#fff', cursor: 'pointer' }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={on}
                          onChange={(e) => set(f.key, e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} />
                        {o}
                      </label>
                    )
                  })}
                  {opts.length === 0 && <span className="muted">No options available.</span>}
                </div>
              </Field>
            )
          case 'repeater':
            return <Repeater key={f.key} field={f} value={Array.isArray(v) ? v : []} onChange={(rows) => set(f.key, rows)} />
          default:
            return <Field key={f.key} label={label(f)}><input value={v || ''} onChange={(e) => set(f.key, e.target.value)} /></Field>
        }
      })}
    </>
  )
}

const label = (f) => `${f.label || f.key}${f.required ? ' *' : ''}`

function Repeater({ field, value, onChange }) {
  const sub = field.fields || []
  const addRow = () => onChange([...value, Object.fromEntries(sub.map((s) => [s.key, '']))])
  const setCell = (i, k, v) => onChange(value.map((r, ri) => (ri === i ? { ...r, [k]: v } : r)))
  const del = (i) => onChange(value.filter((_, ri) => ri !== i))
  return (
    <div className="field">
      <label>{label(field)}</label>
      <table className="data" style={{ marginBottom: 6 }}>
        <thead><tr>{sub.map((s) => <th key={s.key}>{s.label || s.key}</th>)}<th /></tr></thead>
        <tbody>
          {value.map((row, i) => (
            <tr key={i}>
              {sub.map((s) => (
                <td key={s.key}>
                  {s.type === 'select'
                    ? <select value={row[s.key] || ''} onChange={(e) => setCell(i, s.key, e.target.value)}>
                        <option value="">—</option>
                        {(s.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    : <input type={s.type === 'date' ? 'date' : 'text'} value={row[s.key] || ''} onChange={(e) => setCell(i, s.key, e.target.value)} />}
                </td>
              ))}
              <td><button className="btn-ghost btn-sm" onClick={() => del(i)}>✕</button></td>
            </tr>
          ))}
          {value.length === 0 && <tr><td colSpan={sub.length + 1} className="muted">No rows.</td></tr>}
        </tbody>
      </table>
      <button className="btn-secondary btn-sm" onClick={addRow}>Add row</button>
    </div>
  )
}
