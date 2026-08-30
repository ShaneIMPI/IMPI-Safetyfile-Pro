// Generic generator for the remaining IMPI-authored templates (Policy, Legal
// Appointments Register, Emergency Plan, Fall Protection Plan, PPE, Construction
// H&S Plan, s37(2) Agreement...). Renders the questionnaire responses into a
// branded, sectioned document using the shared toolkit. Bespoke types (RA, MS,
// Audit Report) have their own dedicated modules.

import {
  buildDocument, makeSection, coverPage, coverFooter, h1, h2, para, muted, bullet,
  spacer, gridTable, scaledLogo, fetchImageBytes, saveDocx,
} from './shared.js'

export const meta = { typeCode: '*', strap: 'Safety File Document' }

function renderField(field, value) {
  const label = field.label || field.key
  if (field.type === 'repeater' && Array.isArray(value)) {
    const sub = field.fields || []
    return {
      block: 'table',
      title: label,
      headers: sub.map((f) => f.label || f.key),
      rows: value.map((row) => sub.map((f) => String(row?.[f.key] ?? ''))),
      widths: sub.map(() => Math.round(9638 / Math.max(1, sub.length))),
    }
  }
  if (Array.isArray(value)) return { block: 'kv', label, value: value.join(', ') }
  return { block: 'kv', label, value: value == null || value === '' ? '—' : String(value) }
}

export async function build(ctx) {
  const { client, template = {}, responses = {}, documentControl = {} } = ctx
  const title = template.name || 'Safety File Document'
  const site = responses.site_project_name || documentControl.siteProjectName || ''
  const schema = Array.isArray(template.questionnaire_schema) ? template.questionnaire_schema : []

  let logoImg = null
  try { logoImg = client?.logo_url ? await fetchImageBytes(client.logo_url) : null } catch { logoImg = null }

  const cover = makeSection({
    orientation: 'portrait',
    header: false,
    footer: coverFooter(),
    children: coverPage({
      logo: scaledLogo(logoImg, { maxW: 220, maxH: 90 }),
      docTypeStrap: meta.strap,
      title,
      clientName: client?.company_name,
      siteName: site,
      documentControl,
    }),
  })

  const children = [
    h1(title),
    para(`Client: ${client?.company_name ?? ''}`),
    site ? para(`Site / Project: ${site}`) : spacer(0),
  ]

  if (template.description) {
    children.push(h2('Purpose'), para(template.description))
  }

  const fields = schema.map((f) => renderField(f, responses[f.key]))
  const kvs = fields.filter((f) => f.block === 'kv')
  if (kvs.length) {
    children.push(h2('Details'))
    children.push(
      gridTable({
        headers: ['Field', 'Value'],
        rows: kvs.map((f) => [f.label, f.value]),
        columnWidths: [3200, 6438],
        totalWidth: 9638,
      }),
    )
  }
  for (const f of fields.filter((x) => x.block === 'table')) {
    children.push(h2(f.title))
    if (f.rows.length) {
      children.push(gridTable({ headers: f.headers, rows: f.rows, columnWidths: f.widths, totalWidth: f.widths.reduce((a, b) => a + b, 0) }))
    } else {
      children.push(muted('No entries captured.'))
    }
  }

  children.push(
    h2('Implementation & Review'),
    bullet('This document forms part of the client\'s Health & Safety File and must be kept current.'),
    bullet('Review at least annually, or on any change of scope, personnel, plant or legislation.'),
    bullet('All affected persons are to be briefed and the briefing recorded.'),
    spacer(240),
    para(`Prepared by: ${documentControl.preparedBy || ''}   Signature: ______________   Date: __________`),
    spacer(100),
    para(`Reviewed by: ${documentControl.reviewedBy || ''}   Signature: ______________   Date: __________`),
    spacer(100),
    para(`Approved by: ${documentControl.approvedBy || ''}   Signature: ______________   Date: __________`),
  )

  const body = makeSection({ orientation: 'portrait', titleForHeader: title, children })
  const doc = buildDocument({ title, sections: [cover, body] })
  return { doc, title, filename: `${documentControl.documentRef || title}.docx` }
}

export async function generateAndSave(ctx) {
  const { doc, filename } = await build(ctx)
  await saveDocx(doc, filename)
}
