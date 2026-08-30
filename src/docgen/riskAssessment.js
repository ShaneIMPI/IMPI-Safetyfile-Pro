// Risk Assessment generator — matched to /reference-docs/01_Risk_Assessment_Template.docx
// A x B x C x D = R register assembled from the hazard library + staff edits.

import { AlignmentType } from 'docx'
import {
  buildDocument, makeSection, coverPage, coverFooter, MARGIN, h1, h2, para, muted,
  spacer, gridTable, bandLegend, riskFill, scaledLogo, fetchImageBytes, saveDocx, docxBlob,
} from './shared.js'
import { RISK_BANDS, riskBand } from '../theme/tokens.js'

export const meta = { typeCode: 'RA', needs: ['client', 'hazardRows', 'responses'], strap: 'Safety File Document' }

const METHODOLOGY =
  'This risk assessment applies the A × B × C × D = R rating methodology, in line with ' +
  "IMPI Protection Agency's standard risk management approach and the ALARP (As Low As Reasonably " +
  'Practicable) principle. A = Likelihood of occurrence, B = Severity of consequence, ' +
  'C = Frequency/duration of exposure, D = Number of persons potentially affected. The resulting R ' +
  'value determines the risk category; where practicable additional controls are applied to reduce ' +
  'risk to an ALARP-acceptable residual level.'

const SIGNOFF =
  'This risk assessment has been compiled based on information provided by the client and site ' +
  'conditions observed/described at the time of assessment. It must be reviewed prior to each event ' +
  'and updated where site conditions, scope, or activities change.'

const num = (v) => Math.max(1, parseInt(v, 10) || 1)

function residual(score) {
  const band = riskBand(score)
  const idx = Math.max(0, RISK_BANDS.indexOf(band) - 1)
  return Math.max(1, Math.min(score, RISK_BANDS[idx].max, Math.round(score * 0.35)))
}

export async function build(ctx) {
  const { client, responses = {}, hazardRows = [], documentControl: dc = {} } = ctx
  const title = 'Risk Assessment'
  const site = responses.site_project_name || dc.siteProjectName || ''

  let logoImg = null
  try { logoImg = client?.logo_url ? await fetchImageBytes(client.logo_url) : null } catch { logoImg = null }

  const controlRows = [
    ['Document Ref', dc.documentRef || '—'],
    ['Revision', dc.revision ? `Rev ${dc.revision - 1}` : 'Rev 0'],
    ['Event Date(s)', responses.assessment_date || dc.revisionDate || '—'],
    ['Prepared By', dc.preparedBy || responses.assessor_name || '—'],
    ['Reviewed By', dc.reviewedBy || '[Pending Review]'],
    ['Approved By', dc.approvedBy || '[Pending Approval]'],
    ['Status', dc.status || 'DRAFT — FOR CLIENT REVIEW'],
  ]

  const cover = makeSection({
    orientation: 'portrait',
    margin: MARGIN.cover,
    header: false,
    footer: coverFooter(),
    children: coverPage({
      logo: scaledLogo(logoImg, { maxW: 220, maxH: 84 }),
      docTypeStrap: meta.strap, title, clientName: client?.company_name, siteName: site, controlRows,
    }),
  })

  const colW = [500, 1500, 1700, 1500, 2200, 500, 500, 500, 500, 600, 900, 2200, 600, 900]
  const rows = hazardRows.map((r, i) => {
    const a = num(r.a ?? r.default_a), b = num(r.b ?? r.default_b)
    const c = num(r.c ?? r.default_c), d = num(r.d ?? r.default_d)
    const R = a * b * c * d
    const res = r.residual != null ? num(r.residual) : residual(R)
    const alarp = ['low', 'medium'].includes(riskBand(res).key) ? 'Yes' : 'No'
    return [
      { text: String(i + 1), align: AlignmentType.CENTER },
      r.activity ?? '', r.hazard ?? '', r.who_may_be_harmed ?? '', r.standard_controls ?? '',
      { text: String(a), align: AlignmentType.CENTER },
      { text: String(b), align: AlignmentType.CENTER },
      { text: String(c), align: AlignmentType.CENTER },
      { text: String(d), align: AlignmentType.CENTER },
      { text: String(R), align: AlignmentType.CENTER, fill: riskFill(R) },
      riskBand(R).label.toUpperCase(),
      r.additional_controls || 'N/A — controls adequate',
      { text: String(res), align: AlignmentType.CENTER, fill: riskFill(res) },
      { text: alarp, align: AlignmentType.CENTER },
    ]
  })

  const body = makeSection({
    orientation: 'landscape',
    titleForHeader: 'Risk Assessment',
    children: [
      h1('Risk Assessment — Methodology'),
      para(METHODOLOGY),
      spacer(120),
      bandLegend(),
      spacer(160),
      h2('Risk Register'),
      rows.length
        ? gridTable({
            headers: ['No.', 'Activity', 'Hazard', 'Who/What May Be Harmed', 'Existing Controls',
              'A', 'B', 'C', 'D', 'R', 'Risk Rating', 'Additional Controls (if required)', 'Res. R', 'ALARP'],
            rows,
            columnWidths: colW,
            headerSize: 15,
            bodySize: 15,
            altShade: false,
          })
        : muted('No hazard lines selected. Add hazard-library entries or draft new lines before finalising.'),
      h2('Sign-Off'),
      para(SIGNOFF),
    ],
  })

  const doc = buildDocument({ title, sections: [cover, body] })
  return { doc, title, filename: `${dc.documentRef || title}.docx` }
}

export async function generateAndSave(ctx) {
  const { doc, filename } = await build(ctx)
  await saveDocx(doc, filename)
}
export async function buildBlob(ctx) {
  const { doc } = await build(ctx)
  return docxBlob(doc)
}
