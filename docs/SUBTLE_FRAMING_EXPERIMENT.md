# Subtle emotional framing: decision report

Foundation: b154339e76104dc0499cacaa4d775575d514d21d on feature/ui-completion.
Experiment only: experiment/subtle-framing-classification. No changes to main, the
UI branch or repair branch. No merge, release or production configuration changes.

## Root cause: established findings versus hypotheses

The current prompt (now frozen in src/engine/policies/baseline-v4.js) defines Rage
broadly but its positive example is explicit hate/outrage. Fear emphasizes exaggerated
or unsupported danger, with a very obvious personal threat/panic example. It correctly
protects distress reporting, medical claims and quotations, and gives three explicit
Envy comparison examples. It has no contrastive accountability/sarcasm example and
little instruction on neutral interpretation versus indirect emotional pressure.
This is a plausible coverage imbalance, not proof that caution caused the observed
predictions. Request/SDK variability, wording difficulty and provisional annotations
also remain plausible. Headline-only analysis cannot establish omitted context or
publisher intent. More labels/flags are not evidence of improvement.

The validator src/engine/contract.js requires exact meaningful headline evidence and
nonblank explanations for non-Clean responses. A missing or unknown kind, invalid
source/shape or absent evidence throws; it is NOT silently converted to Clean. Scores
are clamped/rounded, not used as a classification threshold. The gate checks structure,
not whether a copied phrase justifies Rage/Fear/Envy. That semantic limitation is not
fixed with keyword rules. The Firebase SDK adapter consumes the returned kind without
recategorization and reports actual inferenceSource. No mock fallback was introduced.

The earlier attached Debait_v2_12_Targeted_Review.csv was inspected: 12 Clean
predictions, empty trigger/explanation arrays, scores 5/10/15 and zero human review
verdicts/evidence. Those historical rows are preserved verbatim as A01-A12 with
original IDs/drafts/predictions in separate source_* worksheet columns. They lack
run/policy/model/source provenance and do not supply adjudicated references.

Only user-reported aggregates for the NEW Test A/B are available, not their row-level CSVs,
exact prompts/build versions, trigger evidence, timings or adjudicated references.
Thus no reliable false-positive/false-negative list, confusion matrix, precision,
Fear recall, failure attribution or causal policy effect can be calculated from them.

| Observation | Test A | Test B |
| --- | --- | --- |
| Reported successful headlines | 20 | 40 |
| Flagged | 14 (70%) | 3 (7.5%) |
| Clean | 6 | 37 |
| Category detail supplied | Not supplied | 1 Rage, 0 Fear, 2 Envy |
| Human-adjudicated reference labels | Unavailable | Unavailable |

The reported 19 draft matches in Test A are not verified accuracy. These are different
sets, not a baseline/candidate A/B comparison. Zero Fear in Test B alone does not prove
zero Fear recall because its true supported Fear denominator is unknown.

## Candidate

src/engine/policies/subtle-v5.js adds a concise claim/attribution -> pressure -> neutral
alternative -> exact evidence procedure. It teaches implied betrayal, sarcasm, loaded
blame, vague personalized danger, coercive urgency and implicit status inadequacy.
Contrasts preserve legitimate accountability reporting, flood/health warnings, urgent
but actionable evacuation advice, pay reporting and distress quotations. Curiosity
alone remains outside the supported emotional schema; Clean does not certify truth.
No arbitrary score cutoff, keyword category assignment, extra output fields or
multi-pass/model-as-judge requests are added. Scores describe presentation intensity,
not calibrated confidence; calibration accuracy is still unverified.

The original baseline is selectable via VITE_DEBAIT_CLASSIFICATION_POLICY=baseline-v4.
The experimental branch defaults to subtle-v5. Invalid selectors fail the Vite build.
Both policies share the original rewrite instructions, JSON contract and acceptance
code. A frozen-prompt hash and byte comparison of the Rewrite section enforce this.

Fixed empty-input prompt size: baseline 6,255 characters; candidate 7,585 (+21.3%).
This is character count, not token count or measured billing. With the same batch size
it adds instructions per request but no extra inference calls. No measured latency,
model-consistency or cost benefit is claimed; evaluate the tradeoff before adoption.
Cloud model remains gemini-3.5-flash-lite and installed Firebase SDK 13.3.0. Real run
exports record configured model/SDK/source; exact resolved model remains unknown.

## Baseline, versions and cache

Baseline: quality-classification-evidence-v4; candidate: quality-subtle-framing-v5.
classificationPolicy.js selects the prompt and version together at build time, so page
messages cannot switch them mid-run. The existing worker imports QUALITY_POLICY_VERSION
for its cache and Evaluation Lab metadata. Old v4 cache entries are cleared before
candidate reuse, and v5 entries are incompatible when returning to baseline v4.
Browsing statistics are not reset or rewritten. Explicit old-v4 cache tests verify a
fresh analysis, zero old cache hits, new version and preservation of existing stats.
No semantic rewrite acceptance code below the qualityPolicy re-export was changed.

## Evaluation assets and current result

See dev/evaluation/subtle-framing/README.md for review, build and comparison commands.
The 80-case CSV is a human-review worksheet, not ground truth. Every row is pending and
every human_reference_label is blank. It contains 18 minimal pairs, obvious/subtle
examples, legitimate reporting, quotations, curiosity-only cases and 12 ambiguous
exploratory cases. Two existing curiosity anchors appear in the prompts; the set is
synthetic/enriched, not an independent sample of real news or browsing prevalence.

Evaluation Lab import/export now preserves dataset_id, case_type, pair_id, successful
batch ID/size and round-trip duration. Labels/rationales are not sent to the model.
Existing worker/gate/offscreen/App Check/privacy checks, fresh inference, cancellation,
deduplication and exclusion from normal caches/statistics remain unchanged. No UI
components or live classification schema were changed. Offline compare validates
export provenance, paired references and exact evidence, reports source strata,
failures/coverage/consistency and metrics only when defensible references exist.
A CLI smoke run used explicitly named controlled fixtures outside the repository;
it is not a genuine model evaluation and is not included as benchmark evidence.

| Baseline versus candidate outcome | Current evidence |
| --- | --- |
| Real-model predictions | Not collected |
| Reviewed eligible cases | 0 |
| Recall / flagged precision / false-positive rate / confusion matrix | Cannot establish |
| Genuine request failure rate / latency / token cost | Not measured |
| Structural regression and report arithmetic | Deterministic tests only |
| Improvement demonstrated | No |

Example review sentinels (NOT observed model errors):
- FP risk: N06 evacuation advice, N05 permanent symptoms, Q01 survivor fear quotation.
  Concern/urgency alone should not justify accusing the publisher of manipulation.
- FN risk: R01B sarcastic donor grievance, F05B vague kitchen/family threat, E03B career
  inadequacy. Reviewers must decide whether exact wording establishes the technique.
- Ambiguous A01/A05/A08/A10/A11 may reveal either prompt weakness or over-eager draft
  labeling. Preserve disagreements rather than treating every draft as a missed case.

## Human decision and recommendation

Recommendation: REVISE / HOLD FOR VALIDATION, not adopt or merge yet. The candidate is
implemented for testing; there is no evidence it outperforms baseline. First perform
independent blind annotation, adjudicate supported labels and review the explanations.
Run both policies on the same reviewed cases, same configured model/SDK/privacy setup,
and inspect source-matched results. Repeat/counterbalance within existing quotas.
Assess Fear recall alongside legitimate-reporting false positives, flagged precision,
coverage, evidence quality and input/latency cost. A Fear recall increase bought with
more legitimate-warning false positives is not automatically a success. Obtain more
unseen reviewed cases if denominators are small; no statistical superiority claim is
justified by this synthetic challenge set alone. Explicit approval is required before
promoting any candidate into the working extension.

## Verification

- npm test: 368 passed, zero failed (352 foundation tests + 16 experiment tests).
  Includes frozen prompt hash, unchanged rewrite suffix, policy variants, one SDK
  dispatch, dataset review boundaries, comparison arithmetic, duplicates, provenance,
  source separation, repeat consistency, metadata privacy and explicit v4 cache invalidation.
- Existing core controlled browser regressions passed; UI checks: 100 assertions;
  actual built-layout checks with controlled Chrome APIs: 30 assertions. These are
  not real Gemini classification evaluations.
- Baseline and candidate development builds passed. Compiled-contract checks execute
  the actual built pure module and verify both exact prompt and cache/evaluation version.
- Production, web and demo builds passed; development/production/demo evaluation
  isolation passed, including development -> production without manual cleaning.
- Invalid build selector was deliberately tested and rejected as expected.
- The initial build-inspection helper incorrectly expected a literal initializer;
  production retains a default expression. That test-helper defect was corrected to
  execute the compiled pure policy module; all final policy-build checks pass.
- Offline CLI smoke test passed with explicitly named controlled fixtures outside
  the repository. Their metrics are not presented as real model performance.
- Native extension test attempted: BLOCKED (exit 2), not passed, because managed
  Chromium prohibits loading Debait. Real Firebase/Nano evaluation remains unverified.

No unresolved automated test failures. The blocker to a quality adoption decision is
missing adjudicated reference labels and genuine paired model evaluations, not a
claimed successful benchmark. Use the review/runbook, preserve current security and
Local Only settings, and obtain explicit approval before merging/adopting the candidate.
