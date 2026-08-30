// Single source of truth for the IMPI SafetyFile Pro design system.
// Consumed by the React UI (via src/index.css mirrors) AND by the docx generators
// in src/docgen. Do not fork these values per-document — import from here.
//
// Design system confirmed & approved by the client. Do not redesign; implement as-is.

// --- Colours -----------------------------------------------------------------
// docx wants hex WITHOUT the leading '#'. UI wants it WITH. Keep both.
const raw = {
  navy: '1F2A3C', //  primary structure
  navySoft: '34455E', //  subheadings
  rule: 'C9CDD3', //  rule / border grey
  altRow: 'F4F5F7', //  alternate row shading
  gold: 'B8942E', //  accent — sparing use only
  riskLow: 'C6E7C1',
  riskMedium: 'FFE699',
  riskHigh: 'F7B884',
  riskExtreme: 'E8746B',
  body: '222222', //  body text
  muted: '5B6472', //  muted / italic text
  white: 'FFFFFF',
  black: '000000',
}

export const HEX = raw // no '#'  -> for docx
export const COLOR = Object.fromEntries(
  Object.entries(raw).map(([k, v]) => [k, `#${v}`]),
) // with '#' -> for CSS/inline styles

// --- Typography ------------------------------------------------------------------
export const FONT = 'Calibri'
// docx font sizes are in half-points (20 = 10pt). Values below are matched
// to the four approved reference templates in /reference-docs.
export const SIZE = {
  coverStrap: 20, // 10pt, gold, uppercase, +20 twip tracking
  coverTitle: 44, // 22pt, navy, bold
  coverClient: 26, // 13pt, navy-soft
  coverSite: 22, // 11pt, italic, muted
  ctlLabel: 18, // 9pt, bold navy, on F4F5F7
  ctlValue: 20, // 10pt, body
  notice: 16, // 8pt, italic, muted, centred
  h1: 26, // 13pt section heading, navy, bold, navy bottom-rule
  h2: 22, // 11pt subheading, navy-soft, bold
  h3: 22,
  body: 20, // 10pt body copy
  table: 17, // 8.5pt portrait tables (Method Statement, Audit Report)
  raText: 15, // 7.5pt landscape risk register
  toc: 22, // 11pt TOC entries
  tocIntro: 19, // 9.5pt TOC intro / notes
  footer: 14, // 7pt footer credit + page number
  small: 14,
}

// --- Risk scoring (A x B x C x D = R) -------------------------------------------
// Bands per brief section 3: Low 1-8, Medium 9-27, High 28-64, Extreme 65+.
export const RISK_BANDS = [
  { key: 'low', label: 'Low', min: 1, max: 8, hex: raw.riskLow, color: `#${raw.riskLow}` },
  { key: 'medium', label: 'Medium', min: 9, max: 27, hex: raw.riskMedium, color: `#${raw.riskMedium}` },
  { key: 'high', label: 'High', min: 28, max: 64, hex: raw.riskHigh, color: `#${raw.riskHigh}` },
  { key: 'extreme', label: 'Extreme', min: 65, max: Infinity, hex: raw.riskExtreme, color: `#${raw.riskExtreme}` },
]

export function riskBand(score) {
  const n = Number(score) || 0
  return RISK_BANDS.find((b) => n >= b.min && n <= b.max) ?? RISK_BANDS[0]
}

// --- IMPI branding -------------------------------------------------------------
// IMPI branding on generated documents is a SMALL footer credit line ONLY.
// The client's own logo is the primary branding on every document.
export const IMPI = {
  legalName: 'IMPI Protection Agency (Pty) Ltd',
  // Two spaces around each pipe — matches the reference templates.
  creditLine: 'Compiled by IMPI Protection Agency (Pty) Ltd  |  012 543 0640  |  info@impi-secure.co.za',
  distributionNotice:
    'Prepared for the exclusive use of the above client. Distribution outside this scope requires written consent.',
}
