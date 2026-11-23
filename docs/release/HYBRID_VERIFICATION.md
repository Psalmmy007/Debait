# Hybrid AI verification

Status: **PARTIAL**. Implementation and controlled tests pass; this release has not produced a newly verified hardware/Gemini response here.

## Actual architecture

Content script → MV3 worker (privacy/cache/statistics/shared local quota gate) → offscreen engine → Firebase AI Logic browser SDK → Chrome Gemini Nano or authenticated Gemini cloud.

- Available Nano is attempted with `InferenceMode.ONLY_ON_DEVICE`, without calling cloud `getAi` or exchanging App Check credentials.
- Hybrid local budget: 10 seconds. A slow/failed Nano is cancelled; at most one `ONLY_IN_CLOUD` request then runs with the original project's App Check authentication. Slow Nano is skipped for 10 minutes for hybrid requests. No simultaneous cloud hedges, project races or heuristic substitute.
- Local Only local-attempt budget: 150 seconds including local queue waiting, with a 240-second overall runtime deadline. No cloud route is reachable. Device absence/download needs and timeout produce errors, never a fabricated Clean result. Content scanning sends one local headline per batch.
- Cloud budget: 25 seconds including authentication; hybrid runtime deadline: 45 seconds. Budgets are explicit constants in `src/engine/hybrid.js`, not claimed model performance guarantees. Availability probes are bounded separately.
- One active local operation, at most four queued. Signals reach SDK request options AND `onDeviceParams.createOptions` / `promptOptions`. The Firebase browser adapter forwards the latter to Chrome; relying on request options alone was insufficient.
- A timed-out/cancelled local operation keeps its slot until the underlying promise settles. If an implementation ignores abort, new local prompts cannot accumulate behind it. There is no access to private SDK sessions or unsupported cancellation hook. Multiple tabs may exhaust a local attempt budget while waiting; use one test tab on slow hardware.
- Runtime deadlines abort signals; Local Only changes request cancellation and preserve the existing hard closure of the offscreen context. Late responses are discarded by signal/worker privacy revision checks. Already transmitted data cannot be recalled.

## Source attribution and quality

Accept only SDK `inferenceSource: on_device` for a device route and `in_cloud` for cloud. Missing, unknown or route-mismatched metadata is an error. Generated JSON cannot choose its source. Availability and cached results do not verify a fresh AI session. Status explicitly describes the last successful inference, not a promise of an active engine.

Existing schemas, exact headline evidence validation, Clean invariance and semantic rewrite acceptance remain unchanged. Invalid local model output is rejected rather than given a fabricated successful classification. Parsing/quality failure after a response does not trigger an additional forced rewrite or cloud request. Existing cache safeguards reject cloud results under Local Only and mock results in normal builds.

## Evidence matrix

| Test | Controlled result | Real release-build evidence |
|---|---|---|
| A: available local model | Device-only response accepted; no cloud authentication; installed browser SDK adapter tested | PENDING on eligible Chrome hardware |
| B: unavailable/failed/slow local | Exactly one permitted cloud request; slow prompt aborted; slow-device cooldown | PENDING genuine authenticated fallback |
| C: Local Only failures | No cloud invocation/authentication; source mismatch rejected; worker privacy tests pass | PENDING native network capture |
| D: abandoned/cancelled work | Active/queued signals, runtime cancellation, bounded queue and late-result rejection pass | PENDING native resource/CPU observation; tab/evaluation cancellation can wait for the bounded dispatched operation |
| E: source labels | Metadata/route checks; availability/cache never imply fresh success | PENDING source evidence from actual responses |
| F: headline integrity | Existing quotation, names, numbers, negation, attribution, causal/severity/permanence and no-count rejection tests pass | Human classification/rewrite review still needed |
| G: extension UI | Controlled core/browser/UI/layout suites pass | Native extension loading blocked in this environment |
| H: voice | Disabled in release; experimental tests remain separate | Not a release feature; no successful authenticated conversation claimed |

## Partner's historical hardware evidence

[Immutable report at 7cb7f14](https://github.com/Psalmmy007/Debait/blob/7cb7f14901faf2f926d150dda7398b4dddd2cab7/docs/validation/gemini-nano-validation.md).

The report documents Chrome 150 on a Windows 11 / AMD A8-7410 / 16 GB RAM laptop. On 21 November 2026, one warm Local Only classification of “City council approves a new transport budget.” completed Clean, score 0, with an on-device label after about 88 seconds. The engine network was not captured in that run. Earlier timed stand-in tests and raw Prompt API runs must not be conflated with that result.

This is valuable partner-reported evidence of the earlier branch, not broad reliability, accuracy or network-privacy proof for this release. Its prompt/normalization differs from this branch. The stricter current prompt could be slower and reject more outputs.

## Retest protocol

Use an eligible physical desktop Chrome computer with model availability `available` in the extension's offscreen context. A page's availability alone is insufficient. Check current [Chrome requirements](https://developer.chrome.com/docs/ai/get-started) and [Firebase hybrid documentation](https://firebase.google.com/docs/ai-logic/hybrid-on-device-inference) yourself; current pages were blocked here. The partner reports 16 GB RAM/four-core CPU or eligible GPU and about 22 GB free disk; these are historical reported requirements, not newly verified documentation. A 4 GB laptop is not a valid Nano proof environment.

Use the synthetic test page from the judge guide. Clear/rephrase test headlines between runs to avoid cache confusion. Record build SHA, Chrome/OS/hardware, availability, mode, elapsed time, result source, redacted request outcome and failure counts. Capture fresh Local Only success, unavailable/slow-device cloud fallback, Local Only timeout with no cloud headline requests, cancellation/resource cleanup and cache privacy. Never share request headers, token query strings or private page content. Inspect actual Firebase request outcomes and source metadata; a UI label alone is not full evidence.
