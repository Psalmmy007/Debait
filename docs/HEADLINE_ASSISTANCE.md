# Headline assistance contract and UI handoff

Classification keeps its existing four-category request and response unchanged.
`debait/headline-assist` is a separate, user-initiated request:
`{text, task: 'rewrite'|'explain', kind?}`. Rewrite uses the existing scored category.
No human references, page body, URLs or browsing history are sent. The worker derives
Local Only from settings, uses the shared quota gate, deduplicates concurrent requests
and rejects answers crossing a privacy revision. Assistance is not a reading-statistics
or evaluation event and is not written to browsing caches. No mock fallback is allowed.

The Firebase engine uses the same getAi/getDeviceAi, hybrid inference modes, App Check
and SDK inferenceSource checks as classification. Cloud and device schemas are explicit:

- Rewrite: `{honest_rewrite: string}`. Normalization applies existing rewriteDecision;
  rejected/unchanged proposals retain the original and a privacy-safe reason. The
  conservative prefix-only acceptance policy is unchanged. Requesting again does not
  guarantee that a useful safe alternative exists.
- Explain: `{simple_explanation: string, definitions: [{term, meaning}], missing_context: string}`.
  Definitions are general terminology, not facts about the event. Terms must occur in
  the headline. The explanation preserves quoted speech, names/figures, attribution,
  negation, uncertainty and claim relationship words. Unsupported added figures are
  rejected. Missing context must be explicit. If safe simplification cannot be made,
  the model returns the original as simple_explanation and may define its terminology.
  The original remains visible; explanation never replaces the page headline.

These are lexical/structural safeguards, not proof of semantic equivalence or fact
verification. General definitions and model explanations require real-model quality
review. Never infer motives, causal effects or event background from general definitions.
For the central-bank example, define contractionary monetary policy in general terms;
do not assert a particular purpose, interest-rate move or economic outcome absent
from the headline. The clarification “Headline wording only; not a fact-check” remains.

Functional controls use existing card classes, with no CSS redesign. A viewport
scroll limit keeps variable-length explanations and the Close action accessible:
- `data-act="request-rewrite"`: Request neutral wording (non-Clean headlines).
- `data-act="debait"`: Apply rewrite (only a final accepted alternative).
- `data-act="restore"`: Show original (only a currently rewritten headline).
- `data-act="explain"`: Explain Simply (all scored categories).
- `[data-assistance-status]`: pending, errors/cooldown or rejection reason for the user.
- `[data-explanation]`: simple wording, separately labeled general definitions, missing
  context, source and not-a-fact-check clarification. Text is rendered with textContent.

Page action first analyzes eligible discovered headlines, then applies accepted
alternatives. It does not force fresh AI rewording for every rejected headline. The
popup receives the completed action summary instead of immediately closing. Automatic
rewriting stays off by default, runs only on enabled sites, applies accepted scored
alternatives, processes already-scored headlines when enabled, and skips manually
restored records until an explicit new manual action or the site changes the headline.
DOM changes must preserve existing link elements/attributes and restore original text.

A headline changed by the site invalidates its record, pending assistance and original
text restoration. A Local Only change invalidates content-side proposals, cancels queued
application of stale results and causes fresh analysis under the new setting.

Tests with controlled responses establish wiring, guards and reversible behavior,
not successful live Gemini/Nano inference or semantic accuracy. Manual Chrome checks:
reload the extension, refresh a public test page, compare Analyze versus Apply states,
test explicit/automatic/restore and dynamic headlines, request Explain Simply on Clean
technical text, then repeat under Local Only and a quota cooldown. No live evaluation
or production Firebase change is part of this implementation.

## Developer verification

Run `npm test`. For actual DOM/button/Auto-Debait checks in an environment with
Playwright and Chromium installed, run `node scripts/check-core-experience.cjs`.
Set `CHROMIUM_EXECUTABLE_PATH` if needed. The script starts a temporary local Vite
server and supplies explicit CONTROLLED response fixtures; it makes no real Gemini
requests. It tests the actual popup response, content listener, cards, restore,
Explain Simply, cooldown state, opt-in behavior, dynamic recycled text, markup
identity and Local Only invalidation. These are wiring tests, not model evaluation.

The native extension/App Check/cloud/Nano runtime still requires manual Chrome
verification. After rebuilding/reloading, refresh the test page to replace stale
content scripts. Start with a public synthetic page containing one allowed-prefix
headline, one unsafe quoted/factual headline and the central-bank Clean example.
Analysis can succeed while no safe rewrite exists. A manual request may hit the
same shared cooldown as analysis; wait until the displayed time and retry explicitly.
No article body or quoted block should be replaced; accepted prefix removal retains
original link elements and URL attributes. Restoring a headline opts that record out
of subsequent automatic reapplication until explicit manual action or new site text.

UI integration details: `getPage()` adds `pending`, `rewritable`, `busy`, `notice`
and `automatic` alongside existing counts. The settings view defaults these fields
for compatibility. `debait/togglePage` now holds its response channel open and returns
`{ok, rewrote, restored, note}` after the action. The popup keeps the summary visible.
These are functional contracts to preserve when integrating the teammate's styling.
No CSS files, classification prompts, live category schema, Firebase credentials,
Weekly Mind Facts logic, or evaluation-runner data formats are changed.
