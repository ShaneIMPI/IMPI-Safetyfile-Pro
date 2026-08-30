// Registry: document template type_code -> generator module.
// Bespoke generators for RA / MS / AUD; everything else uses genericDocument.

import * as riskAssessment from './riskAssessment.js'
import * as methodStatement from './methodStatement.js'
import * as auditReport from './auditReport.js'
import * as genericDocument from './genericDocument.js'
import * as safetyFileCover from './safetyFileCover.js'

const REGISTRY = {
  RA: riskAssessment,
  MS: methodStatement,
  AUD: auditReport,
  SF: safetyFileCover,
}

export function generatorFor(typeCode) {
  return REGISTRY[typeCode] || genericDocument
}

// Which library data a generator needs, so the Document Builder can pre-load it.
export function generatorNeeds(typeCode) {
  const gen = generatorFor(typeCode)
  return gen.meta?.needs ?? []
}

export { riskAssessment, methodStatement, auditReport, genericDocument, safetyFileCover }
