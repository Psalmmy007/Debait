# PR #4 review corrections

Branch: `release/hackathon-final-integration`. Starting commit: `095167ecc40bba9e9635b2610211f87be12298c0`. No merge authorized or performed.

## Reproduction and corrections

1. **Scoped evaluation cancellation.** Before the correction, a controlled evaluation invoked cloud fallback after Cancel was acknowledged. Each evaluation batch now has a unique temporary request ID and a run AbortController. The worker checks cancellation during initialization/token/settings preparation and never serializes the signal. An ID-only cancellation message is acknowledged by the offscreen request registry after revoking that request's signal. Normal browsing and other IDs are unaffected; global cancellation remains reserved for privacy changes. Cancel-before-start tombstones reject reordered starts and duplicate IDs. Records contain only IDs/controllers, expire after five minutes once inactive, are bounded to 256, and fail closed rather than evicting an unexpired cancellation.

Cancellation acknowledgment is bounded to three seconds. Missing/failed acknowledgment or missing cancellation transport is an honest error, not successful cancellation. The development runner displays stopping/confirmed/unconfirmed states and remains busy until confirmation settles. No already-transmitted data can be recalled; an SDK that ignores abort may still finish already-dispatched work. An acknowledged cancellation prevents new inference/fallback for that request. Cancelled jobs no longer erase an unrelated last-successful source status.

2. **Queue waiting versus processing.** Before the correction, two serialized valid prompts each taking 80 ms with a 120 ms budget produced one success and one timeout. The local queue now grants an execution lease before the active timer starts. Local Only queue wait is bounded to 90 seconds, active processing to 150 seconds, and the existing 240-second overall runtime deadline still applies. Hybrid queue wait is bounded to 10 seconds, followed by its separate 10-second active local attempt; the overall 45-second deadline remains. No more than four requests wait. A cancelled/timed-out physical SDK operation retains its lease until it actually settles; queued cancellation removes only its waiter. A full/expired queue reports device busy rather than falsely declaring hardware slow.

3. **Actual orb wiring.** The setting was sent to a helper that ignored it. It now reaches the orb's rendering method. The full content-script browser regression holds a Local Only score request, reads the real orb DOM, checks the minutes warning, then releases the request. Standalone component assertions alone did not catch this defect.

4. **Release-faithful tests.** Background fixtures now default to the actual voice-disabled release. Experimental voice is enabled explicitly only in tests of that experimental architecture. Existing safety tests remain; the actual offscreen entry and built release independently reject voice startup. No styling redesign or voice reactivation.

## Validation

- Dependency installation passed with a writable npm cache. Baseline: 404 tests passed, 0 failed.
- Final suite: **423 passed, 0 failed**. New coverage includes local-phase/queue/gate/initialization/authentication cancellation, independent browsing completion, serialized message boundaries, actual worker and offscreen routing, reordered/duplicate IDs, bounded records, privacy, malformed-ID diagnostic safety and unconfirmed cancellation.
- Core browser suite passed, including the full Local Only waiting-message regression. UI: 100 assertions passed. Layout: 48 assertions passed. Controlled worklet/audio/privacy/orb/share checks passed.
- Development, production, web and demo builds passed. Release voice exclusion, Evaluation Lab isolation, worklet packaging, unchanged permissions and CSP checks passed.
- One new queue test initially used an incorrect fixture callback signature; corrected the fixture and reran it. No existing test was deleted or weakened. No unresolved automated failure.
- All AI/audio tests are controlled fixtures or synthetic microphone tests, not genuine Nano/cloud/voice evidence. Native extension loading remains blocked by managed Chromium policy; no real microphone/Firebase success claimed.

## Preserved security and remaining blockers

Firebase App Check/authentication/configuration, classification prompt/policy version, result normalization, semantic rewrite rules, quota implementation, real/sample statistics, original web prototype and production voice-disabled setting are unchanged. Normal inference has no mock fallback or secondary-project workaround. Cancel messages have no headlines, tokens or provider payloads. Evaluation remains development-only and does not write browsing caches/statistics.

Production cloud access still requires a reviewed trusted App Check issuer. A development debug token is not production readiness. Real Chrome tests must verify genuine local/cloud source metadata, slow-device fallback, Local Only network privacy, request-specific cancellation and long-running MV3/offscreen resource behavior. Already-dispatched cloud quota may still be charged; ignored physical SDK abort can keep a local slot occupied until settlement. Page/tab abandonment outside Evaluation Lab remains bounded rather than universally immediate cancellation. These limits are not hidden by passing tests.

## Chrome retest

1. Pull this branch. Run `npm ci`, then `VITE_DEBAIT_APP_CHECK=debug npm run build:dev`; use only the owner's privately registered installation token.
2. Reload the unpacked `dist` extension and refresh test tabs. Production builds still reject debug authentication.
3. Enable Local Only on eligible hardware, insert fresh synthetic headlines, and check the orb's Local Only/minutes message. Two tabs should serialize Nano work without consuming the second prompt's active budget while it waits. The overall deadline can still limit a very long queue.
4. In development Evaluation Lab, start a fresh cloud-permitted run and Cancel while Nano is pending. Wait for confirmed cancellation. Verify no new cloud headline request starts for that ID afterwards. A request already sent before cancellation cannot be recalled.
5. Repeat while initialization, queue wait or authentication is pending; keep a separate browsing analysis active and confirm it still completes. Test Local Only with cancellation: no cloud headline inference or forbidden cloud cached result.
6. If cancellation cannot be confirmed, treat the run as unverified, discard its results and reload the extension before retrying if unresponsive. Never share authentication headers or token-bearing request URLs as evidence.
7. Confirm voice controls remain absent; smoke-test rewrite/apply/restore, Explain Simply and real/sample statistics. Production authentication and real-device evidence remain release gates.

## Exact changed files

- `dev/evaluation/session.js`
- `docs/release/HYBRID_VERIFICATION.md`
- `docs/release/INTEGRATION_REPORT.md`
- `docs/release/PR_DESCRIPTION.md`
- `docs/release/REVIEW_FIXES.md`
- `scripts/check-core-experience.cjs`
- `src/background/evaluation.js`
- `src/background/inferenceTransport.js`
- `src/background/sw.js`
- `src/content/main.js`
- `src/engine/hybrid.js`
- `src/engine/inference.js`
- `src/engine/runtime.js`
- `src/offscreen/inferenceRequests.js`
- `src/offscreen/offscreen.js`
- `tests/background.test.js`
- `tests/evaluation-runner.test.js`
- `tests/evaluation-service.test.js`
- `tests/hybrid-release.test.js`
- `tests/offscreen-context.test.js`
- `tests/scoped-inference.test.js`
