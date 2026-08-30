// ===========================================================================
// IMPI SafetyFile Pro — shared docx style toolkit
// Every generated document type pulls header / footer / cover / tables from
// HERE. Do not hardcode styling per document type. (brief §3)
//
// Branding rule: the CLIENT's logo is primary branding on every page.
// IMPI branding is a small footer credit line only.
// ===========================================================================

import {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, TabStopType, LeaderType, Header, Footer,
  PageNumber, VerticalAlign, ShadingType,
} from 'docx'
import FileSaver from 'file-saver'

const { saveAs } = FileSaver
import { HEX, FONT, SIZE, IMPI, riskBand } from '../theme/tokens.js'

// A4 page geometry (twips). 1 inch = 1440 twips.
export const PAGE = {
  portrait: { width: 11906, height: 16838, margin: { top: 1200, right: 1134, bottom: 1200, left: 1134 } },
  landscape: { width: 16838, height: 11906, margin: { top: 720, right: 720, bottom: 720, left: 720 } },
}

// --- Image helpers ---------------------------------------------------------
export async function fetchImageBytes(url) {
  if (!url) return null
  const res = await fetch(url)
  if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  return { bytes: buf, ...sniffImage(buf) }
}

function sniffImage(b) {
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50) {
    const width = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]
    const height = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]
    return { type: 'png', width, height }
  }
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const marker = b[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (b[i + 5] << 8) | b[i + 6]
        const width = (b[i + 7] << 8) | b[i + 8]
        return { type: 'jpg', width, height }
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3])
    }
    return { type: 'jpg', width: 600, height: 200 }
  }
  if (b[0] === 0x47 && b[1] === 0x49) return { type: 'gif', width: 600, height: 200 }
  return { type: 'png', width: 600, height: 200 }
}

// Scale a logo to a target on-screen box (PIXELS — docx ImageRun uses px, brief §3).
export function scaledLogo(img, { maxW = 180, maxH = 70 } = {}) {
  if (!img) return null
  const ratio = Math.min(maxW / img.width, maxH / img.height, 1)
  const width = Math.max(24, Math.round(img.width * ratio))
  const height = Math.max(12, Math.round(img.height * ratio))
  return new ImageRun({ data: img.bytes, type: img.type, transformation: { width, height } })
}

// --- Text primitives -----------------------------------------------------
const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: SIZE.body, ...opts })

export const h1 = (text) =>
  new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT, size: SIZE.h1, bold: true, color: HEX.navy })],
  })

export const h2 = (text) =>
  new Paragraph({
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, font: FONT, size: SIZE.h2, bold: true, color: HEX.navySoft })],
  })

export const h3 = (text) =>
  new Paragraph({
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text, font: FONT, size: SIZE.h3, bold: true, color: HEX.navySoft })],
  })

export const para = (text, opts = {}) =>
  new Paragraph({ spacing: { after: 120 }, children: [run(text, opts)] })

export const bullet = (text) =>
  new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [run(text)] })

export const spacer = (h = 120) => new Paragraph({ spacing: { after: h }, children: [] })

export const muted = (text) =>
  new Paragraph({ spacing: { after: 120 }, children: [run(text, { italics: true, color: HEX.muted })] })

// --- Borders / shading --------------------------------------------------
const ruleColor = HEX.rule
const thin = { style: BorderStyle.SINGLE, size: 4, color: ruleColor }
export const cellBorders = { top: thin, bottom: thin, left: thin, right: thin }
const noBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
  insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
}
const shade = (fill) => ({ type: ShadingType.CLEAR, color: 'auto', fill })

function cell(content, { width, header = false, fill, align = AlignmentType.LEFT, bold = false } = {}) {
  const paras = (Array.isArray(content) ? content : [content]).map((c) =>
    typeof c === 'string'
      ? new Paragraph({
          alignment: align,
          children: [new TextRun({
            text: c, font: FONT, size: SIZE.table,
            bold: bold || header, color: header ? 'FFFFFF' : HEX.body,
          })],
        })
      : c,
  )
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    shading: header ? shade(HEX.navy) : fill ? shade(fill) : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    borders: cellBorders,
    children: paras,
  })
}
export { cell }

// Generic bordered table. columnWidths MUST sum to totalWidth (brief §3 gotcha).
export function gridTable({ headers, rows, columnWidths, totalWidth }) {
  const sum = columnWidths.reduce((a, b) => a + b, 0)
  if (totalWidth && sum !== totalWidth) {
    console.warn(`[docgen] gridTable columnWidths sum ${sum} != ${totalWidth}; content may overflow`)
  }
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((hd, i) => cell(hd, { width: columnWidths[i], header: true })),
  })
  const bodyRows = rows.map((r, ri) =>
    new TableRow({
      children: r.map((c, i) => {
        // A cell is either a plain string or a descriptor { text, fill, align, bold }.
        if (c && typeof c === 'object' && !(c instanceof Paragraph)) {
          return cell(c.text ?? '', {
            width: columnWidths[i], fill: c.fill ?? (ri % 2 ? HEX.altRow : undefined),
            align: c.align, bold: c.bold,
          })
        }
        return cell(c ?? '', { width: columnWidths[i], fill: ri % 2 ? HEX.altRow : undefined })
      }),
    }),
  )
  return new Table({
    width: { size: sum, type: WidthType.DXA },
    columnWidths,
    rows: [headerRow, ...bodyRows],
  })
}

// Shading fill for a risk score (used for R and Residual R columns).
export const riskFill = (score) => riskBand(score).hex

// --- Document control table (cover page) ------------------------------
export function documentControlTable(dc, totalWidth = 9638) {
  const labelW = Math.round(totalWidth * 0.28)
  const valueW = totalWidth - labelW
  const rows = [
    ['Document Ref', dc.documentRef || '—'],
    ['Revision', String(dc.revision ?? '1')],
    ['Revision Date', dc.revisionDate || '—'],
    ['Prepared By', dc.preparedBy || '—'],
    ['Reviewed By', dc.reviewedBy || '—'],
    ['Approved By', dc.approvedBy || '—'],
    ['Status', dc.status || 'Draft'],
  ].map(([k, v]) =>
    new TableRow({
      children: [
        cell(k, { width: labelW, fill: HEX.altRow, bold: true }),
        cell(v, { width: valueW }),
      ],
    }),
  )
  return new Table({ width: { size: totalWidth, type: WidthType.DXA }, columnWidths: [labelW, valueW], rows })
}

// --- Cover page ------------------------------------------------------
// Returns an ARRAY of section children (Paragraphs + Tables at top level).
export function coverPage({ logo, docTypeStrap, title, clientName, siteName, documentControl }) {
  const out = []
  if (logo) out.push(new Paragraph({ spacing: { after: 400 }, children: [logo] }))
  else out.push(spacer(400))

  out.push(new Paragraph({
    spacing: { before: 600, after: 120 },
    children: [new TextRun({
      text: (docTypeStrap || 'SAFETY FILE DOCUMENT').toUpperCase(),
      font: FONT, size: SIZE.coverStrap, bold: true, color: HEX.gold, characterSpacing: 40,
    })],
  }))
  out.push(new Paragraph({
    spacing: { after: 240 },
    children: [new TextRun({ text: title || '', font: FONT, size: SIZE.coverTitle, bold: true, color: HEX.navy })],
  }))
  out.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: clientName || '', font: FONT, size: SIZE.h2, bold: true, color: HEX.body })],
  }))
  if (siteName) {
    out.push(new Paragraph({
      spacing: { after: 480 },
      children: [new TextRun({ text: siteName, font: FONT, size: SIZE.body, italics: true, color: HEX.muted })],
    }))
  } else out.push(spacer(480))

  out.push(documentControlTable(documentControl || {}))

  out.push(new Paragraph({
    spacing: { before: 480 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: IMPI.distributionNotice, font: FONT, size: SIZE.small, italics: true, color: HEX.muted })],
  }))
  return out
}

// --- Header / Footer -----------------------------------------------
export function contentHeader({ logo, docTitle }) {
  const left = new TableCell({
    width: { size: 5000, type: WidthType.DXA }, borders: noBorders,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: logo ? [logo] : [new TextRun({ text: '' })] })],
  })
  const right = new TableCell({
    width: { size: 5000, type: WidthType.DXA }, borders: noBorders,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({
        text: (docTitle || '').toUpperCase(), font: FONT, size: SIZE.small, bold: true, color: HEX.muted,
      })],
    })],
  })
  return new Header({
    children: [
      new Table({
        width: { size: 10000, type: WidthType.DXA }, columnWidths: [5000, 5000],
        borders: noBorders,
        rows: [new TableRow({ children: [left, right] })],
      }),
      new Paragraph({
        spacing: { before: 40 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: HEX.navy } },
        children: [],
      }),
    ],
  })
}

export function pageFooter() {
  const left = new TableCell({
    width: { size: 7600, type: WidthType.DXA }, borders: noBorders,
    children: [new Paragraph({
      children: [new TextRun({ text: IMPI.creditLine, font: FONT, size: SIZE.small, color: HEX.muted })],
    })],
  })
  const right = new TableCell({
    width: { size: 2400, type: WidthType.DXA }, borders: noBorders,
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: 'Page ', font: FONT, size: SIZE.small, color: HEX.muted }),
        new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SIZE.small, color: HEX.muted }),
        new TextRun({ text: ' of ', font: FONT, size: SIZE.small, color: HEX.muted }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SIZE.small, color: HEX.muted }),
      ],
    })],
  })
  return new Footer({
    children: [
      new Paragraph({
        spacing: { after: 40 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: HEX.rule } },
        children: [],
      }),
      new Table({
        width: { size: 10000, type: WidthType.DXA }, columnWidths: [7600, 2400],
        borders: noBorders,
        rows: [new TableRow({ children: [left, right] })],
      }),
    ],
  })
}

// Cover footer: credit line only, centered, no page number.
export function coverFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: IMPI.creditLine, font: FONT, size: SIZE.small, color: HEX.muted })],
    })],
  })
}

// --- Table of Contents entry with dot leader (brief §3 gotcha) ---------
export function tocEntry(text, pageLabel, { indent = 0, bold = false } = {}) {
  return new Paragraph({
    spacing: { after: 80 },
    indent: indent ? { left: indent } : undefined,
    tabStops: [{ type: TabStopType.RIGHT, position: 9638, leader: LeaderType.DOT }],
    children: [
      new TextRun({ text, font: FONT, size: SIZE.body, bold, color: HEX.body }),
      new TextRun({ text: `\t${pageLabel ?? ''}`, font: FONT, size: SIZE.body, bold, color: HEX.body }),
    ],
  })
}

// --- Section + Document builders --------------------------------
export function makeSection({ children, orientation = 'portrait', header, footer, titleForHeader }) {
  const geo = PAGE[orientation]
  return {
    properties: {
      page: {
        size: { width: geo.width, height: geo.height, orientation },
        margin: geo.margin,
      },
    },
    headers: header === false ? undefined : { default: header ?? contentHeader({ docTitle: titleForHeader }) },
    footers: footer === false ? undefined : { default: footer ?? pageFooter() },
    children,
  }
}

export function buildDocument({ sections, title, creator = IMPI.legalName }) {
  return new Document({
    creator,
    title,
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE.body, color: HEX.body } },
      },
    },
    sections,
  })
}

export async function saveDocx(doc, filename) {
  const blob = await Packer.toBlob(doc)
  saveAs(blob, filename.endsWith('.docx') ? filename : `${filename}.docx`)
  return blob
}

export async function docxBlob(doc) {
  return Packer.toBlob(doc)
}
