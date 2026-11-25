# Debait PR #5 Hardening Report (`polish/hackathon-ready`)

**Date:** 25 November 2026  
**Branch:** `polish/hackathon-ready` (PR #5)  
**Verification Commands:** `npm test` (10/10 passed), `npm run build` (`vite v6.4.6`, built in 6.63 s, 0 warnings/errors), `console.(warn|error)` scan across `src/` (0 hits).  
**Secrets Check:** No Firebase App Check debug tokens, authorization headers, or private credentials are committed or logged.

---

## 1. Audit Findings Resolved (P0 – P2)

| ID | Finding | Status | Implementation Summary |
|---|---|---|---|
| **P0-1** | Local Only cache isolation not enforced at retrieval | **Fixed** | Bumped `CACHE_VERSION` to `5`; added `isCacheEntryValid(entry, localOnly)` in `src/engine/contract.js` and enforced it in both `src/background/sw.js` (`scoreTexts`) and `src/content/main.js` (`localCache`). Prior `cloud` entries are strictly rejected whenever `localOnly` is `true`; `mock` entries are never cached; toggling `Local only` ON cancels in-flight cloud calls (`MSG.CANCEL_CLOUD`) and clears non-local cached summaries. |
| **P0-2** | Global `WebSocket.prototype` monkeypatch & silent backup routing | **Fixed** | Removed the global `WebSocket.prototype.send` monkeypatch from `src/offscreen/call.js`. Kept `LIVE_VOICE = 'Leda'` untouched. Set `ALLOW_BACKUP_FALLBACK = false` in `src/engine/firebaseConfig.js` so `projectOrder()` routes only to the primary App Check-enforced `Team` project (`debait-d6d5d`) by default. |
| **P0-3** | Automatic mock/heuristic fallback masquerading as AI | **Fixed** | Removed silent `mockEngine` fallbacks from `src/engine/index.js` (`scoreHeadlines` & `summarize`): offline-without-Nano and cloud failures now throw explicit `OFFLINE_UNAVAILABLE` / `AI_UNAVAILABLE` errors surfaced honestly in the orb/panel. Conspicuously labeled any preview-only `mock` source as `"Heuristic estimate — not AI"`, disabled sharing/auto-debaiting/caching/stats for `mock`. |
| **P0-4** | Rewrites could invent unsupported facts | **Fixed** | Replaced all 3 unsafe prompt examples in `src/engine/firebaseEngine.js` (and `mockEngine.js`) with strictly fact-preserving rewrites. Added deterministic `validateRewriteIntegrity(original, rewrite)` in `src/engine/contract.js` (blocks invented numbers/dates, invented attribution/backstory words such as `"study"`, `"years of saving"`, `"exchange"`, polarity flips, and excessive bloat) enforced after every pass including `fixUnchangedRewrites()`. Unsafe rewrites surface `"No verified neutral rewrite available"` (`rewrite_safe: false`) and never overwrite page DOM. Added `"Wording check, not a fact-check"` to `src/content/ui/card.js`. |
| **P1-5** | Summarizer auto-upload without explicit consent & private page exposure | **Fixed** | Removed auto-`summarize()` on settings panel open in `src/content/ui/settings.js`; users now click an explicit **Summarize this page** button with clear data-flow disclosure. Added `isSensitivePage()` / `PRIVATE_HOST_RE` in `src/content/sites/index.js` (blocks `github.dev`, `vscode.dev`, webmail, docs/drive, Slack/Discord, banking, login/password pages). Added `summaryGen` cancellation on navigation and `Local only` switches. Updated `README.md` privacy disclosure to match. |
| **P1-6** | Unknown `inferenceSource` metadata silently treated as `'cloud'` | **Fixed** | Added strict `verifyInferenceSource(rawSource, expectedMode)` in `src/engine/firebaseEngine.js`: requires `'on_device'` for on-device routes and `'in_cloud'` for cloud routes, throwing `SOURCE_MISMATCH` otherwise. |
| **P1-7** | Speculative hedging & multi-project races duplicate cloud dispatches | **Fixed** | Set `ENABLE_HEDGING = false` by default and switched cloud dispatch to a single authenticated request per permitted project. Added `cancelActiveCloudRequests()` + `MSG.CANCEL_CLOUD` triggered when `Local only` switches ON. |
| **P1-8** | App Check enforcement & debug token transparency | **Documented & Enforced** | Primary `Team` project stays App Check-enforced (`appCheckEnforced: true`). Unprovisioned cloud calls return an explicit App Check status (`Cloud AI blocked until App Check debug token is registered`) without faking AI. Documented supervised debug-token flow in `docs/ENGINE.md` and `README.md`. |
| **P1-9** | Overly broad `http://*/*` / `https://*/*` host scope & Trusted Types CSP errors | **Fixed** | Narrowed `SITES` in `manifest.config.js` to explicit supported domains (`x.com`, `twitter.com`, `youtube.com`, `bbc.com`, `bbc.co.uk`, `www.google.com`, `localhost`, `127.0.0.1`). Hardened `src/content/ui/html.js` to fall back to `trustedTypes.defaultPolicy` and catch strict Trusted Types errors safely without weakening site CSP. |
| **P1-10** | Missing reproducible test suite & balanced fixture evaluation | **Fixed** | Added `npm test` (`node --test tests/*.test.js`), `tests/fixtures/headlines.json` (balanced neutral, UI, quote, rage/fear/envy, and adversarial cases), and `tests/hardening.test.js` (10/10 passing). |
| **P2-11** | Chimes, AudioWorklet playback, mute & WebGL reliability | **Verified** | Offline bundled chimes (`chime-start.ogg`, `chime-end.mp3`), lock-free `Float32Array` AudioWorklet ring buffer (`40 ms` pre-buffer, `2 ms` ramp, `<1 ms` flush), 0 ms optimistic `32×32 px` mute toggle (`track.enabled = !muted`), and WebGL `restoreContext` guard (`lostByUs` + `canRestore`) verified intact. |
| **P2-12** | Outdated `docs/ENGINE.md` and mismatched `README.md` | **Fixed** | Rewrote `docs/ENGINE.md` to reflect actual hybrid architecture, updated `README.md` privacy/setup/hybrid docs, and added `npm test`. |

---

## 2. Automated Verification Results

```text
npm test (node --test tests/*.test.js)
✔ P0-1: Local Only cache isolation rejects cloud and mock entries
✔ P0-2: Voice removes global WebSocket monkeypatch, respects primary project policy, keeps LIVE_VOICE
✔ P0-3: No silent mock fallback in production engine and mock is labeled non-AI
✔ P0-4: Rewrite integrity gate rejects invented facts, numbers, and polarity flips across balanced fixtures
✔ P1-5: Summarizer enforces sparse check, refusal filter, explicit opt-in, and sensitive host protection
✔ P1-6: Strict source provenance verification rejects unknown or mismatched metadata
✔ P1-7: Hedging disabled by default and cloud cancellation helper exists
✔ P1-9: Manifest narrows host scope and private hosts + Trusted Types are protected
✔ Nano compact expansion integrates cleanly with strict rewrite-safety normalization
✔ P2-11: AudioWorklet ring buffer, optimistic mute, and WebGL restoreContext guard remain intact
ℹ tests 10 | pass 10 | fail 0

npm run build
✓ 55 modules transformed.
✓ built in 6.63s (0 warnings, 0 errors)
```

---

## 3. Four-State Evidence Table (Honest Status)

> Note: Automated unit tests and production bundling were executed in this environment; physical Chrome hardware/network traces must be captured on target desktop hardware before final submission.

| State | Code & Automated Test Verification | Physical Chrome Hardware Capture |
|---|---|---|
| **1. Online Hybrid** | **Verified in code & unit tests:** Nano pre-warm/clone tried first (`10 s` budget), single authenticated primary-project cloud request (`8 s` budget, `ENABLE_HEDGING = false`), strict `verifyInferenceSource`, zero mock fallback. | Pending teammate hardware run & redacted network log on current commit. |
| **2. Local Only + Nano** | **Verified in code & unit tests:** Cloud blocked, in-flight cloud aborted (`MSG.CANCEL_CLOUD`), cloud cache strictly rejected (`isCacheEntryValid(entry, true)`), 1×1 viewport-first Nano queue. | Pending teammate hardware run on current commit (confirm zero cloud requests in DevTools Network). |
| **3. Full Wi-Fi OFF** | **Verified in code & unit tests:** Cloud skipped; runs 1×1 on Nano if downloaded, or surfaces honest `OFFLINE_UNAVAILABLE` status if Nano is absent (no heuristic faking). | Pending physical adapter-off test on current commit (with and without Nano). |
| **4. Reconnect Auto-Upgrade** | **Verified in code & unit tests:** `online` handlers clear transient lockouts and re-queue failed/pending headlines once while respecting `Local only`. | Pending physical offline → online transition capture on current commit. |

---

## 4. App Check & Security Status

- **Primary project (`debait-d6d5d` / Team):** App Check **enforced** (`appCheckEnforced: true`).
- **Backup project (`axi-chat-2026`):** Disabled by default (`ALLOW_BACKUP_FALLBACK = false`) so no headline or voice traffic is silently sent to a monitoring-only project.
- **Setup for judges/reviewers:** Load `dist/` unpacked at `chrome://extensions`, open the popup, copy the generated per-install debug token, and register it under Firebase Console → App Check → Apps → Manage debug tokens. Never commit or screenshot the token.

---

## 5. Recommendation & Top 3 Remaining Actions

**Status:** Code-level P0, P1, and P2 hardening blockers are resolved on `polish/hackathon-ready` with passing `npm test` and `npm run build`. Final merge recommendation: **Ready for physical Chrome 4-state hardware sign-off and selective integration review against `release/hackathon-final-integration`**.

1. **Run & record the 4-state Chrome hardware matrix** on the latest `polish/hackathon-ready` build (capturing commit SHA, `dist/build.json` stamp, redacted DevTools Network traces, and `on_device`/`in_cloud` provenance).
2. **Verify App Check debug token registration** on the enforced `Team` project (`debait-d6d5d`) on both teammates' machines and confirm live cloud scoring + voice behavior under enforced auth.
3. **Review and selectively integrate** the verified improvements with `release/hackathon-final-integration` (PR #4) via a clean review PR before final submission to `main`.
