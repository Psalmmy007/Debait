# Debait Engine Architecture

Debait runs its AI engine inside an MV3 offscreen document (`src/offscreen/index.html`) so both
Chrome's on-device Prompt API (Gemini Nano) and the Firebase AI Logic SDK work reliably across tabs.

```text
content script (src/content/main.js)
  └─► service worker (src/background/sw.js: mode-isolated cache + daily stats)
        └─► offscreen page (src/offscreen/offscreen.js)
              └─► engine (src/engine/index.js → firebaseEngine.js)
```

## Hybrid inference routing (`src/engine/firebaseEngine.js`)

Debait uses Firebase AI Logic (`getGenerativeModel`) with explicit `InferenceMode.ONLY_ON_DEVICE`
and `InferenceMode.ONLY_IN_CLOUD` selection (plus pre-warmed `LanguageModel` session cloning for
fast on-device headline scoring) so it has deterministic control over budgets, queueing, and cancellation:

1. **Online Hybrid (`localOnly: false`, online):**
   - Uses Gemini Nano when already downloaded (`available`), not marked slow, and free (`deviceQueue === 0`), with a `10 s` hybrid budget.
   - Otherwise sends a single authenticated request (no speculative duplicate hedging by default) to the primary App Check-enforced Firebase project (`FIREBASE_PROJECTS[0]`, `CLOUD_MODEL = 'gemini-3.5-flash-lite'`) with an `8 s` per-request timeout.
   - If the cloud call stalls or fails on a flaky network, it automatically fails over to Gemini Nano when available.
2. **Local only (`localOnly: true`):**
   - Never dispatches cloud requests; toggling `Local only` ON immediately aborts any in-flight cloud calls (`MSG.CANCEL_CLOUD`).
   - Cache lookups strictly reject prior `source === 'cloud'` entries (`isCacheEntryValid(entry, true)`).
   - Scores viewport headlines 1×1 with a `150 s` per-headline budget.
3. **Offline (`navigator.onLine === false`):**
   - Skips cloud completely and queues 1×1 for Gemini Nano when available.
   - When Nano is unavailable offline, returns an honest `OFFLINE_UNAVAILABLE` status instead of faking AI results with heuristic guesses.
4. **Reconnect auto-upgrade:**
   - Listening for `online` clears transient network lockouts and re-queues pending/failed headlines once.

## Source provenance & rewrite safety (`src/engine/contract.js`)

- `verifyInferenceSource()` strictly requires `inferenceSource === 'on_device'` for on-device routes and `inferenceSource === 'in_cloud'` for cloud routes (never relabeling unknown metadata as `'cloud'`).
- `normalizeResult()` enforces `BAIT_THRESHOLD = 60`, exact trigger presence in the original text, and `validateRewriteIntegrity()` (rejecting invented numbers, unsupported authority/backstory terms like `"study"` or `"years of saving"`, negation flips, or bloated rewrites). Unsafe rewrites are replaced with `"No verified neutral rewrite available"` (`rewrite_safe: false`) rather than mutating the headline.

## App Check & Firebase setup

- Primary project (`Team` / `debait-d6d5d`) keeps **App Check enforced**.
- `ALLOW_BACKUP_FALLBACK` defaults to `false` so traffic is never silently routed to an unenforced monitoring-only project.
- Because MV3 extensions cannot load remote reCAPTCHA scripts, supervised developer/judge installs register the per-install debug token shown in the Debait popup under **Firebase Console → App Check → Apps → Manage debug tokens**. Never commit or screenshot debug tokens.
- Unprovisioned cloud calls surface an explicit App Check setup status rather than faking AI.

## Testing

```bash
npm test
npm run build
```
