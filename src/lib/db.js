import { neonClient } from './neon.js'

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
