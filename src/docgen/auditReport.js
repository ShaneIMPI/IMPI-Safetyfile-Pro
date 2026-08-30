// Audit Report generator — matched to /reference-docs/03_Audit_Report_Template.docx
// Compliance status per checklist item, category scoring, regulation references.

import { AlignmentType } from 'docx'
import {
  buildDocument, makeSection, coverPage, coverFooter, MARGIN, h1, para, muted,
  spacer, gridTable, scaledLogo, fetchImageBytes, saveDocx, docxBlob,
} from './shared.js'
import { HEX } from '../theme/tokens.js'

export const meta = { typeCode: 'AUD', needs: ['client', 'audit', 'checklist', 'results'], strap: 'Audit Report' }

const STATUS = {
  compliant: { label: 'Compliant', fill: HEX.riskLow, w: 1.0 },
  partial: { label: 'Partial', fill: HEX.riskMedium, w: 0.5 },
  non_compliant: { label: 'Non-Compliant', fill: HEX.riskHigh, w: 0 },
  not_applicable: { label: 'N/A', fill: HEX.altRow, w: null },
  not_reviewed: { label: 'Not reviewed', fill: HEX.white, w: null },
}

const scoreFill = (pct) =>
  pct == null ? undefined : pct >= 80 ? HEX.riskLow : pct >= 50 ? HEX.riskMedium : pct >= 33 ? HEX.riskHigh : HEX.riskExtreme

export async function build(ctx) {
  const { client, audit = {}, checklist = {}, results = [], documentControl: dc = {} } = ctx
  const title = 'Safety File Audit Report'
  const site = audit.site_project_name || dc.siteProjectName || ''

  let logoImg = null
  try { logoImg = client?.logo_url ? await fetchImageBytes(client.logo_url) : null } catch { logoImg = null }

  const byCat = new Map()
  for (const r of results) {
    if (!byCat.has(r.category)) byCat.set(r.category, [])
    byCat.get(r.category).push(r)
  }

  const catRows = []
  let gNum = 0, gDen = 0, gCompliant = 0, gItems = 0
  for (const [cat, items] of byCat) {
    let num = 0, den = 0, compliant = 0
    for (const it of items) {
      const s = STATUS[it.status || 'not_reviewed']
      if (s.w == null || !it.confirmed) continue
      if (it.status === 'compliant') compliant += 1
      num += s.w * (it.severity_weight || 1)
      den += (it.severity_weight || 1)
    }
    gNum += num; gDen += den; gCompliant += compliant; gItems += items.length
    const pct = den === 0 ? null : Math.round((100 * num) / den)
    catRows.push([
      cat,
      { text: String(items.length), align: AlignmentType.CENTER },
      { text: String(compliant), align: AlignmentType.CENTER },
      { text: pct == null ? '—' : `${pct}%`, align: AlignmentType.CENTER, fill: scoreFill(pct) },
    ])
  }
  const overall = gDen === 0 ? null : Math.round((100 * gNum) / gDen)

  const controlRows = [
    ['Document Ref', dc.documentRef || '—'],
    ['Checklist Used', `${checklist?.name ?? '—'}${checklist?.version ? `  (v${checklist.version})` : ''}`],
    ['Audit Date', audit.audit_date || '—'],
    ['Audited By', audit.audited_by_name || dc.preparedBy || '—'],
    ['Overall Compliance', overall == null ? 'Not yet scored' : `${overall}%`],
    ['Status', dc.status || (overall == null ? 'IN PROGRESS'
      : overall >= 90 ? 'COMPLIANT' : 'PARTIAL COMPLIANCE — ACTION REQUIRED')],
  ]

  const cover = makeSection({
    orientation: 'portrait', margin: MARGIN.cover, header: false, footer: coverFooter(),
    children: coverPage({
      logo: scaledLogo(logoImg, { maxW: 220, maxH: 84 }),
      docTypeStrap: meta.strap, title, clientName: client?.company_name, siteName: site, controlRows,
    }),
  })

  const detailRows = []
  let n = 0
  for (const [, items] of byCat) {
    for (const it of items) {
      n += 1
      const s = STATUS[it.status || 'not_reviewed']
      detailRows.push([
        { text: String(n), align: AlignmentType.CENTER },
        it.item_text ?? '',
        it.regulation_reference ?? '',
        { text: s.label, fill: s.fill },
        it.action_required || it.reviewer_notes || '',
      ])
    }
  }

  const body = makeSection({
    orientation: 'portrait', margin: MARGIN.body, titleForHeader: title,
    children: [
      h1('Executive Summary'),
      para(overall == null
        ? `This audit assesses the client-submitted safety file against ${checklist?.name || 'the applicable checklist'}. `
          + 'No checklist items have been confirmed by the auditor yet, so no overall compliance figure can be reported.'
        : `This audit assessed the client-submitted safety file against ${checklist?.name || 'the applicable checklist'}. `
          + `Overall compliance is ${overall}% (weighted; confirmed items only — not-applicable and unreviewed items `
          + `are excluded). ${gItems - gCompliant} of ${gItems} checklist items require attention.`),

      spacer(80),
      gridTable({
        headers: ['Category', 'Items', 'Compliant', 'Score'],
        rows: catRows,
        columnWidths: [4000, 2000, 2000, 2000],
        headerSize: 17,
        bodySize: 17,
        headerAligns: [AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.CENTER, AlignmentType.CENTER],
      }),
      muted('Only findings explicitly confirmed by an IMPI auditor contribute to the scores above. '
        + 'AI-suggested statuses that have not been confirmed are excluded (brief §7).'),

      h1('Detailed Findings'),
      gridTable({
        headers: ['No.', 'Checklist Item', 'Regulation Ref.', 'Status', 'Notes / Action Required'],
        rows: detailRows,
        columnWidths: [500, 3000, 1500, 1300, 3700],
        headerSize: 16,
        bodySize: 16,
        headerAligns: [AlignmentType.CENTER, AlignmentType.LEFT, AlignmentType.LEFT, AlignmentType.LEFT, AlignmentType.LEFT],
        altShade: false,
      }),

      h1('Recommended Next Steps'),
      para('Items marked Non-Compliant or Partial above should be actioned as a priority. Where a required '
        + 'document is IMPI-authored, it can be generated directly from the Document Builder; third-party '
        + 'evidence is requested and filed against the relevant checklist item. A follow-up audit is '
        + 'recommended once the gap actions are complete.'),
      spacer(160),
      para(`Auditor: ${audit.audited_by_name || ''}    Signature: ______________________    Date: __________`),
      para(`Reviewed by: ${dc.reviewedBy || ''}    Signature: ______________________    Date: __________`),
    ],
  })

  const doc = buildDocument({ title, sections: [cover, body] })
  return { doc, title, filename: `${dc.documentRef || title}.docx`, overall }
}

export async function generateAndSave(ctx) {
  const { doc, filename } = await build(ctx)
  await saveDocx(doc, filename)
}
export async function buildBlob(ctx) {
  const { doc } = await build(ctx)
  return docxBlob(doc)
}
