// Method Statement generator — sequential safe-work steps assembled from the
// method-step library (filtered by activity type) plus staff edits.

import {
  buildDocument, makeSection, coverPage, coverFooter, h1, h2, para, muted, bullet,
  spacer, gridTable, scaledLogo, fetchImageBytes, saveDocx,
} from './shared.js'

export const meta = {
  typeCode: 'MS',
  needs: ['client', 'stepRows', 'responses'],
  strap: 'Safety File Document',
}

export async function build(ctx) {
  const { client, responses = {}, stepRows = [], documentControl = {} } = ctx
  const activity = responses.activity_type || 'Work activity'
  const title = `Method Statement — ${activity}`
  const site = responses.site_project_name || documentControl.siteProjectName || ''

  let logoImg = null
  try { logoImg = client?.logo_url ? await fetchImageBytes(client.logo_url) : null } catch { logoImg = null }

  const cover = makeSection({
    orientation: 'portrait',
    header: false,
    footer: coverFooter(),
    children: coverPage({
      logo: scaledLogo(logoImg, { maxW: 220, maxH: 90 }),
      docTypeStrap: meta.strap,
      title: 'Method Statement',
      clientName: client?.company_name,
      siteName: site,
      documentControl,
    }),
  })

  const stepRowsOut = stepRows.map((s, i) => [
    { text: String(i + 1) },
    s.step_description ?? '',
    s.key_hazards_controls ?? '',
    s.responsible_role_default ?? responses.supervisor ?? '',
  ])

  const body = makeSection({
    orientation: 'portrait',
    titleForHeader: title,
    children: [
      h1(title),
      para(`Client: ${client?.company_name ?? ''}`),
      site ? para(`Site / Project: ${site}`) : spacer(0),
      para(`Responsible supervisor: ${responses.supervisor ?? '—'}`),

      h2('1. Scope of Work'),
      para(responses.scope || 'Describe the work covered by this method statement.'),

      h2('2. Plant & Equipment'),
      responses.plant_equipment
        ? para(responses.plant_equipment)
        : muted('List all plant, tools and equipment, with inspection / certification requirements.'),

      h2('3. Personal Protective Equipment'),
      responses.ppe
        ? para(responses.ppe)
        : muted('Specify mandatory and task-specific PPE.'),

      h2('4. Sequence of Operations'),
      stepRowsOut.length
        ? gridTable({
            headers: ['Step', 'Task description', 'Key hazards & controls', 'Responsible'],
            rows: stepRowsOut,
            columnWidths: [700, 4000, 3438, 1500],
            totalWidth: 9638,
          })
        : muted('No steps selected. Add method-step-library entries or draft new steps before finalising.'),

      h2('5. Emergency Arrangements'),
      bullet('In an emergency, stop work, make the area safe and raise the alarm.'),
      bullet('Follow the site Emergency Plan; report to the assembly point on instruction.'),
      bullet('Report all incidents, injuries and near misses to the site supervisor immediately.'),

      h2('6. Acceptance'),
      para('All persons undertaking this work have been briefed on this method statement and the '
        + 'associated risk assessment, and confirm their understanding by signing the briefing register.'),
      spacer(200),
      para(`Compiled by: ${responses.supervisor || ''}    Signature: ______________________    Date: __________`),
      spacer(120),
      para(`Reviewed by: ${documentControl.reviewedBy || ''}    Signature: ______________________    Date: __________`),
    ],
  })

  const doc = buildDocument({ title, sections: [cover, body] })
  return { doc, title, filename: `${documentControl.documentRef || title}.docx` }
}

export async function generateAndSave(ctx) {
  const { doc, filename } = await build(ctx)
  await saveDocx(doc, filename)
}
