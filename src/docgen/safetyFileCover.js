// Master Safety File — Cover + Table of Contents front matter.
// Generated at final assembly and merged ahead of all included documents.

import {
  buildDocument, makeSection, coverPage, coverFooter, h1, muted, spacer,
  tocEntry, scaledLogo, fetchImageBytes, saveDocx, docxBlob,
} from './shared.js'

export const meta = { typeCode: 'SF', strap: 'Safety File' }

export async function build(ctx) {
  const { client, items = [], documentControl = {}, siteName } = ctx
  const title = 'Health & Safety File'

  let logoImg = null
  try { logoImg = client?.logo_url ? await fetchImageBytes(client.logo_url) : null } catch { logoImg = null }

  const cover = makeSection({
    orientation: 'portrait',
    header: false,
    footer: coverFooter(),
    children: coverPage({
      logo: scaledLogo(logoImg, { maxW: 240, maxH: 100 }),
      docTypeStrap: meta.strap,
      title,
      clientName: client?.company_name,
      siteName: siteName || documentControl.siteProjectName,
      documentControl,
    }),
  })

  const toc = makeSection({
    orientation: 'portrait',
    titleForHeader: 'Health & Safety File',
    children: [
      h1('Table of Contents'),
      muted('Documents are filed in the order below. Each item carries its own document reference '
        + 'and revision as recorded in the Document Control Register.'),
      spacer(160),
      ...items.map((it, i) =>
        tocEntry(
          `${i + 1}.  ${it.toc_title || it.title || it.document_ref}`,
          it.document_ref || '',
          { bold: false },
        ),
      ),
      items.length === 0 ? muted('No documents selected.') : spacer(0),
    ],
  })

  const doc = buildDocument({ title, sections: [cover, toc] })
  return { doc, title, filename: `${documentControl.documentRef || 'Safety-File'}-front-matter.docx` }
}

export async function generateAndSave(ctx) {
  const { doc, filename } = await build(ctx)
  await saveDocx(doc, filename)
}

export async function buildBlob(ctx) {
  const { doc } = await build(ctx)
  return docxBlob(doc)
}
