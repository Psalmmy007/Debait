# Subtle-framing experiment: human review and real-model evaluation

Do not adopt this candidate based on the percentage flagged. No real Gemini evaluation
has been performed by this implementation. All labels in challenge-v1.csv are provisional.
The normal four-category schema and all rewrite/privacy/auth/quota protections remain.

## Dataset and blind review

Dataset ID: debait-subtle-framing-v1; 80 unique synthetic headlines:
36 cases in 18 minimal pairs; 9 obvious emotional cases; 12 legitimate reports;
6 quotation cases; 5 curiosity-only cases; 12 disputed/ambiguous exploratory cases. The latter preserve the earlier 12-row uploaded review verbatim;
source_* columns distinguish its historical draft/prediction from new provisional
labels. That earlier file has no adjudicated references or complete run provenance.
Rage/Fear/Envy minimal pairs cover six pairs each. This deliberately enriched challenge
set does not represent real browsing prevalence and is not an independent population
sample. C01/C02 are existing regression anchors also present in both prompts; do not
present them as unseen holdout evidence. Other examples differ in wording from training
examples but are not an independently collected external validation set.

1. Copy challenge-v1.csv to a local human-review worksheet. Do not overwrite the
   original provisional file when adjudicating. Hide draft_label/provisional_rationale
   and model predictions during independent review to reduce anchoring.
2. Two reviewers independently fill reviewer_1_label and reviewer_2_label, using only
   the headline and the same four-category definitions. Judge observable wording,
   not article truth, intent or whether the story is upsetting.
3. For disagreement, record both interpretations and exact pressure-bearing evidence
   in disagreements/adjudication_notes. Set review_status=disputed. A rhetorical
   question, urgency or quotation alone does not decide the label.
4. Only after agreement/adjudication, fill human_reference_label with Rage, Fear,
   Envy or Clean and review_status=agreed (or adjudicated). If still unresolved, keep
   disputed/pending. An unsupported reference such as Curiosity Gap or Uncertain is
   retained as an annotation and excluded from current four-category metrics. Do not
   turn it into Clean automatically. Curiosity-only drafts here use Clean under the
   current limited schema, not a statement that no clickbait exists.
5. Review Fear carefully: vague personalized danger/coercion versus proportionate
   health, flood, travel or security advice. For Rage separate reported wrongdoing
   and attributed criticism from added resentment/hostility. For Envy require status
   or comparison pressure, not mere wealth reporting or information withholding.
6. Keep ambiguous cases and counterexamples; do not delete disagreements to improve
   a score. The supplied files contain zero agreed human labels. A manual agreed
   status is a reviewer assertion, not independently verified annotation provenance.

## Build baseline and candidate (same experimental commit)

The baseline prompt is frozen from b154339e76104dc0499cacaa4d775575d514d21d.
Its SHA-256 for headlinePrompt(['baseline-provenance-probe']) is
`db6fc48e4d90d124630eda61f4b005d24103c0b6b1cf10d791c11b6456d3adcf`.
The candidate replaces only its Classification block; the Rewrite policy and JSON
input/output instructions are identical. Semantic acceptance code is unchanged.

Use the existing authorized, unpacked development extension and private App Check
registration. Never disable enforcement, copy secrets into CSVs or change Firebase
projects. There is no new API caller. Build selection is immutable during each run:

    VITE_DEBAIT_CLASSIFICATION_POLICY=baseline-v4 VITE_DEBAIT_APP_CHECK=debug npm run build:dev
    node scripts/check-classification-policy-build.js baseline-v4

Reload the extension, refresh Evaluation Lab and any old content-script tabs. Open
chrome-extension://YOUR_EXTENSION_ID/dev/evaluation/index.html (find the ID under
chrome://extensions). Keep the intended privacy setting unchanged across comparisons.
If Local Only is on, unavailable Nano must fail; never turn it off silently to finish
an evaluation. Only import public/synthetic data. Close unrelated news tabs to reduce
other quota traffic. Do not browse in order to generate test results/statistics.

Upload the reviewed worksheet, run, download baseline-1.csv before rebuilding. The
runner always uses fresh inference and the existing shared gate/offscreen/Firebase SDK.
It deduplicates within a run, never uses browsing caches or contributes reading stats.
Then build the candidate, reload and import the exact same worksheet in the same order:

    VITE_DEBAIT_CLASSIFICATION_POLICY=subtle-v5 VITE_DEBAIT_APP_CHECK=debug npm run build:dev
    node scripts/check-classification-policy-build.js subtle-v5

Download candidate-1.csv. Confirm dataset_id, policy_version, configured_cloud_model,
sdk_version, inference_source and Local Only match the intended setup. Actual resolved
model version remains unknown if not exposed by the existing SDK path. Do not invent it.
No UI controls or source claims were added for policy switching. Existing working
branches are untouched; this branch defaults to the experimental candidate.

An 80-case run uses 20 batches of four before retries. One baseline/candidate pair
therefore needs at least 40 dispatches; a second pair at least 80 total. These are
planning counts, not verified Gemini API submissions: pacing/cooldown attempts,
SDK behavior, on-device routing and failures can change actual usage. Defaults remain
shared conservative local budgets, not guaranteed Google quota allocations. Let the
existing gate wait; cancel safely if needed. No new automated re-evaluation loop.
For consistency assessment, repeat with counterbalanced order: candidate then baseline
for the second pair. Keep batch order/settings/model unchanged; record timing/order.
Repeated calls consume quota and may produce different predictions. SDK model aliases
can change between runs even if configured IDs match.

## Offline paired report

No network or inference is performed by this command:

    node scripts/compare-classification-policies.js \
      --worksheet /path/reviewed-worksheet.csv \
      --baseline /path/baseline-1.csv \
      --candidate /path/candidate-1.csv \
      --out /path/local-policy-report

For repetitions, repeat both --baseline and --candidate flags in matching repeat order.
The report writes comparison.json plus spreadsheet-safe paired-cases.csv. Keep private
exports/review files local and uncommitted. Dataset ID, exact headline text, policy
versions, unique IDs and fresh-evaluation origin are checked. Only successful real-
source rows with structurally valid copied evidence can enter a paired comparison.
File metadata is not independent attestation that a supplied CSV came from real AI.
Controlled fixtures/tests are kept separately and never presented as genuine results.

Metrics use the SAME unique, agreed supported references with valid results in BOTH
policies; duplicates, conflicting references, missing/unsupported labels and failures
are excluded and disclosed. Metrics are computed separately per repeat and for pairs
where both results used the same source. Configuration differences produce warnings.
- Per-category recall and four-by-four confusion matrix (rows reference, columns prediction).
- Flagged precision = any reviewed emotional reference among flagged predictions.
  Exact-category flagged precision is also reported to expose emotion swaps.
- False-positive rate on reviewed Clean cases, and separately the legitimate_reporting
  subset. Quotations/minimal neutral pairs remain inspectable in paired-cases.csv.
- Observed row failure rate = failed / (success + failed), not Gemini API failure rate.
  Missing/interrupted/cancelled rows are shown in coverage. Invalid-classification errors
  are counted separately. Coverage and metric denominators must be reported together.
- Structural evidence validity = export rows accepted by the existing exact-evidence
  validator / successful rows. This does not establish that the explanation is persuasive
  or that the category is semantically correct. Human evidence audit is still required.
- Successful batch round-trip timing includes transport, authentication and inference,
  not just model latency. Submission_attempts counts client dispatches, including local
  pacing/cooldown attempts; it is NOT a Gemini request counter. Batch IDs avoid counting
  one timing once per headline. Token usage and billed request cost are unavailable.
- Repeated prediction consistency is reported by source without treating consistency
  as correctness. Insufficient observations yield null, not fabricated certainty.

No metrics can be established for the supplied pending worksheet. The comparison
command can report exploratory prediction changes on pending cases, but it never uses
provisional labels as reference truth. Inspect FP/FN candidates manually, then collect
additional unseen, reviewed reporting before making a generalization claim.
