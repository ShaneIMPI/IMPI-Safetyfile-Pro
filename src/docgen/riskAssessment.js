// Risk Assessment generator — A x B x C x D = R register assembled from the
// hazard library (filtered by sector + selected activities), plus staff edits.

import { AlignmentType } from 'docx'
import {
  buildDocument, makeSection, coverPage, coverFooter, h1, h2, para, muted,
  spacer, gridTable, riskFill, scaledLogo, fetchImageBytes, saveDocx,
} from './shared.js'
import { RISK_BANDS, riskBand } from '../theme/tokens.js'

export const meta = {
  typeCode: 'RA',
  needs: ['client', 'hazardRows', 'responses'],
  strap: 'Safety File Document',
}

function residual(score) {
  // Indicative residual after applying the listed controls — one band lower, floored at 1.
  const band = riskBand(score)
  const idx = Math.max(0, RISK_BANDS.indexOf(band) - 1)
  return Math.max(1, Math.min(score, RISK_BANDS[idx].max, Math.round(score * 0.35)))
}

export async function build(ctx) {
  const { client, responses = {}, hazardRows = [], documentControl = {} } = ctx
  const title = responses.assessment_type === 'Baseline'
    ? 'Baseline Risk Assessment'
    : 'Risk Assessment'
  const site = responses.site_project_name || documentControl.siteProjectName || ''

  let logoImg = null
  try { logoImg = client?.logo_url ? await fetchImageBytes(client.logo_url) : null } catch { logoImg = null }
  const coverLogo = scaledLogo(logoImg, { maxW: 220, maxH: 90 })

  // --- Cover -----------------------------------------------------------
  const cover = makeSection({
    orientation: 'portrait',
    header: false,
    footer: coverFooter(),
    children: coverPage({
      logo: coverLogo,
      docTypeStrap: meta.strap,
      title,
      clientName: client?.company_name,
      siteName: site,
      documentControl,
    }),
  })

  // --- Methodology ---------------------------------------------------
  const legendRows = RISK_BANDS.map((b) => [
    { text: b.label, fill: b.hex, bold: true },
    { text: b.max === Infinity ? `${b.min}+` : `${b.min} – ${b.max}`, fill: b.hex },
    { text: bandAction(b.key), fill: b.hex },
  ])

  const intro = makeSection({
    orientation: 'portrait',
    titleForHeader: title,
    children: [
      h1(title),
      para(`Client: ${client?.company_name ?? ''}`),
      site ? para(`Site / Project: ${site}`) : spacer(0),
      para(`Assessor: ${responses.assessor_name ?? '—'}    Date: ${responses.assessment_date ?? '—'}`),
      h2('1. Purpose & Scope'),
      para(responses.site_description
        || 'This assessment identifies hazards associated with the activities in scope, evaluates the '
        + 'associated risk, and specifies the controls required to reduce risk to an acceptable level.'),
      h2('2. Methodology'),
      para('Risk is scored as R = A × B × C × D, where each factor is rated on the organisation\'s '
        + 'standard scale (A: likelihood of occurrence, B: frequency/duration of exposure, '
        + 'C: probability of harm given exposure, D: potential severity of outcome).'),
      h2('3. Risk Rating Legend'),
      gridTable({
        headers: ['Band', 'Score (R)', 'Required action'],
        rows: legendRows,
        columnWidths: [1600, 1800, 6238],
        totalWidth: 9638,
      }),
      muted('Residual R shown in the register is the indicative rating once the specified controls are '
        + 'fully implemented and maintained.'),
    ],
  })

  // --- Register (landscape) ---------------------------------------
  const colW = [500, 1600, 2000, 1600, 3200, 400, 400, 400, 400, 600, 2698, 700, 900]
  const rows = hazardRows.map((r, i) => {
    const a = num(r.a ?? r.default_a), b = num(r.b ?? r.default_b)
    const c = num(r.c ?? r.default_c), d = num(r.d ?? r.default_d)
    const R = a * b * c * d
    const res = r.residual != null ? num(r.residual) : residual(R)
    return [
      { text: String(i + 1), align: AlignmentType.CENTER },
      r.activity ?? '',
      r.hazard ?? '',
      r.who_may_be_harmed ?? '',
      r.standard_controls ?? '',
      { text: String(a), align: AlignmentType.CENTER },
      { text: String(b), align: AlignmentType.CENTER },
      { text: String(c), align: AlignmentType.CENTER },
      { text: String(d), align: AlignmentType.CENTER },
      { text: String(R), align: AlignmentType.CENTER, fill: riskFill(R), bold: true },
      r.additional_controls ?? '',
      { text: String(res), align: AlignmentType.CENTER, fill: riskFill(res), bold: true },
      r.responsible ?? responses.supervisor ?? '',
    ]
  })

  const register = makeSection({
    orientation: 'landscape',
    titleForHeader: title,
    children: [
      h1('4. Risk Register'),
      rows.length
        ? gridTable({
            headers: ['#', 'Activity', 'Hazard', 'Who may be harmed', 'Existing / standard controls',
              'A', 'B', 'C', 'D', 'R', 'Additional controls required', 'Res. R', 'Responsible'],
            rows,
            columnWidths: colW,
            totalWidth: colW.reduce((x, y) => x + y, 0),
          })
        : muted('No hazard lines selected. Add hazard-library entries or draft new lines before finalising.'),
    ],
  })

  // --- Sign-off ---------------------------------------------------
  const signoff = makeSection({
    orientation: 'portrait',
    titleForHeader: title,
    children: [
      h1('5. Review & Acceptance'),
      para('This risk assessment must be reviewed at least annually, or sooner following an incident, '
        + 'a change in activity, plant, personnel or legislation, or where a control is found ineffective.'),
      spacer(240),
      ...signBlock('Compiled by', responses.assessor_name),
      ...signBlock('Reviewed by', documentControl.reviewedBy),
      ...signBlock('Approved by', documentControl.approvedBy),
    ],
  })

  const doc = buildDocument({ title, sections: [cover, intro, register, signoff] })
  return { doc, title, filename: `${documentControl.documentRef || title}.docx` }
}

function bandAction(key) {
  return {
    low: 'Acceptable. Maintain controls; monitor.',
    medium: 'Additional controls to be implemented within a defined period.',
    high: 'Immediate action required. Do not proceed until risk is reduced.',
    extreme: 'Stop. Work prohibited until risk is reduced to at least High and re-assessed.',
  }[key]
}

const num = (v) => Math.max(1, parseInt(v, 10) || 1)

function signBlock(label, name) {
  return [
    para(`${label}:  ${name || ''}`),
    para('Signature: ____________________________     Date: ____________________'),
    spacer(200),
  ]
}

export async function generateAndSave(ctx) {
  const { doc, filename } = await build(ctx)
  await saveDocx(doc, filename)
}
