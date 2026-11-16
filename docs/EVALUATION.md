# Developer CSV evaluation

This is a separate tool for testing public or fictional headlines through the real
installed extension. It does not change the live classifier or product UI.

## Open the page

1. Check out `repair/priority2-firebase-auth` and install dependencies with `npm ci`
   if needed. Build with `VITE_DEBAIT_APP_CHECK=debug npm run build:dev` (the existing
   privately registered development App Check setup is still required).
2. Open `chrome://extensions`, reload Debait (or Load unpacked using `dist`), and
   copy its extension ID from the extension card. Do not copy any debug token.
3. Open `chrome-extension://YOUR_EXTENSION_ID/dev/evaluation/index.html` in Chrome.
   This is not the localhost `/?preview` mock UI. The page is excluded from production
   and demo builds; the service also rejects non-development installations/callers.
4. Review the privacy text. Local Only is controlled by Debait's existing settings.
   With it ON, unavailable device inference fails; this tool does not enable cloud,
   download a device model or change your Gemini Nano setup. With it OFF, inference
   may run on-device or in cloud, as reported by the SDK.

## Import the existing 30-headline CSV

Click the file input and choose the UTF-8 comma-separated CSV. Only the headline
column is required. If a column name is not recognized, rename it in a copy of the
file using this layout (a downloadable sample is available on the page):

```csv
headline_id,headline,draft_label,human_reference_label,review_status
U01,You will not believe what happened at the meeting,Curiosity Gap,,disputed
E01,Everyone richer than you knows this — stop being a loser,Envy,Envy,agreed
```

Supported header aliases:

- ID: `headline_id`, `id`, `test_id`, `case_id` (missing IDs are generated).
- Text: `headline`, `text`, `headline_text`, `original_headline`.
- Draft: `draft_label`, `expected_label`, `expected_category`, `draft_category`, `expected`.
- Human: `human_reference_label`, `human_reviewed_label`, `human_label`, `reference_label`, `reviewed_label`.
- Review: `review_status`, `human_review_status`, `reference_status`.

Draft expectations never become human references automatically. Only `agreed`,
`reviewed_agreed` or `adjudicated` review status qualifies a supported human label.
Do not mark disputed labels agreed merely to obtain a percentage. Curiosity Gap
and Uncertain remain reference annotations, not new live model categories.

Quote fields containing commas, quotes or newlines according to CSV rules. Each ID
must be unique; each headline must have 1–320 characters. The file limit is 2 MB /
2,000 rows. Exact duplicate headline text is analyzed once per run; all row IDs
remain in the export. Extra spaces make text distinct; the runner does not silently
alter input wording. Duplicate rows are excluded from the agreement denominator
so they cannot inflate it. Put the reviewed reference on the first occurrence.
Conflicting agreed references for identical text exclude every occurrence.

## Run, cancel and export

Click **Start evaluation**. The page shows imported counts and completed, pending,
failed, cancelled and interrupted rows. Batches contain up to four unique headlines.
Waiting for pacing/cooldowns is normal. Evaluation and browsing share the existing
installation-wide request budget, not a separate allowance. Other users/devices
still share Firebase project quotas; this tool cannot enforce a project-wide limit.

**Cancel evaluation** stops new submissions and discards an answer still pending.
A request already sent may still finish and consume quota. The tool waits for that
request to settle before allowing a new run. **Download results CSV** works during
or after a run, including cancellation/failure. Exports prefix formula-like cells
with an apostrophe so spreadsheet programs do not execute them.

Datasets and answers exist only in page memory, plus transient request processing.
They are not written to extension storage, normal score caches or weekly statistics.
Only existing quota scheduling metadata and existing SDK authentication storage
continue operating normally. An explicitly downloaded CSV is a local file you chose
to save. Closing/reloading the page loses unsaved results; a worker restart marks
remaining work interrupted. Download partial results before refreshing or starting
a new run. There is no persistent resume feature or automatic hidden replay.

Server 429 retries are bounded to two per batch and honor shared cooldown guidance.
Local pacing deferrals are bounded separately using the existing retry helper.
Daily-budget exhaustion, privacy changes, authentication/transport failures or lost
sessions stop further batches. An invalid classification fails its batch; subsequent
batches may continue. Failed batches are not silently split or replaced with Clean.

## What the export means

- Headline ID/text, original draft/human labels and review status are preserved.
- Prediction, exact trigger/explanation arrays, score and source come from normal
  SDK-backed classification and existing validation. Human labels are never sent
  to the classifier. The source comes from SDK inference metadata, not model JSON.
- `status`, safe error fields, `submission_attempts`, `duplicate_of` and
  `evaluation_origin` distinguish failures, scheduling resubmissions, and reused
  answers within a single run. Attempts are message submissions, not proof of API
  requests: pacing can reject a submission before inference.
- Run ID, ISO timestamp (UTC), analysis timestamp, build Git SHA, dirty-build flag,
  policy version, configured cloud model and available SDK version identify the run.
  The configured cloud model is not the identity of an on-device model.
  `resolved_model_version` stays `unknown`: the installed SDK does not document
  that value. Never infer an exact cloud revision or Nano version from an alias.
- Agreement is present only for successful real inference, agreed human references
  in the current four-category schema, and non-duplicate/non-conflicting rows.
  Exclusion reasons are explicit. Errors are not Clean or automatic disagreements.
  The page shows the comparison denominator, excluded rows and failures separately.

A fresh run intentionally makes new inference requests without reading or writing
the browsing score cache. Do not mistake repeated runs for free cached analysis.
The current model may return different answers across runs. Agreement on a small,
partly disputed dataset is not verified real-world accuracy. Review classification
and rewrite quality separately. Keep held-out cases apart from prompt examples;
score cloud and device outputs separately when comparing models.

## Verification

`npm test` includes controlled service, CSV, agreement, privacy, quota and runner
regressions. These inject responses and are not real Gemini model evaluation.

After each build, run `node scripts/check-evaluation-build.js development`,
`production` or `demo` as appropriate. The check verifies that the page and sample
only ship in development. Also run `npm run build:web` for the unchanged prototype.
Real Firebase/App Check/Gemini and device performance require an installed-browser
run with your authorized development setup. No credentials belong in test fixtures,
CSV files, Vite variables, exported results or this documentation.

The implementation environment's headless Chromium did not load the unpacked
extension during the attempted installed-extension smoke check. Controlled browser
checks verified the built interface with supplied responses; they did not verify
real Chrome sender metadata, App Check, or Gemini. Those remain manual checks using
the installed extension and the steps above. No live-model results are bundled.
