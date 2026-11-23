import { planAnalysisRetry } from '../../src/shared/quota.js';
import { agreement, canonicalLabel } from './agreement.js';
import { exportCsv } from './csv.js';

const pause = (ms, signal) => new Promise(resolve => {
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  signal.addEventListener('abort', done, { once: true });
  if (signal.aborted) done();
});
export function createRun(dataset, { send, changed = () => {}, wait = pause, now = Date.now, random = Math.random } = {}) {
  const rows = dataset.map(row => ({ ...row, status: 'pending', attempts: 0 }));
  // Identical texts with conflicting agreed references cannot support agreement.
  for (const text of new Set(rows.map(row => row.text))) {
    const group = rows.filter(row => row.text === text);
    const references = new Set(group.filter(row => ['agreed', 'reviewed_agreed', 'adjudicated'].includes(canonicalLabel(row.reviewStatus)))
      .map(row => canonicalLabel(row.humanLabel)).filter(Boolean));
    if (references.size > 1) group.forEach(row => { row.referenceConflict = true; });
  }
  const abort = new AbortController();
  let runId, running = false, cancelled = false, cancellation;
  let metadata = { run_id: '', run_timestamp: new Date(now()).toISOString(), git_sha: 'unknown',
    policy_version: 'unknown', git_dirty: 'unknown', local_only: 'unknown' };
  const notify = message => changed(rows, message);
  const stopPending = (status, code) => {
    for (const row of rows) if (['pending', 'active'].includes(row.status)) Object.assign(row, { status, errorCode: code });
  };
  const apply = (group, patch) => group.forEach(row => Object.assign(row, patch));
  function confirmCancellation() {
    return cancellation ||= send({ type: 'debait/evaluation-cancel', runId }).then(reply => {
      notify(reply?.ok ? 'Cancelled. No new inference will start for this request. A request already sent may still finish and use quota; its answer will be discarded.'
        : 'Cancellation could not be confirmed. Results are discarded; reload the extension before retrying if it remains unresponsive.');
    }).catch(() => notify('Cancellation could not be confirmed. Results are discarded; check the extension before retrying.'));
  }
  return {
    rows, get running() { return running; }, get metadata() { return metadata; },
    cancel() {
      cancelled = true; abort.abort(); stopPending('cancelled', 'debait/evaluation-cancelled');
      notify('Stopping evaluation. Results are discarded while cancellation is confirmed…');
      if (runId) void confirmCancellation();
      else notify('Evaluation cancelled before any headline batch was sent.');
    },
    async start() {
      if (running || runId || cancelled) throw new Error('Start a new evaluation run to analyze again.');
      running = true;
      try {
        const begin = await send({ type: 'debait/evaluation-begin' });
        if (!begin?.ok) throw new Error(begin?.error || 'The evaluation page could not connect to the development extension.');
        runId = begin.runId;
        metadata = { run_id: runId, run_timestamp: begin.startedAt, git_sha: begin.gitSha,
          policy_version: begin.policyVersion, git_dirty: begin.gitDirty ?? 'unknown', local_only: begin.localOnly };
        if (cancelled) { await confirmCancellation(); return; }
        const unique = [...new Set(rows.map(r => r.text))];
        for (let offset = 0; offset < unique.length && !cancelled; offset += 4) {
          const texts = unique.slice(offset, offset + 4);
          const group = rows.filter(row => texts.includes(row.text));
          const retries = {}; let done = false;
          while (!done && !cancelled) {
            apply(group, { status: 'active' });
            group.forEach(row => row.attempts++);
            notify('Analyzing the next batch using the real Debait pipeline…');
            const response = await send({ type: 'debait/evaluation-score', runId, texts });
            if (cancelled) break;
            if (response?.ok) {
              if (!Array.isArray(response.results) || response.results.length !== texts.length || response.results.some(r =>
                !['cloud', 'on-device'].includes(r?.source) || (metadata.local_only && r.source !== 'on-device'))) {
                throw new Error('The evaluation received an invalid or non-real inference source.');
              }
              for (const row of group) {
                Object.assign(row, { status: 'success', result: response.results[texts.indexOf(row.text)],
                  modelMetadata: response.evaluationMetadata, analyzedAt: new Date(now()).toISOString() });
              }
              done = true;
            } else {
              if (String(response?.code || '').startsWith('debait/quota') && response.autoRetry === true) {
                const retry = planAnalysisRetry([retries], response, now(), random);
                if (retry) {
                  notify(`${response.error} Next attempt after ${new Date(retry.at).toLocaleTimeString()}. You can cancel while waiting.`);
                  await wait(Math.max(0, retry.at - now()), abort.signal);
                  continue;
                }
              }
              apply(group, { status: 'failed', errorCode: response?.code || 'debait/evaluation-failed', errorMessage: response?.error || 'No analysis was produced.' });
              done = true;
              if (response?.code !== 'debait/invalid-classification') {
                stopPending('interrupted', response?.code || 'debait/evaluation-failed');
                notify(response?.error || 'Run interrupted. Download partial results, then start a new run.');
                return;
              }
            }
            notify('Batch finished.');
          }
        }
        if (!cancelled) notify('Evaluation finished. Download the CSV to review results and exclusions.');
      } catch {
        // Do not export arbitrary provider/transport payloads or credentials.
        stopPending('interrupted', 'debait/evaluation-interrupted');
        if (!cancelled) notify('Run interrupted or extension unavailable. Download partial results, refresh this page, and start a new run.');
      } finally {
        if (cancelled && runId) await confirmCancellation();
        if (runId) await send({ type: 'debait/evaluation-end', runId }).catch(() => {});
        running = false;
        changed(rows);
      }
    },
    csv() {
      const records = rows.map(row => ({
        headline_id: row.id, headline: row.text, draft_label: row.draftLabel,
        human_reference_label: row.humanLabel, review_status: row.reviewStatus,
        model_classification: row.result?.kind || '',
        trigger_evidence_json: JSON.stringify(row.result?.triggers.map(t => t.word) || []),
        explanations_json: JSON.stringify(row.result?.triggers.map(t => t.why) || []),
        score: row.result?.score ?? '', inference_source: row.result?.source || '', status: row.status,
        error_code: row.errorCode || '', error_message: row.errorMessage || '',
        ...metadata, analyzed_at: row.analyzedAt || '', configured_cloud_model: row.modelMetadata?.configuredModel || 'unknown',
        resolved_model_version: row.modelMetadata?.resolvedModelVersion || 'unknown', sdk_version: row.modelMetadata?.sdkVersion || 'unknown',
        evaluation_origin: row.status === 'success' ? (row.duplicateOf ? 'same_run_duplicate' : 'fresh') : '',
        duplicate_of: row.duplicateOf, submission_attempts: row.attempts, ...agreement(row),
      }));
      return exportCsv(Object.keys(records[0]), records);
    },
  };
}
