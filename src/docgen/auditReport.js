// Audit Report generator — compliance status per checklist item with
// category scoring and regulation references. Built from an audit record.

import { AlignmentType } from 'docx'
import {
  buildDocument, makeSection, coverPage, coverFooter, h1, h2, para, muted,
  spacer, gridTable, scaledLogo, fetchImageBytes, saveDocx,
} from './shared.js'
import { HEX } from '../theme/tokens.js'

export const meta = {
  typeCode: 'AUD',
  needs: ['client', 'audit', 'checklist', 'results'],
  strap: 'Safety File Audit',
}

const STATUS = {
  compliant: { label: 'Compliant', fill: HEX.riskLow, w: 1.0 },
  partial: { label: 'Partial', fill: HEX.riskMedium, w: 0.5 },
  non_compliant: { label: 'Non-compliant', fill: HEX.riskExtreme, w: 0 },
  not_applicable: { label: 'N/A', fill: HEX.altRow, w: null },
  not_reviewed: { label: 'Not reviewed', fill: 'FFFFFF', w: null },
}

export async function build(ctx) {
  const { client, audit = {}, checklist = {}, results = [], documentControl = {} } = ctx
  const title = 'Safety File Audit Report'
  const site = audit.site_project_name || documentControl.siteProjectName || ''

  let logoImg = null
  try { logoImg = client?.logo_url ? await fetchImageBytes(client.logo_url) : null } catch { logoImg = null }

  // rows: [{ category, item_text, regulation_reference, status, reviewer_notes, action_required, confirmed }]
  const byCat = new Map()
  for (const r of results) {
    if (!byCat.has(r.category)) byCat.set(r.category, [])
    byCat.get(r.category).push(r)
  }

  const catSummary = []
  let gNum = 0, gDen = 0
  for (const [cat, items] of byCat) {
    let num = 0, den = 0
    for (const it of items) {
      const s = STATUS[it.status || 'not_reviewed']
      if (s.w == null || !it.confirmed) continue
      num += s.w * (it.severity_weight || 1)
      den += (it.severity_weight || 1)
    }
    gNum += num; gDen += den
    catSummary.push([
      cat,
      String(items.length),
      den === 0 ? '—' : `${Math.round((100 * num) / den)}%`,
    ])
  }
  const overall = gDen === 0 ? null : Math.round((100 * gNum) / gDen)

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

  const summary = makeSection({
    orientation: 'portrait',
    titleForHeader: title,
    children: [
      h1(title),
      para(`Client: ${client?.company_name ?? ''}`),
      para(`Checklist: ${checklist?.name ?? ''}  (v${checklist?.version ?? '—'})`),
      para(`Audit date: ${audit.audit_date ?? '—'}    Auditor: ${audit.audited_by_name ?? '—'}`),
      spacer(120),
      h2('Overall compliance'),
      para(overall == null
        ? 'No checklist items have been confirmed by the auditor yet — no score can be reported.'
        : `${overall}%  (weighted; confirmed items only. Not-applicable and unreviewed items are excluded.)`),
      h2('Compliance by category'),
      gridTable({
        headers: ['Category', 'Items', 'Compliance'],
        rows: catSummary,
        columnWidths: [5638, 1500, 2500],
        totalWidth: 9638,
      }),
      muted('Only findings explicitly confirmed by an IMPI auditor contribute to the scores above. '
        + 'AI-suggested statuses that have not been confirmed are excluded.'),
    ],
  })

  const detailRows = []
  for (const [cat, items] of byCat) {
    for (const it of items) {
      const s = STATUS[it.status || 'not_reviewed']
      detailRows.push([
        cat,
        it.item_text ?? '',
        { text: s.label, fill: s.fill, bold: true, align: AlignmentType.CENTER },
        it.regulation_reference ?? '',
        it.action_required || it.reviewer_notes || '',
      ])
    }
  }

  const detail = makeSection({
    orientation: 'landscape',
    titleForHeader: title,
    children: [
      h1('Detailed findings'),
      gridTable({
        headers: ['Category', 'Checklist item', 'Status', 'Regulation reference', 'Action required / notes'],
        rows: detailRows,
        columnWidths: [2200, 4600, 1600, 3000, 4000],
        totalWidth: 15400,
      }),
    ],
  })

  const closing = makeSection({
    orientation: 'portrait',
    titleForHeader: title,
    children: [
      h1('Recommendations'),
      para('Address all non-compliant items as a priority, followed by partial items. IMPI will '
        + 'generate the outstanding IMPI-authored documents and request third-party evidence for items '
        + 'that cannot be authored by IMPI. A follow-up audit is recommended once the gap actions are complete.'),
      spacer(240),
      para(`Auditor: ${audit.audited_by_name || ''}    Signature: ______________________    Date: __________`),
      spacer(120),
      para(`Reviewed by: ${documentControl.reviewedBy || ''}    Signature: ______________________    Date: __________`),
    ],
  })

  const doc = buildDocument({ title, sections: [cover, summary, detail, closing] })
  return { doc, title, filename: `${documentControl.documentRef || title}.docx`, overall }
}

export async function generateAndSave(ctx) {
  const { doc, filename } = await build(ctx)
  await saveDocx(doc, filename)
}
