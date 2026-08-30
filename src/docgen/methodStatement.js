// Method Statement generator — matched to /reference-docs/02_Method_Statement_Template.docx
// Sequential safe-work steps assembled from the method-step library + staff edits.

import { AlignmentType } from 'docx'
import {
  buildDocument, makeSection, coverPage, coverFooter, MARGIN, h1, para, muted, bullet,
  gridTable, scaledLogo, fetchImageBytes, saveDocx, docxBlob,
} from './shared.js'

export const meta = { typeCode: 'MS', needs: ['client', 'stepRows', 'responses'], strap: 'Safety File Document' }

const DEFAULT_REFS = [
  'Occupational Health and Safety Act 85 of 1993',
  'Applicable regulations under the OHS Act (General Safety, Driven Machinery, Construction as relevant)',
]
const EMERGENCY =
  'In the event of an incident, work stops immediately. The Site Supervisor activates the site ' +
  'emergency plan; first aid / medical response is coordinated per the site Emergency Plan. Emergency ' +
  'contact numbers are displayed at the site office and included in the Emergency Plan for this site.'
const SIGNOFF =
  'This method statement is to be reviewed and signed by all personnel involved in the activity prior ' +
  'to commencement of work, confirming they understand and will comply with the safe system of work ' +
  'described above.'

const lines = (v, fallback) => {
  const arr = String(v || '').split('\n').map((s) => s.trim()).filter(Boolean)
  return arr.length ? arr : fallback
}

export async function build(ctx) {
  const { client, responses = {}, stepRows = [], documentControl: dc = {} } = ctx
  const activity = responses.activity_type || 'Work activity'
  const title = 'Method Statement'
  const siteBase = responses.site_project_name || dc.siteProjectName || ''
  const site = siteBase ? `${siteBase} — ${activity}` : activity

  let logoImg = null
  try { logoImg = client?.logo_url ? await fetchImageBytes(client.logo_url) : null } catch { logoImg = null }

  const controlRows = [
    ['Document Ref', dc.documentRef || '—'],
    ['Revision', dc.revision ? `Rev ${dc.revision - 1}` : 'Rev 0'],
    ['Activity Date(s)', responses.activity_date || dc.revisionDate || '—'],
    ['Prepared By', dc.preparedBy || responses.supervisor || '—'],
    ['Reviewed By', dc.reviewedBy || '[Pending Review]'],
    ['Approved By', dc.approvedBy || '[Pending Approval]'],
    ['Status', dc.status || 'DRAFT — FOR CLIENT REVIEW'],
  ]

  const cover = makeSection({
    orientation: 'portrait', margin: MARGIN.cover, header: false, footer: coverFooter(),
    children: coverPage({
      logo: scaledLogo(logoImg, { maxW: 220, maxH: 84 }),
      docTypeStrap: meta.strap, title, clientName: client?.company_name, siteName: site, controlRows,
    }),
  })

  const refs = [
    ...lines(responses.references, DEFAULT_REFS),
    ...(dc.relatedRiskAssessmentRef ? [`Associated Risk Assessment ${dc.relatedRiskAssessmentRef}`] : []),
  ]
  const ppe = lines(responses.ppe, [
    'Hard hat', 'Safety footwear', 'Hi-visibility vest', 'Gloves appropriate to task',
    'Task-specific PPE as identified in the risk assessment',
  ])

  const stepRowsOut = stepRows.map((s, i) => [
    { text: String(i + 1), align: AlignmentType.CENTER },
    s.step_description ?? '',
    s.key_hazards_controls ?? '',
    s.responsible_role_default ?? responses.supervisor ?? '',
  ])

  const body = makeSection({
    orientation: 'portrait', margin: MARGIN.body, titleForHeader: title,
    children: [
      h1('1. Purpose & Scope'),
      para(`This method statement describes the safe system of work for ${activity.toLowerCase()} activities `
        + 'at the above site, and must be read in conjunction with the associated Risk Assessment'
        + (dc.relatedRiskAssessmentRef ? ` (Ref: ${dc.relatedRiskAssessmentRef}).` : '.')),
      responses.scope ? para(responses.scope) : muted('Add a scope description in the questionnaire.'),

      h1('2. References'),
      ...refs.map(bullet),

      h1('3. Roles & Responsibilities'),
      para(responses.roles
        || 'The Site Supervisor holds overall responsibility for this activity. Work is to be carried out '
        + 'only by competent, certificated personnel. The IMPI Safety Officer retains authority to stop work '
        + 'at any time where an unsafe condition is identified.'),

      h1('4. PPE Requirements'),
      ...ppe.map(bullet),

      h1('5. Sequence of Work'),
      stepRowsOut.length
        ? gridTable({
            headers: ['Step', 'Description of Task', 'Key Hazards & Controls', 'Responsible'],
            rows: stepRowsOut,
            columnWidths: [600, 3400, 3800, 2200],
            headerSize: 17,
            bodySize: 17,
          })
        : muted('No steps selected. Add method-step-library entries or draft new steps before finalising.'),

      h1('6. Emergency Procedures'),
      para(EMERGENCY),

      h1('7. Sign-Off'),
      para(SIGNOFF),
      para(`Compiled by: ${dc.preparedBy || responses.supervisor || ''}    Signature: ______________________    Date: __________`),
      para(`Reviewed by: ${dc.reviewedBy || ''}    Signature: ______________________    Date: __________`),
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
