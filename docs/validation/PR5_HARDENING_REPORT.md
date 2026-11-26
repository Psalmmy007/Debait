# Debait PR #5 Hardening Report (`review/pr5-final-hardening`)

**Date:** 26 November 2026  
**Branch:** `review/pr5-final-hardening` (branched from `polish/hackathon-ready` at `bf4066c`)  
**Latest Build Stamp (`dist/build.json`):** `{"id":"mwxgicfu","built":"2026-11-26T11:16:04.513Z"}`  
**Automated Verification:** `npm test` (14/14 passed, 6.87 s), `npm run build` (`vite v6.4.6`, 57 modules, 5.76 s, 0 warnings/errors), `console.(warn|error)` scan across `src/` and `public/` (0 hits).  
**Secrets Check:** No Firebase App Check debug tokens, Gemini API keys, authorization headers, or private credentials are committed or logged.

---

## 1. Audit Findings Resolved (P0 – P5)

| ID | Finding | Status | Implementation Summary |
|---|---|---|---|
| **P0-1** | Local Only cache isolation not enforced at retrieval | **Fixed** | `CACHE_VERSION = 5`; `isCacheEntryValid(entry, localOnly)` in `src/engine/contract.js` is enforced in both `src/background/sw.js` (`scoreTexts`) and `src/content/main.js` (`localCache`). Prior `cloud` entries are strictly rejected whenever `localOnly` is `true`; `mock` entries are never cached. |
| **P0-2** | Backup-project contradiction & unprotected auth bypass | **Fixed** | Set `ALLOW_BACKUP_FALLBACK = false` in `src/engine/firebaseConfig.js`. Added `isProjectAllowed(i)` and enforced it across `projectOrder()`, `preferredProject()`, `setPreferredProject()` (sanitizes stale `engineMemory.prefer = 1` back to `0`), `getFirebaseApp()`, `getAi()` (throws `PROJECT_NOT_ALLOWED`), `fixUnchangedRewrites()`, `scoreWithNano()`, `summarize()`, and `liveProjectOrder()` / `picked` in `src/offscreen/call.js`. Primary App Check-enforced `Team` (`debait-d6d5d`) is the sole permitted project. |
| **P0-2b** | Live Voice release gate & ephemeral token backend | **Fixed** | Added App-Check-enforced Cloud Function v2 `mintLiveVoiceToken` (`functions/index.js`, `enforceAppCheck: true`, `defineSecret('GEMINI_API_KEY')`, single-use `uses: 1`, `LIVE_VOICE = 'Leda'`) and wired `src/offscreen/call.js` to mint tokens via `httpsCallable` and open `BidiGenerateContentConstrained`. Added release gate `ENABLE_LIVE_VOICE = false` (`src/engine/firebaseConfig.js`) enforced in `call.js`, `sw.js`, `main.js`, and `settings.js`, displaying the honest status `"Voice requires ephemeral token backend under App Check"` so judges never hit an undeployed function error. |
| **P0-3** | Automatic mock/heuristic fallback masquerading as AI | **Fixed** | Removed silent `mockEngine` fallbacks from `src/engine/index.js` (`scoreHeadlines` & `summarize`): offline-without-Nano and cloud failures throw explicit `OFFLINE_UNAVAILABLE` / `AI_UNAVAILABLE` errors. Preview-only `mock` is labeled `"Heuristic estimate — not AI"` with sharing/auto-debaiting/caching/stats disabled. |
| **P0-4** | Rewrites could invent unsupported facts | **Fixed** | Strictly fact-preserving prompt examples + deterministic `validateRewriteIntegrity(original, rewrite)` in `src/engine/contract.js` across every rewrite pass including `fixUnchangedRewrites()`. Unsafe rewrites surface `"No verified neutral rewrite available"` (`rewrite_safe: false`) and never overwrite DOM. `"Wording check, not a fact-check"` shown in `src/content/ui/card.js`. |
| **P1-5** | Summarizer auto-upload without consent & private page exposure | **Fixed** | Explicit **Summarize this page** opt-in button in `src/content/ui/settings.js`. `isSensitivePage()` / `PRIVATE_HOST_RE` in `src/content/sites/index.js` blocks webmail, banking, code hosts/IDEs, cloud consoles, workspaces, AI chats, localhost dev tools (without `[data-debait-headline]`), and login/password pages. |
| **P1-6** | Unknown `inferenceSource` metadata silently treated as `'cloud'` | **Fixed** | `verifyInferenceSource(rawSource, expectedMode)` normalizes valid SDK casing (`on_device`/`in_cloud`), derives provenance when omitted on explicit `ONLY_ON_DEVICE`/`ONLY_IN_CLOUD` routes, and throws `SOURCE_MISMATCH` on cross-route contradictions or unrecognized values. |
| **P1-7** | Speculative hedging & duplicate cloud dispatches | **Fixed** | `ENABLE_HEDGING = false` by default; single authenticated request on `debait-d6d5d`; `withCloudTimeout` (`18 s` budget) rejects immediately when `cancelActiveCloudRequests()` aborts on `LOCAL_ONLY_SWITCH`. |
| **P1-9** | Broad host permissions without sensitive-site exclusions & Trusted Types / CSP safety | **Fixed** | Retained `http://*/*` + `https://*/*` in `manifest.config.js` so judges and users can test Debait on any news outlet or search engine worldwide, paired with valid MV3 `exclude_matches` blocking webmail (Gmail, Outlook/Office 365, Yahoo Mail, Proton, Fastmail, iCloud Mail), banking/financial portals (Chase, Bank of America, Wells Fargo, Citi, Capital One, PayPal, Stripe, Wise, Venmo, Cash App, Robinhood, Coinbase, Fidelity, Schwab, Vanguard, Barclays, HSBC), cloud IDEs/code hosts/consoles/localhost dev tools (GitHub, GitHub Codespaces, GitLab, Bitbucket, Replit, VS Code Web, CodeSandbox, StackBlitz, Firebase/GCP/AWS/Azure consoles, `*.localhost`, localhost dev paths), and private workspaces/AI chats (Docs/Drive/Sheets/Slides/Calendar/Meet, Notion, Slack, Discord, Figma, Linear, Atlassian, Gemini/ChatGPT/Claude/Copilot/DeepSeek). Mirrored in `PRIVATE_HOST_RE`, `isSensitivePage()`, `main.js` localhost opt-in guard, and `sw.js` `injectOpenTabs()`. `html.js` uses `trustedTypes.createPolicy('debait', ...)` → `defaultPolicy` fallback + Shadow DOM `CSSStyleSheet` without weakening any CSP. |
| **P2-11** | Chimes, AudioWorklet, mute, WebGL & Google Search tag orientation | **Verified** | Offline bundled chimes, `Float32Array` AudioWorklet ring buffer, optimistic mute, WebGL `restoreContext` guard, and Google Search `.yuRUbf` + `hasVerticalFlip()` upright tag fix intact. |
| **P3** | Local Only in-flight cancellation & OFF recovery | **Fixed** | `withCloudTimeout()` immediately rejects on `cancelActiveCloudRequests()` (`LOCAL_ONLY_SWITCH`); `sw.js` tracks `modeEpoch` and re-checks `localOnly` after `toEngine()` for scoring, summaries, and `debait/record-hits` so late cloud responses never cache or mutate stats; `main.js` tracks `modeGen` across `scoreBatch`, retries, `summarizePage`, and `applyResult` (`isResultAllowedInMode`), and recovers pending/deprioritized headlines cleanly when toggled OFF. |

---

## 2. Automated vs. Live Chrome Verification Outputs

### Automated Verification (Executed on `review/pr5-final-hardening`)

```text
npm test (node --test tests/*.test.js)
✔ P0-1: Local Only cache isolation rejects cloud and mock entries (5.7823ms)
✔ P0-2: Release disables unprotected backup project across scoring, summaries, and voice while keeping LIVE_VOICE (9.6354ms)
✔ P0-3: No silent mock fallback in production engine and mock is labeled non-AI (5.313ms)
✔ P0-4: Rewrite integrity gate rejects invented facts, numbers, and polarity flips across balanced fixtures (12.0026ms)
✔ P1-5: Summarizer enforces sparse check, refusal filter, explicit opt-in, and sensitive host protection (4.4301ms)
✔ P1-6: Source provenance normalizes casing/omission and rejects cross-route mismatches (1.8815ms)
✔ P1-7: Hedging disabled by default and cloud cancellation helper exists (0.9594ms)
✔ P1-9: Broad news/web support preserved while excluding webmail, banking, code hosts, workspaces, and localhost dev tools + Trusted Types/CSP safe (11.3015ms)
✔ Nano compact expansion integrates cleanly with strict rewrite-safety normalization (1.6665ms)
✔ P2-11: AudioWorklet ring buffer, optimistic mute, and WebGL restoreContext guard remain intact (6.2628ms)
✔ Network, Call, and Local resilience regressions (112.7158ms)
✔ Ephemeral Live voice token endpoint enforces App Check and maps errors accurately (6.6362ms)
✔ Voice Release Gate: LIVE_VOICE and Cloud Function stay intact while release trigger is honestly gated (9.1087ms)
✔ P3: Local Only in-flight cancellation aborts active cloud work, blocks late cloud renders/cache/stats, and recovers cleanly when toggled OFF (5.6707ms)
ℹ tests 14 | pass 14 | fail 0 | duration_ms 6867.1737

npm run build (npm run fonts && vite build)
✓ 57 modules transformed.
dist/manifest.json                4.25 kB │ gzip:  1.17 kB
dist/assets/sw.js-BI7CjTAB.js    11.78 kB │ gzip:  4.15 kB
dist/assets/main.js-Dbsf0JmU.js  81.22 kB │ gzip: 27.15 kB
dist/assets/offscreen-CyEqOonN.js 146.40 kB │ gzip: 34.31 kB
✓ built in 5.76s (0 warnings, 0 errors)
dist/build.json: {"id":"mwxgicfu","built":"2026-11-26T11:16:04.513Z"}
```

### Live Chrome Hardware Verification Status

Chrome DevTools MCP remote debugging was unavailable (`list_pages` timed out waiting for browser connection) during Run 2, so **live physical Chrome 4-state execution on this commit could not be performed and is honestly marked `UNVERIFIED` below**.

---

## 3. Four-State Hybrid Verification Matrix

| State | Expected Behavior | Automated Code/Unit Check | Live Chrome Hardware Run (Build `mwxgicfu`) |
|---|---|---|---|
| **1. Online Hybrid** | Genuine Gemini Nano (`10 s` hybrid budget) or single authenticated `debait-d6d5d` Cloud request (`18 s` budget, `ENABLE_HEDGING = false`, `ALLOW_BACKUP_FALLBACK = false`, no mock). | **PASS** (unit tests for routing, `verifyInferenceSource`, `ALLOW_BACKUP_FALLBACK = false`, zero mock fallback) | **UNVERIFIED** — Chrome remote debugging not attached; requires live run with `debait-d6d5d` App Check debug token registered and redacted DevTools Network trace. |
| **2. Local Only + Gemini Nano** | Genuine on-device Nano 1×1 scoring, zero cloud requests, in-flight cloud aborted immediately (`LOCAL_ONLY_SWITCH`), late cloud results/summaries/stats discarded, cloud cache rejected. | **PASS** (`P0-1` + live async `P3` cancellation test) | **UNVERIFIED** — requires live Chrome Network tab capture confirming 0 outbound cloud requests while toggling `Local only` ON mid-batch. |
| **3. Wi-Fi Off (True Offline)** | Cloud skipped; genuine on-device Nano if available, or honest `OFFLINE_UNAVAILABLE` status if Nano is absent (no heuristic faking). | **PASS** (`P0-3` + `firebaseEngine` offline guards) | **UNVERIFIED** — requires physical OS Wi-Fi-off Chrome run confirming genuine `on-device` or `OFFLINE_UNAVAILABLE` behavior. |
| **4. Reconnect Auto-Upgrade** | Coming back online clears transient network lockouts and recovers failed/pending headlines cleanly without fake results; toggling `Local Only` OFF recovers pending headlines cleanly. | **PASS** (`P3` OFF-recovery + `online` handler checks) | **UNVERIFIED** — requires physical offline → online Chrome capture confirming clean recovery and genuine `on-device`/`cloud` provenance. |

---

## 4. Firebase App Check, Voice Release Gate & Privacy Assessment

- **App Check enforcement:** Primary `debait-d6d5d` (`Team`) enforces App Check (`appCheckEnforced: true`). Unprotected `axi-chat-2026` (`Backup`) is hard-blocked (`ALLOW_BACKUP_FALLBACK = false`, `isProjectAllowed()`, `getAi()` throws `PROJECT_NOT_ALLOWED`).
- **Voice Release Gate:** `ENABLE_LIVE_VOICE = false` cleanly gates Talk to Debait in the release build with the honest message `"Voice requires ephemeral token backend under App Check"`, while keeping `LIVE_VOICE = 'Leda'`, `src/offscreen/call.js`, and `functions/index.js` (`mintLiveVoiceToken`, `enforceAppCheck: true`) ready to enable once deployed on `debait-d6d5d`.
- **Host Privacy & CSP:** Broad `http://*/*` + `https://*/*` matching preserves general news testing while MV3 `exclude_matches` + `PRIVATE_HOST_RE` + `isSensitivePage()` + `sw.js` `injectOpenTabs()` block webmail, banking, code hosts/IDEs, cloud consoles, localhost dev tools, and private workspaces. No CSP weakening; Trusted Types handled via `'debait'` → `defaultPolicy` fallback + `try/catch`.

---

## 5. Remaining Release Blockers & Comparison vs. `release/hackathon-final-integration`

### Remaining Release Blockers
1. **Live 4-State Physical Chrome Capture (`UNVERIFIED`):** Must run the 4-state matrix on `dist/` (`mwxgicfu`) in Chrome with a registered `debait-d6d5d` App Check debug token and capture redacted Network evidence + timings + provenance before Nov 30 submission.
2. **Optional Live Voice Deployment:** Voice is safely gated (`ENABLE_LIVE_VOICE = false`). To ship Live Voice enabled, deploy `functions:mintLiveVoiceToken` to `debait-d6d5d` with `GEMINI_API_KEY` in Secret Manager, verify in Chrome, and flip `ENABLE_LIVE_VOICE = true`.

### Comparison vs. `origin/release/hackathon-final-integration` (`241163e`)
`origin/release/hackathon-final-integration` uses a separate modularized engine/test structure (`162` files differ), so **do NOT blindly merge** the two branches. The following changes from `review/pr5-final-hardening` are self-contained and safe to cherry-pick/port cleanly:
- **Safe to integrate immediately:**
  1. Google Search upright tag fix (`src/content/sites/index.js` `.yuRUbf` placement + `src/content/ui/tag.js` `hasVerticalFlip()` counter-flip guard).
  2. Expanded MV3 `exclude_matches` + `PRIVATE_HOST_RE` + localhost dev-tool opt-in guard + `sw.js` `injectOpenTabs()` parity (`manifest.config.js`, `src/content/sites/index.js`, `src/content/main.js`, `src/background/sw.js`).
  3. Trusted Types `defaultPolicy` + try/catch hardening (`src/content/ui/html.js`) and WebGL `restoreContext` guard (`src/content/ui/orb-gl.js`).
  4. Additive App-Check-protected Cloud Function (`.firebaserc`, `firebase.json`, `functions/index.js`, `functions/package.json`) — zero conflicts with `release/hackathon-final-integration`.
  5. `withCloudTimeout` immediate abort on `LOCAL_ONLY_SWITCH` + `modeEpoch`/`modeGen` late-cloud response discard (`src/engine/contract.js`, `src/background/sw.js`, `src/content/main.js`).
- **Keep separate / do not overwrite blindly:** `release/hackathon-final-integration`'s split engine modules (`authPolicy.js`, `qualityPolicy.js`, `quota.js`, `inference.js`), its `tests/*.test.js` suite, and its `docs/release/*` checklist bundle.
