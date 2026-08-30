// Master Safety File — Cover + Table of Contents front matter.
// Matched to /reference-docs/04_Safety_File_Cover_TOC_Template.docx
// Generated at final assembly; the PDF-native version in src/lib/pdf.js is what
// actually gets merged (see DECISIONS.md item 4).

import { BorderStyle, Paragraph, TextRun } from 'docx'
import {
  buildDocument, makeSection, coverPage, coverFooter, MARGIN, h1, muted, spacer,
  tocEntry, scaledLogo, fetchImageBytes, saveDocx, docxBlob,
} from './shared.js'
import { FONT, HEX, SIZE } from '../theme/tokens.js'

export const meta = { typeCode: 'SF', strap: 'Compiled Safety File' }

const TOC_INTRO =
  'This safety file has been compiled by IMPI Protection Agency (Pty) Ltd on behalf of the above ' +
  'client, incorporating the audit findings and all required supporting documentation as listed below.'
const CONTROL_NOTE =
  'Page numbers above reflect the final assembled PDF pagination once all supporting documents have ' +
  'been merged. This page is auto-generated and updates whenever the safety file is re-compiled.'

export async function build(ctx) {
  const { client, items = [], documentControl: dc = {}, siteName, title = 'Health & Safety File' } = ctx

  let logoImg = null
  try { logoImg = client?.logo_url ? await fetchImageBytes(client.logo_url) : null } catch { logoImg = null }

  const controlRows = [
    ['Document Ref', dc.documentRef || '—'],
    ['Revision', dc.revision ? `Rev ${dc.revision - 1}` : 'Rev 0'],
    ['Compiled By', dc.compiledBy || '—'],
    ['Compilation Date', dc.compilationDate || new Date().toLocaleDateString('en-ZA')],
    ['Status', dc.status || 'FINAL — FOR SUBMISSION'],
  ]

  const cover = makeSection({
    orientation: 'portrait', margin: MARGIN.cover, header: false, footer: coverFooter(),
    children: coverPage({
      logo: scaledLogo(logoImg, { maxW: 240, maxH: 96 }),
      docTypeStrap: meta.strap, title, clientName: client?.company_name,
      siteName: siteName || dc.siteProjectName, controlRows,
    }),
  })

  const toc = makeSection({
    orientation: 'portrait', margin: MARGIN.bodyWide, titleForHeader: title,
    children: [
      h1('Table of Contents'),
      muted(TOC_INTRO),
      spacer(120),
      ...items.map((it, i) => tocEntry(i + 1, it.toc_title || it.title || it.document_ref, it.document_ref || '')),
      items.length === 0 ? muted('No documents selected.') : spacer(0),
      spacer(160),
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: HEX.rule } },
        spacing: { before: 80, after: 80 },
        children: [new TextRun({ text: 'Document Control', font: FONT, size: SIZE.ctlValue, bold: true, color: HEX.navy })],
      }),
      new Paragraph({
        children: [new TextRun({ text: CONTROL_NOTE, font: FONT, size: SIZE.tocIntro, italics: true, color: HEX.muted })],
      }),
    ],
  })

  const doc = buildDocument({ title, sections: [cover, toc] })
  return { doc, title, filename: `${dc.documentRef || 'Safety-File'}-front-matter.docx` }
}

export async function generateAndSave(ctx) {
  const { doc, filename } = await build(ctx)
  await saveDocx(doc, filename)
}
export async function buildBlob(ctx) {
  const { doc } = await build(ctx)
  return docxBlob(doc)
}
