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
// docx font sizes are in half-points (22 = 11pt).
export const SIZE = {
  coverTitle: 40, // 20pt
  coverStrap: 20, // 10pt, letter-spaced, gold, uppercase
  h1: 30, // 15pt
  h2: 24, // 12pt
  h3: 22, // 11pt bold
  body: 22, // 11pt
  table: 20, // 10pt
  small: 16, // 8pt  (footer credit, distribution notice)
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
  creditLine: 'Compiled by IMPI Protection Agency (Pty) Ltd | 012 543 0640 | info@impi-secure.co.za',
  distributionNotice:
    'This document is issued for the exclusive use of the client named above and its appointed ' +
    'representatives. It may not be reproduced or distributed without written permission.',
}
