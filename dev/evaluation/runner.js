import { importDataset } from './csv.js';
import { summarize, agreement } from './agreement.js';
import { createRun } from './session.js';
import { sendRuntimeMessage } from '../../src/shared/messaging.js';
import { getSettings } from '../../src/shared/storage.js';
const $ = id => document.getElementById(id);
let dataset, run;
const exclusionLabel = {
  no_successful_real_result: 'No successful AI result yet', duplicate_headline: 'Excluded: duplicate headline',
  conflicting_duplicate_references: 'Excluded: conflicting human labels for this headline',
  reference_not_agreed: 'Excluded: human reviewers have not agreed',
  unsupported_or_missing_reference: 'Excluded: missing human label or category not supported yet',
};
function render(rows = dataset?.rows || [], message) {
  if (message) $('message').textContent = message;
  const summary = summarize(rows);
  $('counts').textContent = `Completed: ${summary.completed} · Pending: ${summary.pending} · Failed: ${summary.failed} · Cancelled: ${summary.cancelled} · Interrupted: ${summary.interrupted}`;
  $('agreement').textContent = `Reference agreement: ${summary.matches}/${summary.eligible} eligible${summary.agreement === null ? ' (no defensible comparison yet)' : ` (${Math.round(summary.agreement * 100)}%)`}. Excluded: ${summary.excluded}. Duplicate rows do not add weight.`;
  $('rows').replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    const assessment = agreement(row);
    for (const text of [row.id, row.text, `${row.draftLabel || '—'} / ${row.humanLabel || '—'} (${row.reviewStatus || 'not reviewed'})`,
      row.result ? `${row.result.kind} / ${row.result.source}` : '—',
      `${row.status || 'pending'} · ${assessment.agreement_eligible ? (assessment.agreement ? 'Agrees with human reference' : 'Disagrees with human reference') : exclusionLabel[assessment.exclusion_reason]}${row.errorMessage ? ` · ${row.errorMessage}` : ''}`]) {
      const td = document.createElement('td'); td.textContent = text; tr.append(td);
    }
    $('rows').append(tr);
  }
  $('start').disabled = !dataset || !!run?.running;
  $('cancel').disabled = !run?.running || !rows.some(row => ['pending', 'active'].includes(row.status));
  $('file').disabled = !!run?.running;
  $('download').disabled = !run;
}
async function showPrivacy() {
  try {
    const settings = await getSettings();
    $('privacy').textContent = settings.localOnly
      ? 'Local Only is ON: tests must run on-device. Cloud inference is forbidden. If the device model is unavailable, the run will fail honestly.'
      : 'Local Only is OFF: test headlines may be sent to Gemini cloud through Firebase. Only import public or fictional test data.';
  } catch { $('privacy').textContent = 'The extension connection is unavailable. Reload the unpacked development extension and refresh this page.'; }
}
showPrivacy();
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.settings) showPrivacy(); });
$('file').addEventListener('change', async () => {
  dataset = null; run = null;
  try {
    const file = $('file').files[0];
    if (!file) return render([], 'Choose a CSV file.');
    if (file.size > 2 * 1024 * 1024) throw new Error('Use a CSV smaller than 2 MB.');
    dataset = importDataset(await file.text());
    dataset.rows.forEach(row => { row.status = 'pending'; });
    $('imported').textContent = `${dataset.rows.length} headlines imported; ${dataset.uniqueCount} unique headlines. ${dataset.rows.length - dataset.uniqueCount} exact duplicate rows will reuse the same answer within this run.`;
    render(dataset.rows, dataset.missingReviewColumns ? 'Imported. Human reference/review columns are missing: predictions can run, but those rows cannot contribute to agreement.' : 'Imported. Ready for fresh analysis.');
  } catch (error) { $('imported').textContent = 'No dataset imported.'; render([], error.message); }
});
$('start').addEventListener('click', async () => {
  run = createRun(dataset.rows, { send: sendRuntimeMessage, changed: render });
  const operation = run.start(); render(run.rows, 'Starting evaluation…'); await operation;
});
$('cancel').addEventListener('click', () => run?.cancel());
$('download').addEventListener('click', () => {
  const blob = new Blob([run.csv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `debait-evaluation-${run.metadata.run_id || 'interrupted'}.csv`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
addEventListener('pagehide', () => { if (run?.running) run.cancel(); });
