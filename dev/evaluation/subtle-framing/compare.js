// Offline comparison of existing Evaluation Lab exports. No network/model calls.
import { parseCsv, importDataset } from '../csv.js';
import { canonicalLabel } from '../agreement.js';
import { normalizeResult, KINDS } from '../../../src/engine/contract.js';
const reviewed = status => ['agreed', 'reviewed_agreed', 'adjudicated'].includes(canonicalLabel(status));
const records = csv => {
  const [header, ...rows] = parseCsv(csv);
  if (!header || new Set(header).size !== header.length) throw new Error('Invalid export headers.');
  return rows.map(row => {
    if (row.length !== header.length) throw new Error('Invalid export row shape.');
    return Object.fromEntries(header.map((h, i) => [h, row[i]]));
  });
};
const ratio = (n, d) => d ? n / d : null;
function metrics(rows) {
  const matrix = Object.fromEntries(KINDS.map(k => [k, Object.fromEntries(KINDS.map(p => [p, 0]))]));
  for (const r of rows) matrix[r.reference][r.prediction]++;
  const flagged = rows.filter(r => r.prediction !== 'clean');
  const negatives = rows.filter(r => r.reference === 'clean');
  const legitimate = rows.filter(r => r.caseType === 'legitimate_reporting' && r.reference === 'clean');
  return {
    cases: rows.length, confusion_matrix: matrix,
    recall: Object.fromEntries(KINDS.map(k => [k, ratio(matrix[k][k], rows.filter(r => r.reference === k).length)])),
    flagged_precision: ratio(flagged.filter(r => r.reference !== 'clean').length, flagged.length),
    flagged_precision_definition: 'Human emotional reference among flagged predictions; wrong emotional categories are separately visible in the matrix.',
    exact_category_flagged_precision: ratio(flagged.filter(r => r.reference === r.prediction).length, flagged.length),
    false_positive_rate_clean: ratio(negatives.filter(r => r.prediction !== 'clean').length, negatives.length),
    false_positive_rate_legitimate_reporting: ratio(legitimate.filter(r => r.prediction !== 'clean').length, legitimate.length),
  };
}
function readRun(csv, dataset, expectedPolicy) {
  const rows = records(csv), byId = new Map(), expected = new Map(dataset.map(row => [row.id, row]));
  for (const r of rows) {
    if (!expected.has(r.headline_id)) throw new Error('Export contains an unknown headline ID.');
    if (byId.has(r.headline_id)) throw new Error('A file must contain one run, with no repeated IDs.');
    const ref = expected.get(r.headline_id);
    if (r.headline !== ref.text || r.dataset_id !== ref.datasetId) throw new Error('Dataset identity or headline text differs between worksheet and export.');
    if (r.policy_version !== expectedPolicy) throw new Error(`Expected policy ${expectedPolicy}.`);
    if (r.status === 'success' && r.evaluation_origin !== 'fresh' && !ref.duplicateOf) throw new Error('Comparison requires fresh Evaluation Lab inference, not browsing cache or mock results.');
    let result, evidenceValid = null;
    if (r.status === 'success') {
      try {
        if (!r.score.trim() || !['cloud', 'on-device'].includes(r.inference_source)) throw new Error();
        const words = JSON.parse(r.trigger_evidence_json), explanations = JSON.parse(r.explanations_json);
        if (!Array.isArray(words) || !Array.isArray(explanations) || words.length !== explanations.length) throw new Error();
        result = normalizeResult({ kind: r.model_classification, source: r.inference_source, score: Number(r.score),
          triggers: words.map((word, i) => ({ word, why: explanations[i] })), honest_rewrite: r.headline }, r.headline);
        evidenceValid = true;
      } catch { evidenceValid = false; }
    }
    byId.set(r.headline_id, { ...r, result, evidenceValid });
  }
  const unique = key => [...new Set(rows.map(r => r[key]).filter(Boolean))];
  for (const key of ['run_id', 'git_sha', 'policy_version', 'configured_cloud_model', 'sdk_version', 'local_only']) {
    if (unique(key).length > 1) throw new Error(`Mixed ${key} values: use one exported run per file.`);
  }
  const successful = rows.filter(r => r.status === 'success');
  const failed = rows.filter(r => r.status === 'failed');
  const invalid = [...byId.values()].filter(r => r.evidenceValid === false);
  const batches = new Map();
  for (const r of rows) if (r.status === 'success' && r.batch_id && r.batch_round_trip_ms.trim() && Number.isFinite(Number(r.batch_round_trip_ms)) && Number(r.batch_round_trip_ms) >= 0) {
    if (batches.has(r.batch_id) && batches.get(r.batch_id) !== Number(r.batch_round_trip_ms)) throw new Error('Inconsistent batch timing.');
    batches.set(r.batch_id, Number(r.batch_round_trip_ms));
  }
  return { byId, provenance: Object.fromEntries(['run_id','run_timestamp','git_sha','git_dirty','policy_version','configured_cloud_model','sdk_version','resolved_model_version','local_only'].map(k => [k, unique(k)[0] || 'unknown'])),
    coverage: { expected: dataset.length, exported: rows.length, successful: successful.length, failed: failed.length,
      missing: dataset.length - rows.length, other_status: rows.length - successful.length - failed.length,
      observed_row_failure_rate: ratio(failed.length, successful.length + failed.length),
      non_success_coverage_rate: ratio(dataset.length - successful.length, dataset.length),
      invalid_classification_errors: failed.filter(r => r.error_code === 'debait/invalid-classification').length,
      invalid_exported_evidence: invalid.length, structural_evidence_validity_rate: ratio(successful.length - invalid.length, successful.length),
      error_codes: Object.fromEntries([...new Set(failed.map(r => r.error_code))].map(k => [k, failed.filter(r => r.error_code === k).length])) },
    timing: { successful_batches_with_timing: batches.size, mean_batch_round_trip_ms: batches.size ? [...batches.values()].reduce((a,b)=>a+b,0)/batches.size : null,
      note: 'Batch round trip includes authentication/transport/inference. Successful batches are not a full API request count. Dispatch attempts include local pacing/cooldown; tokens and billed cost are unavailable.' } };
}
export function comparePolicies(worksheetCsv, baselineCsvs, candidateCsvs) {
  if (!baselineCsvs.length || baselineCsvs.length !== candidateCsvs.length) throw new Error('Supply equal, nonzero numbers of baseline and candidate runs.');
  const dataset = importDataset(worksheetCsv).rows;
  const ids = [...new Set(dataset.map(r => r.datasetId))];
  if (ids.length !== 1 || !ids[0]) throw new Error('The worksheet needs one nonempty dataset_id.');
  const conflicts = new Set();
  for (const row of dataset) {
    const labels = new Set(dataset.filter(r => r.text === row.text && reviewed(r.reviewStatus)).map(r => canonicalLabel(r.humanLabel)).filter(Boolean));
    if (labels.size > 1) conflicts.add(row.text);
  }
  const runs = baselineCsvs.map((csv, i) => [readRun(csv, dataset, 'quality-classification-evidence-v4'), readRun(candidateCsvs[i], dataset, 'quality-subtle-framing-v5')]);
  const cases = [], comparisons = [];
  for (let repeat = 0; repeat < runs.length; repeat++) {
    const [baseline, candidate] = runs[repeat], left = [], right = [], sameSource = [];
    for (const row of dataset) {
      const a = baseline.byId.get(row.id), b = candidate.byId.get(row.id);
      const reference = canonicalLabel(row.humanLabel);
      const exclusion = conflicts.has(row.text) ? 'conflicting_references' : row.duplicateOf ? 'duplicate_headline'
        : !reviewed(row.reviewStatus) ? 'reference_not_agreed' : !KINDS.includes(reference) ? 'unsupported_reference'
        : !a?.result || !b?.result ? 'both_successful_valid_results_required' : '';
      const record = { repeat: repeat + 1, headline_id: row.id, headline: row.text, case_type: row.caseType, pair_id: row.pairId,
        draft_label: row.draftLabel, human_reference_label: row.humanLabel, review_status: row.reviewStatus,
        baseline_prediction: a?.result?.kind || '', candidate_prediction: b?.result?.kind || '',
        baseline_source: a?.inference_source || '', candidate_source: b?.inference_source || '',
        baseline_status: a?.status || 'missing', candidate_status: b?.status || 'missing',
        baseline_evidence: a?.trigger_evidence_json || '[]', candidate_evidence: b?.trigger_evidence_json || '[]',
        baseline_explanations: a?.explanations_json || '[]', candidate_explanations: b?.explanations_json || '[]',
        baseline_error: a?.error_code || '', candidate_error: b?.error_code || '',
        metric_eligible: !exclusion, exclusion_reason: exclusion,
        changed: !!(a?.result && b?.result && a.result.kind !== b.result.kind) };
      cases.push(record);
      if (!exclusion) {
        left.push({ reference, prediction: a.result.kind, caseType: row.caseType });
        right.push({ reference, prediction: b.result.kind, caseType: row.caseType });
        if (a.inference_source === b.inference_source) sameSource.push({ row, a, b, reference });
      }
    }
    const sourceMetrics = Object.fromEntries(['cloud','on-device'].map(source => {
      const cohort = sameSource.filter(r => r.a.inference_source === source);
      return [source, { paired_cases: cohort.length,
        baseline: metrics(cohort.map(r => ({reference:r.reference,prediction:r.a.result.kind,caseType:r.row.caseType}))),
        candidate: metrics(cohort.map(r => ({reference:r.reference,prediction:r.b.result.kind,caseType:r.row.caseType}))) }];
    }));
    const configComparable = ['configured_cloud_model','sdk_version','local_only'].every(k => baseline.provenance[k] !== 'unknown' && baseline.provenance[k] === candidate.provenance[k]);
    const exploratoryPairs = cases.filter(r => r.repeat === repeat + 1 && r.baseline_prediction && r.candidate_prediction && !dataset.find(d => d.id === r.headline_id)?.duplicateOf);
    const distribution = policy => Object.fromEntries(KINDS.map(k => [k, exploratoryPairs.filter(r => r[policy + '_prediction'] === k).length]));
    comparisons.push({ repeat: repeat + 1, exploratory: { paired_valid_cases: exploratoryPairs.length,
      changed_predictions: exploratoryPairs.filter(r => r.changed).length,
      baseline_prediction_counts: distribution('baseline'), candidate_prediction_counts: distribution('candidate'),
      note: 'Descriptive prediction differences only, not accuracy or evidence that flagging more is better.' }, baseline: { provenance: baseline.provenance, coverage: baseline.coverage, timing: baseline.timing, metrics: metrics(left) },
      candidate: { provenance: candidate.provenance, coverage: candidate.coverage, timing: candidate.timing, metrics: metrics(right) },
      config_comparable: configComparable, source_matched: sourceMetrics,
      limitations: [...(!left.length ? ['No paired reviewed references: performance metrics cannot be established.'] : []),
        ...(!configComparable ? ['Model/SDK/privacy configuration differs or is unknown; no controlled policy-effect claim.'] : []),
        ...(sameSource.length !== left.length ? ['Some pairs used different inference sources; use source-matched results.'] : [])] });
  }
  const consistency = policy => Object.fromEntries(['cloud','on-device'].map(source => {
    const groups = new Map();
    for (const r of cases) if (r[policy+'_prediction'] && r[policy+'_source'] === source && !dataset.find(d => d.id === r.headline_id)?.duplicateOf) {
      const observations = groups.get(r.headline_id) || []; observations.push(r[policy+'_prediction']); groups.set(r.headline_id, observations);
    }
    const repeated = [...groups.values()].filter(g => g.length > 1);
    return [source, { cases_observed_at_least_twice: repeated.length, all_observed_predictions_agree: repeated.filter(g => new Set(g).size === 1).length,
      consistency_rate: ratio(repeated.filter(g => new Set(g).size === 1).length, repeated.length) }];
  }));
  return { dataset_id: ids[0], dataset_cases: dataset.length,
    scope: 'Offline arithmetic on supplied Evaluation Lab exports; file metadata is not independent attestation of real model execution. Draft labels never become ground truth.',
    metric_definition: 'Only unique, agreed supported references with successful structurally valid results in BOTH policies enter paired metrics. Confidence intervals and statistical superiority are not established by this report.',
    comparisons, consistency: { baseline: consistency('baseline'), candidate: consistency('candidate') }, cases };
}
