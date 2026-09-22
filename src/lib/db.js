import { neonClient, deleteStorageFile } from './neon.js'

const pick = ({ data, error }) => { if (error) throw error; return data }

export const db = {
  clients: () => neonClient.from('clients').select('*').order('company_name').then(pick),
  client: (id) => neonClient.from('clients').select('*').eq('id', id).single().then(pick),

  sectors: (opts = {}) => {
    let q = neonClient.from('sectors').select('*').order('name')
    if (opts.activeOnly) q = q.eq('active', true)
    return q.then(pick)
  },

  checklists: () =>
    neonClient.from('checklists').select('*, sectors(name)').order('name').then(pick),
  checklistsForSector: (sectorId) =>
    neonClient.from('checklists').select('*').eq('sector_id', sectorId).eq('active', true).order('name').then(pick),
  checklistItems: (checklistId) =>
    neonClient.from('checklist_items').select('*, document_templates(name, type_code, source_type)')
      .eq('checklist_id', checklistId).order('sort_order').then(pick),

  templates: (opts = {}) => {
    let q = neonClient.from('document_templates').select('*').order('name')
    if (opts.activeOnly) q = q.eq('active', true)
    if (opts.sourceType) q = q.eq('source_type', opts.sourceType)
    return q.then(pick)
  },
  templateSectors: () => neonClient.from('document_template_sectors').select('*').then(pick),

  hazardLibrary: () =>
    neonClient.from('hazard_library').select('*, hazard_library_sectors(sector_id)').order('activity').then(pick),
  methodLibrary: () =>
    neonClient.from('method_step_library').select('*, method_step_library_sectors(sector_id)')
      .order('activity_type').order('sort_hint').then(pick),

  audits: () =>
    neonClient.from('audits').select('*, clients(company_name), checklists(name)').order('audit_date', { ascending: false }).then(pick),
  audit: (id) =>
    neonClient.from('audits').select('*, clients(*), checklists(*)').eq('id', id).single().then(pick),
  auditResults: (auditId) =>
    neonClient.from('audit_results').select('*').eq('audit_id', auditId).then(pick),

  generatedDocs: (clientId) => {
    let q = neonClient.from('generated_documents').select('*, document_templates(name, type_code)').order('generated_at', { ascending: false })
    if (clientId) q = q.eq('client_id', clientId)
    return q.then(pick)
  },
  evidenceDocs: (clientId) => {
    let q = neonClient
      .from('evidence_documents')
      .select('*, evidence_document_files(id, file_url, file_name, uploaded_at)')
      .order('created_at', { ascending: false })
    if (clientId) q = q.eq('client_id', clientId)
    return q.then(pick)
  },
  safetyFiles: (clientId) => {
    let q = neonClient.from('safety_files').select('*, clients(company_name)').order('compiled_at', { ascending: false })
    if (clientId) q = q.eq('client_id', clientId)
    return q.then(pick)
  },
  register: () => neonClient.from('document_control_register').select('*').then(pick),

  insert: (table, row) => neonClient.from(table).insert(row).select().single().then(pick),
  update: (table, id, patch) => neonClient.from(table).update(patch).eq('id', id).select().single().then(pick),
  remove: (table, id) => neonClient.from(table).delete().eq('id', id).then(pick),
}

// --- Delete Clients & Documents (see DECISIONS.md addendum 8) -------------
//
// clients/generated_documents/evidence_documents/audits/questionnaire_responses/
// safety_files/document_counters/audit_results/evidence_document_files all
// carry `on delete cascade` foreign keys back to `clients` (0001_schema.sql)
// — a single `delete from clients where id = $1` is one Postgres statement,
// so it's atomically all-or-nothing at the DB level without needing a
// SECURITY DEFINER RPC (which this project has since learned not to lean on
// for anything auth.user_id()-sensitive — see DECISIONS.md addendum 6).
// Storage files aren't part of that transaction (S3 has no such concept), so
// they're gathered BEFORE the DB delete and cleaned up best-effort after —
// see deleteStorageFile's own doc comment for why a cleanup failure there
// doesn't get treated as the overall action failing.

// Is this generated/evidence document referenced by any of this client's
// already-assembled safety files? Informational only, per the addendum —
// never blocks the delete, just changes the confirmation wording.
export async function isReferencedInSafetyFile(clientId, kind, docId) {
  const rows = await neonClient.from('safety_files').select('included_document_ids').eq('client_id', clientId).then(pick)
  return (rows ?? []).some((sf) => (sf.included_document_ids || []).some((e) => e.kind === kind && e.id === docId))
}

export async function deleteGeneratedDocument(id) {
  const doc = await neonClient.from('generated_documents').select('file_url, pdf_url').eq('id', id).single().then(pick)
  await db.remove('generated_documents', id)
  await deleteStorageFile('generated', doc?.file_url)
  await deleteStorageFile('generated', doc?.pdf_url)
}

export async function deleteEvidenceDocument(id) {
  const files = await neonClient.from('evidence_document_files').select('file_url').eq('evidence_document_id', id).then(pick)
  await db.remove('evidence_documents', id) // cascades evidence_document_files rows
  for (const f of files ?? []) await deleteStorageFile('evidence', f.file_url)
}

// Gather everything needed to show a real confirmation ("N documents, N
// audits, ...") and to clean up storage after the cascade delete — all
// plain reads via .from(), the code path this project has proven reliable
// (unlike .rpc() — see DECISIONS.md addendum 6).
export async function gatherClientDeletionInfo(clientId) {
  const [client, generated, evidence, audits, safetyFiles] = await Promise.all([
    neonClient.from('clients').select('logo_url').eq('id', clientId).single().then(pick),
    neonClient.from('generated_documents').select('id, file_url, pdf_url').eq('client_id', clientId).then(pick),
    neonClient.from('evidence_documents').select('id, evidence_document_files(file_url)').eq('client_id', clientId).then(pick),
    neonClient.from('audits').select('id').eq('client_id', clientId).then(pick),
    neonClient.from('safety_files').select('id, final_pdf_url').eq('client_id', clientId).then(pick),
  ])
  const files = [
    ...(generated ?? []).flatMap((g) => [
      g.file_url && { bucket: 'generated', url: g.file_url },
      g.pdf_url && { bucket: 'generated', url: g.pdf_url },
    ].filter(Boolean)),
    ...(evidence ?? []).flatMap((e) => (e.evidence_document_files || []).map((f) => ({ bucket: 'evidence', url: f.file_url }))),
    ...(safetyFiles ?? []).filter((s) => s.final_pdf_url).map((s) => ({ bucket: 'safety-files', url: s.final_pdf_url })),
    ...(client?.logo_url ? [{ bucket: 'logos', url: client.logo_url }] : []),
  ]
  return {
    counts: {
      generated: (generated ?? []).length,
      evidence: (evidence ?? []).length,
      audits: (audits ?? []).length,
      safetyFiles: (safetyFiles ?? []).length,
    },
    files,
  }
}

export async function deleteClientCascade(clientId, files) {
  await db.remove('clients', clientId) // FK cascades handle every child row in one atomic statement
  for (const f of files) await deleteStorageFile(f.bucket, f.url)
}
