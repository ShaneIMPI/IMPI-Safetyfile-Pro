// Client-side PDF utilities:
//  - extractPdfText: pull text out of an uploaded safety file (for AI-assisted audit)
//  - mergePdfs: bind accepted evidence PDFs + generated-document PDFs into one file
//  - buildFrontMatterPdf: cover + Table of Contents rendered directly as PDF so it
//    merges cleanly (the docx cover module is for standalone use — see DECISIONS.md item 4)

import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { HEX, IMPI } from '../theme/tokens.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const hexToRgb = (h) => {
  const n = parseInt(h, 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export async function extractPdfText(fileOrBlob, { maxPages = 200 } = {}) {
  const buf = await fileOrBlob.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const pages = Math.min(pdf.numPages, maxPages)
  const out = []
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const line = content.items.map((it) => ('str' in it ? it.str : '')).join(' ')
    out.push(`--- page ${i} ---\n${line}`)
  }
  return out.join('\n\n')
}

// sources: [{ name, bytes: ArrayBuffer|Uint8Array }]
export async function mergePdfs(sources, { footerText = IMPI.creditLine, addPageNumbers = true } = {}) {
  const merged = await PDFDocument.create()
  const font = await merged.embedFont(StandardFonts.Helvetica)

  for (const src of sources) {
    let doc
    try {
      doc = await PDFDocument.load(src.bytes, { ignoreEncryption: true })
    } catch (e) {
      throw new Error(`Could not read PDF "${src.name}": ${e.message}`)
    }
    const copied = await merged.copyPages(doc, doc.getPageIndices())
    copied.forEach((p) => merged.addPage(p))
  }

  if (addPageNumbers) {
    const pages = merged.getPages()
    const total = pages.length
    pages.forEach((page, idx) => {
      const { width } = page.getSize()
      page.drawText(footerText, {
        x: 36, y: 20, size: 7, font, color: hexToRgb(HEX.muted),
      })
      const label = `Page ${idx + 1} of ${total}`
      page.drawText(label, {
        x: width - 36 - font.widthOfTextAtSize(label, 7), y: 20, size: 7, font, color: hexToRgb(HEX.muted),
      })
    })
  }

  return merged.save()
}

export async function buildFrontMatterPdf({ client, siteName, documentRef, revision = 1, items = [], logoBytes }) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const navy = hexToRgb(HEX.navy)
  const gold = hexToRgb(HEX.gold)
  const muted = hexToRgb(HEX.muted)
  const rule = hexToRgb(HEX.rule)

  // A4 in points.
  const W = 595.28
  const H = 841.89

  // --- Cover page ---------------------------------------------------
  const cover = doc.addPage([W, H])
  let y = H - 80
  if (logoBytes) {
    try {
      let img
      try { img = await doc.embedPng(logoBytes) } catch { img = await doc.embedJpg(logoBytes) }
      const scale = Math.min(200 / img.width, 90 / img.height, 1)
      cover.drawImage(img, { x: 56, y: y - img.height * scale, width: img.width * scale, height: img.height * scale })
      y -= img.height * scale + 40
    } catch { /* skip logo */ }
  }
  y -= 60
  cover.drawText('SAFETY FILE', { x: 56, y, size: 11, font: bold, color: gold, characterSpacing: 3 })
  y -= 34
  cover.drawText('Health & Safety File', { x: 56, y, size: 26, font: bold, color: navy })
  y -= 30
  cover.drawText(client?.company_name || '', { x: 56, y, size: 14, font: bold, color: hexToRgb(HEX.body) })
  if (siteName) {
    y -= 18
    cover.drawText(siteName, { x: 56, y, size: 11, font, color: muted })
  }
  y -= 44

  const ctl = [
    ['Document Ref', documentRef || '—'],
    ['Revision', String(revision)],
    ['Compiled', new Date().toLocaleDateString('en-ZA')],
    ['Status', 'Issued'],
  ]
  for (const [k, v] of ctl) {
    cover.drawText(k, { x: 56, y, size: 9, font: bold, color: navy })
    cover.drawText(v, { x: 200, y, size: 9, font, color: hexToRgb(HEX.body) })
    y -= 16
  }
  cover.drawText(IMPI.creditLine, { x: 56, y: 40, size: 7, font, color: muted })

  // --- Table of Contents ------------------------------------------
  let page = doc.addPage([W, H])
  y = H - 72
  page.drawText('Table of Contents', { x: 56, y, size: 18, font: bold, color: navy })
  y -= 12
  page.drawLine({ start: { x: 56, y }, end: { x: W - 56, y }, thickness: 1, color: rule })
  y -= 28

  items.forEach((it, i) => {
    if (y < 70) {
      page = doc.addPage([W, H])
      y = H - 72
    }
    const label = `${i + 1}.  ${it.toc_title || it.title || it.document_ref || 'Document'}`
    const refText = it.document_ref || ''
    page.drawText(label.slice(0, 78), { x: 56, y, size: 10, font, color: hexToRgb(HEX.body) })
    page.drawText(refText, { x: W - 56 - font.widthOfTextAtSize(refText, 9), y, size: 9, font, color: muted })
    y -= 18
  })
  if (!items.length) {
    page.drawText('No documents selected.', { x: 56, y, size: 10, font, color: muted })
  }

  return doc.save()
}
