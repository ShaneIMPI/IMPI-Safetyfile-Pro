import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase, uploadFile } from '../../lib/supabase.js'
import { db } from '../../lib/db.js'
import { useAuth } from '../../auth/AuthProvider.jsx'
import { useQuery, useAsyncAction } from '../../hooks/useQuery.js'
import { Spinner, ErrorBanner, Field } from '../../components/ui.jsx'
import { fmtDate } from '../../lib/format.js'
import { mergePdfs, buildFrontMatterPdf } from '../../lib/pdf.js'
import { fetchImageBytes } from '../../docgen/shared.js'
import FileSaver from 'file-saver'

const { saveAs } = FileSaver

export default function FinalAssemblyPage() {
  const [params] = useSearchParams()
  const { profile } = useAuth()
  const { data: clients, loading } = useQuery(() => db.clients(), [])
  const [clientId, setClientId] = useState(params.get('client') || '')
  const [siteName, setSiteName] = useState('')

  if (loading) return <Spinner />

  return (
    <>
      <header><div className="crumb">Final assembly</div><h1>Final Assembly</h1></header>
      <div className="panel">
        <div className="field-row">
          <Field label="Client *">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— select —</option>
              {(clients ?? []).map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </Field>
          <Field label="Site / project name (cover)"><input value={siteName} onChange={(e) => setSiteName(e.target.value)} /></Field>
        </div>
      </div>
      {clientId && <Assembler key={clientId} clientId={clientId} siteName={siteName} profile={profile} clients={clients} />}
    </>
  )
}

function Assembler({ clientId, siteName, profile, clients }) {
  const { data, loading, error, refetch } = useQuery(async () => {
    const [generated, evidence, prior] = await Promise.all([
      supabase.from('generated_documents').select('*, document_templates(name, type_code)')
        .eq('client_id', clientId).eq('status', 'final').order('generated_at').then(({ data }) => data ?? []),
      supabase.from('evidence_documents')
        .select('*, evidence_document_files(id, file_url, file_name)')
        .eq('client_id', clientId).eq('status', 'accepted')
        .order('created_at').then(({ data }) => data ?? []),
      db.safetyFiles(clientId),
    ])
    return { generated, evidence, prior }
  }, [clientId])

  const { busy, error: actErr, runAction } = useAsyncAction()
  const [rows, setRows] = useState([])
  const [outUrl, setOutUrl] = useState(null)

  useEffect(() => {
    if (!data) return
    const g = data.generated.map((d) => ({
      key: `g:${d.id}`, kind: 'generated', id: d.id, ref: d.document_ref,
      toc_title: d.title || d.document_templates?.name, url: d.pdf_url, docxUrl: d.file_url,
      include: Boolean(d.pdf_url),
    }))
    // One accepted evidence entry can hold several files; each file is its own
    // includable line in the assembled file.
    const e = data.evidence.flatMap((d) => {
      const files = d.evidence_document_files ?? []
      if (files.length === 0) {
        return [{ key: `e:${d.id}`, kind: 'evidence', id: d.id, ref: d.document_ref, toc_title: d.title || d.issuing_body, url: null, include: false }]
      }
      return files.map((f, i) => ({
        key: `e:${d.id}:${f.id}`, kind: 'evidence', id: d.id, ref: d.document_ref,
        toc_title: files.length > 1
          ? `${d.title || d.issuing_body} — ${f.file_name || `file ${i + 1}`}`
          : (d.title || d.issuing_body),
        url: f.file_url, include: isPdf(f.file_url),
      }))
    })
    setRows([...g, ...e])
  }, [data])

  if (loading) return <Spinner />
  if (error) return <ErrorBanner error={error} />

  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = rows.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setRows(next)
  }

  async function uploadPdfRendition(row, file) {
    await runAction(async () => {
      const { url } = await uploadFile('generated', `${clientId}/${row.ref}.pdf`, file)
      await db.update('generated_documents', row.id, { pdf_url: url })
      refetch()
    })
  }

  async function assemble() {
    await runAction(async () => {
      const included = rows.filter((r) => r.include)
      if (!included.length) throw new Error('Select at least one document to include.')
      const missing = included.filter((r) => !isPdf(r.url))
      if (missing.length) throw new Error(`These need a PDF rendition first: ${missing.map((m) => m.ref).join(', ')}`)

      const client = clients.find((c) => c.id === clientId)
      let logoBytes = null
      try { logoBytes = client?.logo_url ? (await fetchImageBytes(client.logo_url)).bytes : null } catch { logoBytes = null }

      // 1. Front matter (cover + TOC) as PDF.
      const seqPreview = (data.prior.length + 1)
      const frontMatter = await buildFrontMatterPdf({
        client, siteName, compiledBy: profile?.full_name || '',
        documentRef: `IMPI-SF-${client?.client_code}-${new Date().getFullYear()}-${String(seqPreview).padStart(3, '0')}`,
        items: included, logoBytes,
      })

      // 2. Fetch each included PDF.
      const sources = [{ name: 'front-matter', bytes: frontMatter }]
      for (const r of included) {
        const buf = await (await fetch(r.url)).arrayBuffer()
        sources.push({ name: r.ref, bytes: buf })
      }

      // 3. Merge with running page numbers.
      const mergedBytes = await mergePdfs(sources)

      // 4. Persist.
      const sf = await db.insert('safety_files', {
        client_id: clientId, title: 'Health & Safety File', site_project_name: siteName || null,
        included_document_ids: included.map((r) => ({ kind: r.kind, id: r.id, toc_title: r.toc_title, document_ref: r.ref })),
        compiled_by: profile?.id ?? null,
      })
      const file = new File([mergedBytes], `${sf.document_ref}.pdf`, { type: 'application/pdf' })
      const { url } = await uploadFile('safety-files', `${clientId}/${sf.document_ref}.pdf`, file)
      await db.update('safety_files', sf.id, { final_pdf_url: url })

      saveAs(file, file.name)
      setOutUrl(url)
      refetch()
    })
  }

  return (
    <>
      <ErrorBanner error={actErr} />
      <div className="panel">
        <div className="panel-title"><h2>Documents for this client</h2></div>
        <p className="muted" style={{ marginTop: 0 }}>
          Only <strong>finalized</strong> generated documents and <strong>accepted</strong> evidence appear. Order them in
          Table-of-Contents sequence. Each generated document needs a PDF rendition to be merged (see DECISIONS.md item 4).
        </p>
        <table className="data">
          <thead><tr><th style={{ width: 40 }} /><th>#</th><th>TOC title</th><th>Ref</th><th>Kind</th><th>PDF</th><th>Order</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td><input type="checkbox" style={{ width: 'auto' }} checked={r.include}
                  onChange={(e) => setRows(rows.map((x, xi) => (xi === i ? { ...x, include: e.target.checked } : x)))} /></td>
                <td>{i + 1}</td>
                <td><input value={r.toc_title || ''} onChange={(e) => setRows(rows.map((x, xi) => (xi === i ? { ...x, toc_title: e.target.value } : x)))} /></td>
                <td className="mono">{r.ref}</td>
                <td><span className={`pill ${r.kind === 'generated' ? 'status-final' : 'status-accepted'}`}>{r.kind}</span></td>
                <td>
                  {isPdf(r.url)
                    ? <a href={r.url} target="_blank" rel="noreferrer">PDF ✓</a>
                    : r.kind === 'generated'
                      ? <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                          Upload PDF
                          <input type="file" accept="application/pdf" style={{ display: 'none' }}
                            onChange={(e) => e.target.files?.[0] && uploadPdfRendition(r, e.target.files[0])} />
                        </label>
                      : <span className="pill risk-extreme">not a PDF</span>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn-ghost btn-sm" onClick={() => move(i, -1)}>↑</button>
                  <button className="btn-ghost btn-sm" onClick={() => move(i, 1)}>↓</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: '1.25rem' }}>Nothing finalized/accepted yet.</td></tr>}
          </tbody>
        </table>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button disabled={busy} onClick={assemble}>{busy ? 'Assembling…' : 'Assemble safety file PDF'}</button>
        </div>
        {outUrl && <div className="notice">Safety file assembled. <a href={outUrl} target="_blank" rel="noreferrer">Open stored copy</a></div>}
      </div>

      <div className="panel">
        <div className="panel-title"><h2>Previously assembled</h2></div>
        {data.prior.length === 0 ? <div className="muted">None.</div> : (
          <table className="data">
            <thead><tr><th>Ref</th><th>Compiled</th><th>Docs</th><th /></tr></thead>
            <tbody>
              {data.prior.map((f) => (
                <tr key={f.id}>
                  <td className="mono">{f.document_ref}</td>
                  <td>{fmtDate(f.compiled_at)}</td>
                  <td>{(f.included_document_ids || []).length}</td>
                  <td>{f.final_pdf_url ? <a href={f.final_pdf_url} target="_blank" rel="noreferrer">Open</a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

const isPdf = (url) => Boolean(url) && /\.pdf(\?|$)/i.test(url)
