# Release-candidate integration report

Date: 23 November 2026 (Africa/Lagos). Status: **PARTIAL — not approved for public release**.

## Foundation and integration plan

- New branch: `release/hackathon-final-integration`.
- Base: `integration/chisom-features` at `2cdb82697a2fb3eb18b63a69c2e002313464f546`.
- Partner validation: `test/gemini-nano-validation` at `7cb7f14901faf2f926d150dda7398b4dddd2cab7`; routing/cancellation work in `a139efc5ce056f5d72ecdba3533cc666a0ddde08`.
- Other inspected heads: `feature/ui-scaffold` `8e9fb8eba6dac29f652d37f6e354d92c84ddd6c1`; `main` `17694e34cdbddca4b15a4027edaf4afe1c0e31df`.
- No pre-existing release branch was present. No development branch was changed, reset or merged.
- Comparing the two foundations showed 136 differing files, including removal of authentication/quality tests and safer engine modules on the partner branch. Strategy: adapt the partner's timing/cancellation ideas into existing modules, not a wholesale merge. No Git merge conflicts were created; overlapping engine/UI changes were reconciled manually in new release-branch edits.

## Integrated and preserved

Chisom's useful contribution is explicit local-first inference with a deadline, signal forwarding into Chrome prompt options, a single local request at a time, and a longer Local Only budget. New `src/engine/hybrid.js` implements bounded operations and a bounded device queue. `inference.js` uses Firebase AI Logic `ONLY_ON_DEVICE` then, if permitted, `ONLY_IN_CLOUD`. `runtime.js` aborts real work on its deadline and exposes cancellation. Worker/offscreen privacy changes cancel work; existing Local Only hard closure of the offscreen context remains.

Local Only scans one headline per batch rather than asking low-end hardware to process eight at once. Orb waiting text explains that local processing can take minutes. No design system was replaced.

Preserved: exact evidence validation, four live categories, classification prompt/policy version, semantic rewrite guards, original restoration, opt-in Auto-Debait, Explain Simply, cache privacy checks, shared quota/cooldown gate, App Check, private development-token storage/setup instructions, safe share cards, orb personalization, repaired real/sample statistics, accessibility, and development Evaluation Lab isolation. The original Firebase web prototype is unchanged. Routing changes do not invalidate existing genuine policy-compatible cache entries; heuristics/mocks remain unusable in ordinary operation.

## Deliberate exclusions

- Secondary project routing, cloud hedging/duplicate-on-slow requests and automatic mock/heuristic fallback.
- Partner classification/rewrite prompt, forced second rewrite and permissive response normalization.
- Partner's availability-derived source labels, old caches/statistics/build configuration and wholesale UI replacement.
- Whole-page summaries: additional article-text collection and inference contract lack the required consent/quality review.
- Voice: controls/gesture hint removed, worker entry points blocked, persisted opt-in cleared, permission page and Live transport excluded from the build. Experimental source files and their source branches remain. Standalone audio tests still test experimental components; release voice is not enabled by their success.

## Security decision and blockers

Original project only; no Firebase Console changes, credentials or App Check weakening. Production cloud still fails closed without a trusted App Check issuer. A browser-extension CustomProvider requires a reviewed server-side issuance/attestation strategy; origin/CORS checking alone is not trustworthy attestation. A registered development token does not prove production readiness.

SDK evidence: Firebase 13.3.0 / @firebase/ai 3.1.0 browser source sends REST App Check headers, but current Live WebSocket construction uses a key query parameter without equivalent token forwarding. Partner voice explicitly chooses a project without AI Logic enforcement and patches WebSocket sends. Neither is imported. No secure authenticated spoken exchange was available to verify; voice is excluded rather than bypassing enforcement.

## Validation ledger

- `npm ci --cache /tmp/debait-release-npm-cache`: passed, 181 packages; no dependency/configuration change. Writable cache is necessary in this environment.
- Base suite: 390 passed, 0 failed. Final suite: **404 passed, 0 failed**.
- New coverage: explicit local/cloud modes; stalled Nano abort and bounded fallback; longer Local Only; local failure/unavailability with no cloud authentication; caller/runtime cancellation; bounded queue including cancellation-ignoring SDK stand-ins; exact source matching; release voice entry-point blocks; privacy cancellation messages.
- Actual installed Firebase browser SDK tested with a controlled LanguageModel stand-in: create/prompt signals forwarded, metadata attributed on-device, stalled prompt aborted, zero network calls. This is not real Nano.
- Core controlled browser suite passed, including rewrites/restoration, unsafe rejection, Explain Simply, Auto-Debait, dynamic content, popup/panel closure and Local Only invalidation.
- UI: **100 assertions passed**, light/dark, 36 controlled screenshots. Built layout: **48 assertions passed**, 0 failed.
- Controlled WebAudio/worklet suite passed with a synthetic microphone; orb resizing, share-card rendering/exclusions, microphone denial and cleanup/privacy abort passed. No genuine voice or Gemini inference is implied.
- Development, production, web and demo builds passed; Evaluation Lab isolation, unchanged permissions/CSP/worklet packaging and release voice/secondary-project exclusion checks passed.
- Native loaded-extension check: **BLOCKED**, managed Chromium extension-install policy, exit 2. Native toolbar/offscreen/hardware tests remain pending.
- During development, routing fixtures initially failed because they still expected SDK-managed `PREFER_ON_DEVICE` and enabled voice. Tests were updated to assert the new explicit paths; experimental voice tests use an injected test-only constant, with separate tests exercising the actual disabled release. A timer fixture was corrected to wait for its mocked authentication stage. The SDK forwarding test initially selected Node's non-Chrome SDK entry; it now loads the actual browser SDK entry. No unresolved automated failure is claimed as passing.

## External dependencies and review

Official Devpost and Chrome/Firebase documentation fetches returned proxy CONNECT 403, including a retried public rules fetch. Current official rules and hardware documentation could not be verified. Source SDK behavior is inspected locally; historical partner hardware requirements are not advertised as newly verified official requirements.

GitHub API/GraphQL requests returned Forbidden; `gh` authentication checks reported unusable API access. The branch can be pushed through the repository Git transport, but PR creation may require an authorized Codespaces/GitHub session. `PR_DESCRIPTION.md` is the prepared review body. Target base: `integration/chisom-features`, to review the selective delta; no merge is authorized.

## Remaining limits

Real release-branch Nano, cloud fallback, network privacy and supported-hardware latency must be retested. The partner's one warm 88-second result is historical evidence, not this build's validation. If Chrome ignores cancellation, its busy local slot stays occupied until completion; further local prompts cannot pile up, but a reload may be needed. Firebase's public model API does not expose the private Chrome session for explicit destruction. Per-tab abandonment and Evaluation Lab cancellation discard results; an already-dispatched request may finish within its bounded deadline rather than immediately stop. Local Only changes cancel all work and close the old offscreen context. Shared project-wide quotas still need server-side infrastructure for production-wide coordination.
