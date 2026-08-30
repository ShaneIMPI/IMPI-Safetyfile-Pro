// ===========================================================================
// IMPI SafetyFile Pro — shared docx style toolkit
// Matched to the four approved reference templates in /reference-docs.
// Every generated document type pulls header / footer / cover / tables from
// HERE — do not hardcode styling per document type. (brief §3)
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
import { HEX, FONT, SIZE, IMPI, riskBand, RISK_BANDS } from '../theme/tokens.js'

const { saveAs } = FileSaver

// A4 page geometry (twips). 1 inch = 1440 twips. Margins per reference templates.
export const PAGE = {
  portrait: { width: 11906, height: 16838 },
  landscape: { width: 16838, height: 11906 },
}
export const MARGIN = {
  cover: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
  body: { top: 900, right: 900, bottom: 900, left: 900 },
  bodyWide: { top: 900, right: 1100, bottom: 900, left: 1100 },
  landscape: { top: 900, right: 620, bottom: 900, left: 620 },
}

// --- Image helpers ----------------------------------------------------------
export async function fetchImageBytes(url) {
  if (!url) return null
  const res = await fetch(url)
  if (!res.ok) throw new Error(`logo fetch failed: ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  return { bytes: buf, ...sniffImage(buf) }
}

function sniffImage(b) {
  if (b[0] === 0x89 && b[1] === 0x50) {
    return {
      type: 'png',
      width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19],
      height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23],
    }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const marker = b[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: 'jpg', height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] }
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3])
    }
    return { type: 'jpg', width: 600, height: 200 }
  }
  if (b[0] === 0x47 && b[1] === 0x49) return { type: 'gif', width: 600, height: 200 }
  return { type: 'png', width: 600, height: 200 }
}

// Scale a logo to a target box (PIXELS — docx ImageRun uses px, brief §3).
export function scaledLogo(img, { maxW = 180, maxH = 64 } = {}) {
  if (!img) return null
  const ratio = Math.min(maxW / img.width, maxH / img.height, 1)
  return new ImageRun({
    data: img.bytes,
    type: img.type,
    transformation: {
      width: Math.max(24, Math.round(img.width * ratio)),
      height: Math.max(12, Math.round(img.height * ratio)),
    },
  })
}

// --- Text primitives ------------------------------------------------------
const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: SIZE.body, ...opts })

export const para = (text, opts = {}) =>
  new Paragraph({ spacing: { after: 140 }, children: [run(text, opts)] })

export const muted = (text) =>
  new Paragraph({ spacing: { after: 140 }, children: [run(text, { italics: true, color: HEX.muted })] })

export const bullet = (text) =>
  new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [run(text)] })

export const spacer = (h = 120) => new Paragraph({ spacing: { after: h }, children: [] })

// Section heading: navy, bold, 13pt, with a navy bottom rule (reference "Heading 1").
export const h1 = (text) =>
  new Paragraph({
    spacing: { before: 260, after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: HEX.navy } },
    children: [new TextRun({ text, font: FONT, size: SIZE.h1, bold: true, color: HEX.navy })],
  })

// Subheading: navy-soft, bold, 11pt, no rule ("Risk Register", "Sign-Off").
export const h2 = (text) =>
  new Paragraph({
    spacing: { before: 220, after: 100 },
    children: [new TextRun({ text, font: FONT, size: SIZE.h2, bold: true, color: HEX.navySoft })],
  })

export const h3 = h2

// --- Borders / shading --------------------------------------------------
const thin = { style: BorderStyle.SINGLE, size: 4, color: HEX.rule }
export const cellBorders = { top: thin, bottom: thin, left: thin, right: thin }
const noBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
  insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
}
const shade = (fill) => ({ type: ShadingType.CLEAR, color: 'auto', fill })

function cell(content, {
  width, header = false, fill, align = AlignmentType.LEFT, bold = false, size = SIZE.table, color,
} = {}) {
  const paras = (Array.isArray(content) ? content : [content]).map((c) =>
    typeof c === 'string' || typeof c === 'number'
      ? new Paragraph({
          alignment: align,
          children: [new TextRun({
            text: String(c), font: FONT, size,
            bold: bold || header,
            color: color ?? (header ? HEX.white : HEX.body),
          })],
        })
      : c,
  )
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    shading: header ? shade(HEX.navy) : fill ? shade(fill) : undefined,
    margins: { top: 70, bottom: 70, left: 100, right: 100 },
    borders: cellBorders,
    children: paras,
  })
}
export { cell }

// Generic bordered table. columnWidths MUST sum to the table width (brief §3 gotcha).
// `headerAligns` optionally overrides per-column header alignment.
export function gridTable({
  headers, rows, columnWidths, headerSize = SIZE.table, bodySize = SIZE.table,
  headerAligns, altShade = true,
}) {
  const sum = columnWidths.reduce((a, b) => a + b, 0)
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((hd, i) =>
      cell(hd, { width: columnWidths[i], header: true, size: headerSize, align: headerAligns?.[i] ?? AlignmentType.CENTER })),
  })
  const bodyRows = rows.map((r, ri) =>
    new TableRow({
      children: r.map((c, i) => {
        const base = altShade && ri % 2 ? HEX.altRow : undefined
        if (c && typeof c === 'object' && !(c instanceof Paragraph)) {
          return cell(c.text ?? '', {
            width: columnWidths[i], size: bodySize,
            fill: c.fill ?? base, align: c.align ?? AlignmentType.LEFT, bold: c.bold, color: c.color,
          })
        }
        return cell(c ?? '', { width: columnWidths[i], size: bodySize, fill: base })
      }),
    }),
  )
  return new Table({ width: { size: sum, type: WidthType.DXA }, columnWidths, rows: [headerRow, ...bodyRows] })
}

export const riskFill = (score) => riskBand(score).hex

// Risk-band legend: a single borderless-header row of four colour-coded cells,
// each sitting on its band colour with navy text. Matches the reference RA.
export function bandLegend() {
  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    columnWidths: [2250, 2250, 2250, 2250],
    rows: [new TableRow({
      children: RISK_BANDS.map((b) => new TableCell({
        width: { size: 2250, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: shade(b.hex),
        margins: { top: 70, bottom: 70, left: 100, right: 100 },
        borders: cellBorders,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            text: `${b.label.toUpperCase()} (${b.max === Infinity ? `${b.min}+` : `${b.min}–${b.max}`})`,
            font: FONT, size: 16, bold: true, color: HEX.navy,
          })],
        })],
      })),
    })],
  })
}

// --- Document control table (cover page) ------------------------------
// rows: [[label, value], ...]. Cols 3000 / 6000 = 9000, per reference.
export function documentControlTable(rows, totalWidth = 9000) {
  const labelW = 3000
  const valueW = totalWidth - labelW
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: [labelW, valueW],
    rows: rows.map(([k, v]) =>
      new TableRow({
        children: [
          cell(/:$/.test(k) ? k : `${k}:`, {
            width: labelW, fill: HEX.altRow, bold: true, color: HEX.navy, size: SIZE.ctlLabel,
          }),
          cell(v ?? '', { width: valueW, size: SIZE.ctlValue }),
        ],
      }),
    ),
  })
}

// --- Cover page ------------------------------------------------------
// Returns an ARRAY of section children (Paragraphs + Tables at top level).
export function coverPage({ logo, docTypeStrap, title, clientName, siteName, controlRows = [] }) {
  const out = []
  out.push(new Paragraph({ spacing: { after: 360 }, children: logo ? [logo] : [] }))
  out.push(new Paragraph({
    spacing: { before: 480, after: 120 },
    children: [new TextRun({
      text: (docTypeStrap || 'SAFETY FILE DOCUMENT').toUpperCase(),
      font: FONT, size: SIZE.coverStrap, bold: true, color: HEX.gold, characterSpacing: 20,
    })],
  }))
  out.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: title || '', font: FONT, size: SIZE.coverTitle, bold: true, color: HEX.navy })],
  }))
  out.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: clientName || '', font: FONT, size: SIZE.coverClient, color: HEX.navySoft })],
  }))
  out.push(new Paragraph({
    spacing: { after: 420 },
    children: siteName
      ? [new TextRun({ text: siteName, font: FONT, size: SIZE.coverSite, italics: true, color: HEX.muted })]
      : [],
  }))
  out.push(documentControlTable(controlRows))
  out.push(new Paragraph({
    spacing: { before: 440 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: IMPI.distributionNotice, font: FONT, size: SIZE.notice, italics: true, color: HEX.muted })],
  }))
  return out
}

// --- Header / Footer -----------------------------------------------
export function contentHeader({ logo, docTitle }) {
  return new Header({
    children: [
      new Table({
        width: { size: 9360, type: WidthType.DXA }, columnWidths: [4680, 4680], borders: noBorders,
        rows: [new TableRow({
          children: [
            new TableCell({
              width: { size: 4680, type: WidthType.DXA }, borders: noBorders, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ children: logo ? [logo] : [] })],
            }),
            new TableCell({
              width: { size: 4680, type: WidthType.DXA }, borders: noBorders, verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({
                  text: (docTitle || '').toUpperCase(), font: FONT, size: SIZE.ctlLabel, bold: true, color: HEX.muted,
                })],
              })],
            }),
          ],
        })],
      }),
      new Paragraph({
        spacing: { before: 40 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: HEX.navy } },
        children: [],
      }),
    ],
  })
}

// One paragraph: credit line (left) + right-tabbed "Page X of Y", navy-grey rule above.
export function pageFooter() {
  return new Footer({
    children: [
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: HEX.rule } },
        tabStops: [{ type: TabStopType.RIGHT, position: 9026 }],
        children: [
          new TextRun({ text: IMPI.creditLine, font: FONT, size: SIZE.footer, color: HEX.muted }),
          new TextRun({ text: '\tPage ', font: FONT, size: SIZE.footer, color: HEX.muted }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SIZE.footer, color: HEX.muted }),
          new TextRun({ text: ' of ', font: FONT, size: SIZE.footer, color: HEX.muted }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SIZE.footer, color: HEX.muted }),
        ],
      }),
    ],
  })
}
export const coverFooter = pageFooter // reference uses the same footer on every page

// --- Table of Contents entry with dot leader (brief §3 gotcha) ---------
export function tocEntry(number, title, pageLabel) {
  return new Paragraph({
    spacing: { after: 80 },
    tabStops: [{ type: TabStopType.RIGHT, position: 9026, leader: LeaderType.DOT }],
    children: [
      new TextRun({ text: `${number}.  `, font: FONT, size: SIZE.toc, bold: true, color: HEX.navy }),
      new TextRun({ text: title, font: FONT, size: SIZE.toc, color: HEX.body }),
      new TextRun({ text: `\t${pageLabel ?? ''}`, font: FONT, size: SIZE.toc, color: HEX.body }),
    ],
  })
}

// --- Section + Document builders --------------------------------
export function makeSection({ children, orientation = 'portrait', margin, header, footer, titleForHeader }) {
  const geo = PAGE[orientation]
  return {
    properties: {
      page: {
        size: { width: geo.width, height: geo.height, orientation },
        margin: margin ?? (orientation === 'landscape' ? MARGIN.landscape : MARGIN.body),
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
    styles: { default: { document: { run: { font: FONT, size: SIZE.body, color: HEX.body } } } },
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
