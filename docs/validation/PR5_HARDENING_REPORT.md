# Debait PR #5 Hardening Report (`review/pr5-final-hardening`)

**Date:** 26 November 2026  
**Branch:** `review/pr5-final-hardening` (branched from `polish/hackathon-ready` at `bf4066c`)  
**Verification Commands:** `npm test` (11/11 passed), `npm run build` (`vite v6.4.6`, 55 modules, built in 7.34 s, 0 warnings/errors), `console.(warn|error)` scan across `src/` and `public/` (0 hits).  
**Secrets Check:** No Firebase App Check debug tokens, authorization headers, or private credentials are committed or logged.

---

## 1. Audit Findings Resolved (P0 – P2)

| ID | Finding | Status | Implementation Summary |
|---|---|---|---|
| **P0-1** | Local Only cache isolation not enforced at retrieval | **Fixed** | `CACHE_VERSION = 5`; `isCacheEntryValid(entry, localOnly)` in `src/engine/contract.js` is enforced in both `src/background/sw.js` (`scoreTexts`) and `src/content/main.js` (`localCache`). Prior `cloud` entries are strictly rejected whenever `localOnly` is `true`; `mock` entries are never cached; toggling `Local only` ON cancels in-flight cloud calls (`MSG.CANCEL_CLOUD`) and clears non-local cached summaries. |
| **P0-2** | Backup-project contradiction & unprotected auth bypass | **Fixed** | Set `ALLOW_BACKUP_FALLBACK = false` in `src/engine/firebaseConfig.js`. Added `isProjectAllowed(i)` and enforced it across `projectOrder()`, `preferredProject()`, `setPreferredProject()` (sanitizing any stale `engineMemory.prefer = 1` from earlier builds back to `0`), `getAi()` (throws `PROJECT_NOT_ALLOWED`), `fixUnchangedRewrites()`, `scoreWithNano()`, `summarize()`, and `liveProjectOrder()` / `picked` in `src/offscreen/call.js`. Headline scoring, summaries, rewrites, and Live voice can ONLY target the primary App Check-enforced `Team` project (`debait-d6d5d`). Global `WebSocket.prototype.send` monkeypatch remains removed; `LIVE_VOICE = 'Leda'` remains untouched. |
| **P0-3** | Automatic mock/heuristic fallback masquerading as AI | **Fixed** | Removed silent `mockEngine` fallbacks from `src/engine/index.js` (`scoreHeadlines` & `summarize`): offline-without-Nano and cloud failures throw explicit `OFFLINE_UNAVAILABLE` / `AI_UNAVAILABLE` errors surfaced honestly in the orb/panel. Preview-only `mock` is labeled `"Heuristic estimate — not AI"`, with sharing/auto-debaiting/caching/stats disabled. |
| **P0-4** | Rewrites could invent unsupported facts | **Fixed** | Replaced unsafe prompt examples in `src/engine/firebaseEngine.js` (and `mockEngine.js`) with strictly fact-preserving rewrites. Deterministic `validateRewriteIntegrity(original, rewrite)` in `src/engine/contract.js` blocks invented numbers/dates, unsupported attribution/backstory terms, polarity flips, and bloat across every pass including `fixUnchangedRewrites()`. Unsafe rewrites surface `"No verified neutral rewrite available"` (`rewrite_safe: false`) and never overwrite page DOM. `"Wording check, not a fact-check"` is shown in `src/content/ui/card.js`. |
| **P1-5** | Summarizer auto-upload without explicit consent & private page exposure | **Fixed** | Explicit **Summarize this page** opt-in button in `src/content/ui/settings.js` with clear data-flow disclosure. `isSensitivePage()` / `PRIVATE_HOST_RE` in `src/content/sites/index.js` blocks webmail, banking, code hosts/IDEs, cloud consoles, workspaces, AI chats, localhost dev tools (without `[data-debait-headline]`), and login/password pages. `summaryGen` cancels stale in-flight summaries on navigation or `Local only` changes. |
| **P1-6** | Unknown `inferenceSource` metadata silently treated as `'cloud'` | **Fixed** | `verifyInferenceSource(rawSource, expectedMode)` in `src/engine/firebaseEngine.js` normalizes valid SDK casing (`on_device`/`in_cloud`), derives provenance when omitted on explicit `ONLY_ON_DEVICE`/`ONLY_IN_CLOUD` routes, and throws `SOURCE_MISMATCH` on cross-route contradictions or unrecognized values. |
| **P1-7** | Speculative hedging & multi-project races duplicate cloud dispatches | **Fixed** | `ENABLE_HEDGING = false` by default; single authenticated request on primary project (`debait-d6d5d`); `cancelActiveCloudRequests()` + `MSG.CANCEL_CLOUD` immediately aborts in-flight cloud work when `Local only` turns on. |
| **P1-8** | App Check enforcement & debug token transparency | **Documented & Enforced** | Primary `Team` project (`debait-d6d5d`) keeps **App Check enforced** (`appCheckEnforced: true`). Unprovisioned cloud calls return an explicit App Check status (`Cloud AI blocked until App Check debug token is registered`) without faking AI or silently falling back to `axi-chat-2026`. |
| **P1-9** | Broad host permissions without sensitive-site exclusions & Trusted Types / CSP safety | **Fixed** | **Why broad matching + explicit exclusions (instead of a tiny allowlist):** Debait retains `http://*/*` and `https://*/*` in `manifest.config.js` so hackathon judges and everyday readers can test Debait on *any* news site, blog, or search engine worldwide rather than only a handful of hardcoded domains. To protect sensitive user data without breaking general news testing, Chrome blocks script injection before execution via `exclude_matches` across: **webmail** (Gmail, Outlook/Office 365, Yahoo Mail, Proton Mail, Fastmail, iCloud Mail), **banking/financial portals** (Chase, Bank of America, Wells Fargo, Citi, Capital One, PayPal, Stripe Dashboard, Wise, Venmo, Cash App, Robinhood, Coinbase, Fidelity, Schwab, Vanguard, Barclays, HSBC), **cloud IDEs, code hosts, consoles & localhost dev tools** (GitHub, GitHub Codespaces, GitLab, Bitbucket, Replit, VS Code Web, CodeSandbox, StackBlitz, Firebase/GCP/AWS/Azure consoles, `*.localhost`, localhost dev paths, plus runtime opt-in guard requiring `[data-debait-headline]` on `localhost`/`127.0.0.1`), and **private workspaces & AI chats** (Google Docs/Drive/Sheets/Slides/Calendar/Meet, Notion, Slack, Discord, Figma, Linear, Atlassian, Gemini/ChatGPT/Claude/Copilot/DeepSeek). `src/content/sites/index.js` (`PRIVATE_HOST_RE`, `isSensitivePage`) and `src/background/sw.js` (`injectOpenTabs`) enforce the exact same host rules. `src/content/ui/html.js` uses `trustedTypes.createPolicy('debait', ...)` → `defaultPolicy` fallback + `try/catch` and Shadow DOM `CSSStyleSheet` without weakening any site or extension CSP. |
| **P1-10** | Reproducible regression test suite & balanced fixture evaluation | **Fixed** | `npm test` (`node --test tests/*.test.js`) with `tests/fixtures/headlines.json` and `tests/hardening.test.js` (11/11 passing), now including strict P0 backup-project lockouts and P1 exclusion/CSP assertions. |
| **P2-11** | Chimes, AudioWorklet playback, mute, WebGL & Google Search tag orientation | **Verified** | Offline bundled chimes, lock-free `Float32Array` AudioWorklet ring buffer, optimistic mute, WebGL `restoreContext` guard, and Google Search `.yuRUbf` / `hasVerticalFlip()` upright tag fix preserved from `bf4066c`. |
| **P2-12** | Documentation parity (`docs/ENGINE.md`, `README.md`, report) | **Fixed** | Docs and code now agree 100%: `ALLOW_BACKUP_FALLBACK = false`, broad news support with explicit sensitive-site exclusions, and honest App Check / Live voice status. |

---

## 2. Automated Verification Results (Actual Run Outputs)

```text
npm test (node --test tests/*.test.js)
✔ P0-1: Local Only cache isolation rejects cloud and mock entries (6.2024ms)
✔ P0-2: Release disables unprotected backup project across scoring, summaries, and voice while keeping LIVE_VOICE (7.8439ms)
✔ P0-3: No silent mock fallback in production engine and mock is labeled non-AI (6.5515ms)
✔ P0-4: Rewrite integrity gate rejects invented facts, numbers, and polarity flips across balanced fixtures (10.0879ms)
✔ P1-5: Summarizer enforces sparse check, refusal filter, explicit opt-in, and sensitive host protection (6.9433ms)
✔ P1-6: Source provenance normalizes casing/omission and rejects cross-route mismatches (1.5239ms)
✔ P1-7: Hedging disabled by default and cloud cancellation helper exists (0.9383ms)
✔ P1-9: Broad news/web support preserved while excluding webmail, banking, code hosts, workspaces, and localhost dev tools + Trusted Types/CSP safe (8.5982ms)
✔ Nano compact expansion integrates cleanly with strict rewrite-safety normalization (2.0345ms)
✔ P2-11: AudioWorklet ring buffer, optimistic mute, and WebGL restoreContext guard remain intact (5.8364ms)
✔ Network, Call, and Local resilience regressions (75.0048ms)
ℹ tests 11 | pass 11 | fail 0 | duration_ms 16153.0317

npm run build (npm run fonts && vite build)
vite v6.4.6 building for production...
✓ 55 modules transformed.
dist/manifest.json  4.20 kB │ gzip: 1.15 kB
✓ built in 7.34s (0 warnings, 0 errors)
```

---

## 3. App Check & Voice Call Blocker (Decision Required)

- **Primary project (`debait-d6d5d` / Team):** App Check **enforced** (`appCheckEnforced: true`).
- **Backup project (`axi-chat-2026`):** **Disabled** (`ALLOW_BACKUP_FALLBACK = false`) across `projectOrder()`, `liveProjectOrder()`, `setPreferredProject()`, and `getAi()`.
- **Flagged Gemini Live Voice Blocker (`src/offscreen/call.js`):**
  - The "Talk to Debait" voice feature (`LIVE_VOICE = 'Leda'`) is kept intact (NOT disabled).
  - **Known technical constraint:** Browser `WebSocket` APIs cannot attach custom `X-Firebase-AppCheck` HTTP headers to WebSocket upgrade handshakes. Previously, Live voice connected by falling back to the unprotected `Backup` project (`axi-chat-2026`, `appCheckEnforced: false`).
  - Now that `ALLOW_BACKUP_FALLBACK = false`, `liveProjectOrder()` routes Live calls exclusively to `debait-d6d5d` (`appCheckEnforced: true`). If `debait-d6d5d` enforces App Check on Firebase AI Logic WebSocket connections without query-param token acceptance, **Live Voice will reject connections with an App Check error** (HTTP headline scoring & summaries will work normally once the per-install debug token is registered).
  - **Options for your decision:**
    1. Keep strict App Check on `debait-d6d5d` and test whether Firebase AI Logic's Live SDK passes the App Check debug token for `debait-d6d5d` once registered in Firebase Console; or
    2. Use a small authenticated backend/Cloud Function to mint short-lived ephemeral Gemini Live tokens for `debait-d6d5d` (preserving App Check protection without using an unprotected backup project); or
    3. Explicitly accept/document a supervised demo policy if Live WebSockets require a separate App-Check-compatible configuration.

---

## 4. Four-State Evidence Table (Honest Status)

| State | Code & Automated Test Verification | Physical Chrome Hardware Capture |
|---|---|---|
| **1. Online Hybrid** | **Verified in code & unit tests:** Nano pre-warm/clone tried first (`10 s` budget), single authenticated primary-project (`debait-d6d5d`) cloud request (`18 s` budget, `ENABLE_HEDGING = false`, `ALLOW_BACKUP_FALLBACK = false`), `verifyInferenceSource`, zero mock fallback. | Pending hardware run with registered `debait-d6d5d` App Check debug token on this commit. |
| **2. Local Only + Nano** | **Verified in code & unit tests:** Cloud blocked, in-flight cloud aborted (`MSG.CANCEL_CLOUD`), cloud cache strictly rejected (`isCacheEntryValid(entry, true)`), 1×1 viewport-first Nano queue. | Pending hardware capture on this commit (confirm zero cloud requests in DevTools Network). |
| **3. Full Wi-Fi OFF** | **Verified in code & unit tests:** Cloud skipped; runs 1×1 on Nano if downloaded, or surfaces honest `OFFLINE_UNAVAILABLE` status if Nano is absent. | Pending physical adapter-off capture on this commit. |
| **4. Reconnect Auto-Upgrade** | **Verified in code & unit tests:** `online` handlers clear transient lockouts and re-queue pending/failed headlines once while respecting `Local only`. | Pending physical offline → online capture on this commit. |
