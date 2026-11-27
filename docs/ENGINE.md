# Debait engine

The extension uses Firebase AI Logic through `src/engine/firebaseEngine.js`. Normal
operation never falls back to simulated classifications. Explicit mock builds are
for UI demonstrations only. The original Vite web analyzer in `src/main.js` and
`src/firebase.js` remains separate and unchanged.

For authentication setup, production release blockers and secure browser test
steps, follow [FIREBASE_AUTH.md](FIREBASE_AUTH.md). Do not enable debug App Check in
a production build. Firebase AI Logic enforcement stays enabled.

## Execution and result contract

Content script → service worker (privacy, cache, statistics) → offscreen document → engine.
Actual Nano support in the offscreen context must be verified on compatible Chrome/hardware.

- `scoreHeadlines(texts, { localOnly, debugToken })` returns one validated result per headline.
- `getStatus({ localOnly })` separates device availability from the last verified inference source.
- `initDeviceModel()` requests device setup. The popup performs downloads from a direct user click.

Each result has `kind`, integer `score`, `triggers` (exact words and explanations),
`honest_rewrite`, and `source` (`on-device`, `cloud`, or explicitly selected `mock`).
Missing or malformed responses are errors, never manufactured Clean classifications.
Source comes from the SDK response metadata. A rewrite is not a fact-check.

Local Only selects `InferenceMode.ONLY_ON_DEVICE`; if Nano is unavailable, it fails.
Release inference explicitly tries `ONLY_ON_DEVICE` when Nano is available, with a 10-second hybrid budget, then uses at most one `ONLY_IN_CLOUD` request when permitted. App Check is checked only for the cloud route. Local Only gets a 150-second local-attempt budget and a 240-second outer runtime deadline; it never exchanges cloud credentials. Abort signals reach Chrome create/prompt options and a bounded local queue prevents request accumulation. See [release hybrid verification](release/HYBRID_VERIFICATION.md) for evidence and limitations.

## Priority 1 failure and privacy checks

Run `npm test` for automated engine, background-message/cache, and voice-lifecycle tests.
These use controlled Firebase/Chrome substitutes, not paid requests or a downloaded Nano model.

Normal extension builds use Firebase. An intentionally simulated extension build requires BOTH:

```bash
VITE_DEBAIT_ENGINE=mock npm run build:demo
```

Its results and engine status say `Mock engine`. `npm run demo` with `?preview` remains an
explicit mock UI preview. Never use either as evidence of real Gemini execution. Build again
with `npm run build` before real inference testing. Local Only overrides extension demo mode:
it requires genuine on-device results, and fails if Nano is unavailable.

Local Only blocks new cloud voice calls, switches voice off, and closes the offscreen document
to terminate live audio and pending cloud connection attempts. The document is recreated for
later on-device scoring. Cloud and legacy mock cache entries cannot satisfy Local Only requests;
headlines must be scored on-device or return an error. Results finishing across a privacy-setting
change are discarded. Previously displayed results are not a new inference request.

Manual release check on supported Chrome/hardware, with a registered development App Check token:

1. Confirm real cloud scoring works with Local Only off. Disconnect networking or reject a request:
   headlines must remain unclassified, the orb must explain the error, and the popup must show
   Not ready rather than Mock engine. Confirm a successful retry recovers.
2. Start a real voice call, then enable Local Only. Verify the offscreen context disappears, the
   microphone indicator clears, and the WebSocket closes in browser/network inspection. Repeat
   while connecting and while the microphone permission tab is open; granting permission afterward
   must not start a cloud call. No new cloud audio/page-report traffic should follow shutdown.
3. Populate a cloud cache entry, enable Local Only and revisit the headline. With Nano available,
   verify an on-device result; without Nano, verify an error, never the old cloud result.
4. Confirm genuine Nano execution on compatible hardware and inspect traffic during Local Only.

Automated tests prove policy decisions and requested resource cleanup, not physical microphone
release, browser WebSocket teardown, or actual SDK network behavior. Already transmitted data
cannot be recalled. A timeout does not itself cancel the underlying Firebase request; late results
are ignored, and enabling Local Only destroys its offscreen execution context.

## Ephemeral Live token backend (review-only, voice gated)

`functions/index.js` and `functions/mintHandler.js` implement an App-Check-enforced Cloud Function
(`mintLiveVoiceToken`) that mints single-use `v1beta` ephemeral Gemini Live tokens using
`GEMINI_API_KEY` from Firebase Secret Manager, with an atomic Firestore transactional rate limiter
(`_rateLimits`, 5/min per caller, 30/min global cap) and Cloud Run/GFE/GCLB proxy-hop caller
identity (`TRUSTED_PROXY_HOPS`). `firestore.rules` explicitly denies client access to
`/_rateLimits/{doc}` (verify live project rules before any rules deployment). Live voice stays
disabled in the extension release build (`ENABLE_LIVE_VOICE = false`, `VOICE_ENABLED = false`).
