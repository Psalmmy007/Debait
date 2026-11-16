import { KINDS } from '../../src/engine/contract.js';
export const canonicalLabel = value => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
export function agreement(row) {
  let exclusion = '';
  if (row.status !== 'success' || !['cloud', 'on-device'].includes(row.result?.source)) exclusion = 'no_successful_real_result';
  else if (row.referenceConflict) exclusion = 'conflicting_duplicate_references';
  else if (row.duplicateOf) exclusion = 'duplicate_headline';
  else if (!['agreed', 'reviewed_agreed', 'adjudicated'].includes(canonicalLabel(row.reviewStatus))) exclusion = 'reference_not_agreed';
  else if (!KINDS.includes(canonicalLabel(row.humanLabel))) exclusion = 'unsupported_or_missing_reference';
  return { agreement_eligible: !exclusion, agreement: exclusion ? '' : canonicalLabel(row.humanLabel) === row.result.kind,
    exclusion_reason: exclusion };
}
export function summarize(rows) {
  const eligible = rows.filter(r => agreement(r).agreement_eligible);
  const matches = eligible.filter(r => agreement(r).agreement).length;
  return { total: rows.length, completed: rows.filter(r => r.status === 'success').length,
    failed: rows.filter(r => r.status === 'failed').length,
    pending: rows.filter(r => ['pending', 'active'].includes(r.status)).length,
    cancelled: rows.filter(r => r.status === 'cancelled').length,
    interrupted: rows.filter(r => r.status === 'interrupted').length,
    eligible: eligible.length, excluded: rows.length - eligible.length, matches,
    agreement: eligible.length ? matches / eligible.length : null };
}
