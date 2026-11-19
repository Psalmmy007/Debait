# Integration branch reliability review — 19 November 2026

Reviewed branch: `integration/chisom-features`, starting at `0f6dcc2fecc7d126713227bcf61c248b9b1bf969`.

## Six commits inspected

- `edb31b8`: toolbar popup requests closure of page settings; content message handler closes it.
- `006650e`: distinguishes saved classifications from live AI verification.
- `c0a203e`: records voice startup/session failures and microphone denial.
- `37f409c`: refreshes popup Problems on diagnostic storage changes.
- `6b2d726`: renders real newlines in copied diagnostics.
- `0f6dcc2`: clarifies current AI verification in the on-page panel.

## Findings and repairs

1. **Pending panel opening could win over closure.** `open()` awaited settings before creating its DOM; `close()` returned early when DOM did not yet exist. Added an opening revision so closure cancels the pending opening, and prevented delayed outside-click listeners being installed after closure. Existing animation and styling remain.
2. **Raw diagnostic payloads could expose private information.** Previous logging truncated strings but did not remove tokens, provider URLs, stack traces or page text. New shared diagnostics use fixed descriptions and phase names only. Worker startup scrubs legacy entries; popup display and copy sanitize independently. No hostname/headline/transcript is retained by this logger. Deliberately less detail is retained than a raw provider error.
3. **Concurrent log writes could lose errors.** Serialized the bounded log writer. It recovers after a storage-write failure. A failed diagnostic write no longer prevents voice shutdown.
4. **Microphone denial handler was not reached from the permission page.** The page now sends `debait/mic-denied`, and tells the user to restart from the popup after fixing permission. Failed worker startup after permission grant also enters the startup log.
5. **Popup Problems could be overwritten by an older read.** Added a revision guard to prevent a delayed old storage read from hiding a newly arrived voice error. Malformed, expired or future-dated legacy rows are ignored. Clipboard denial produces a useful message instead of an unhandled rejection.
6. **Cached result behavior was correct.** Worker cache hits do not call the inference engine. Engine verification is only updated by validated fresh inference; its source resets when the AI session is recreated. Regression tests now exercise cache hit → unverified status → fresh controlled SDK inference → verified source → recreated session unverified. `cloud` on a saved classification describes its original source, not a new request or a Live voice connection. No classification policy/prompt/cache schema changes were needed.

## Validation

- Initial default `npm ci` could not write the environment's home-directory npm cache. Reran successfully with `npm ci --cache /tmp/debait-review-npm-cache`; no dependency changes.
- Baseline: 379 tests passed, 0 failed. Final deterministic suite: 390 passed, 0 failed.
- Core browser suite passed, including actual popup-module → controlled tab-message bridge → actual content handler → settings DOM closure, and pending-opening cancellation.
- Stage 2 UI checks: 100 passed, 0 failed. Built-layout checks: 48 passed, 0 failed, both themes. Covers immediate diagnostic refresh, safe copying, clipboard denial, malformed data and out-of-order reads.
- Audio/privacy/browser checks passed with real packaged WebAudio worklets and a synthetic microphone. Includes microphone-denial reporting, track cleanup, no sends after privacy abort, orb personalization and safe share-card exclusions.
- Development, production, web and demo builds passed. Worklet packaging/minimum permissions/CSP checks passed; Evaluation Lab build isolation passed.
- Native loaded-extension check: **BLOCKED**, exit 2. Managed Chromium disallows unpacked extensions. No native popup/offscreen/authenticated microphone conversation was verified. All controlled browser checks used fixtures and made zero Gemini requests.
- A new browser regression initially used an incorrect Vite import URL and failed to load its test component. Corrected the test URL to `/@fs`; affected suite passed afterwards. No unresolved automated failure.

No classification policy, semantic rewrite acceptance, App Check/Firebase configuration, quotas, statistics or Evaluation Lab source changed. No mock fallback introduced. No branch merged or release created.

## Manual Chrome checklist

1. Update this branch, run `npm ci`, then `VITE_DEBAIT_APP_CHECK=debug npm run build:dev`. Keep your registered development token private; do not paste it into screenshots or reports.
2. Open `chrome://extensions`, reload Debait from `dist`, and refresh the news tab. Use the unpacked development build, not the production build, for debug authentication.
3. Right-click the orb to open page settings; click Debait's toolbar icon. Page settings must close while the toolbar popup remains usable. Repeat several times, including immediately after opening page settings.
4. With voice off, revisit a page whose headlines were already analyzed. Saved tags may remain. After a new AI session, status should be Not verified unless a new request actually succeeds. A saved Cloud tag alone must not be interpreted as fresh inference or a connected voice call. An unseen headline may legitimately cause a fresh request and update status.
5. Explicitly opt into cloud voice with Local Only off. Reset/deny microphone permission if you want to test failure handling. Problems should show a microphone/voice failure; it must not show credentials, private URLs or raw payloads. Allow permission afterwards and restart from the popup. If permission is already granted, a genuine startup/session failure should also appear. Do not manufacture production outages or change Firebase settings to force failures.
6. Leave the popup open during a genuine failure if possible; Problems should update without closing/reopening. Copy diagnostics: ordinary line breaks and fixed descriptions, no token or private page text. If copying is denied, a clear fallback message appears.
7. With Local Only on, cloud voice must not start. Switch it on during an actual call: mic indicator and cloud connection must stop. Stopping voice normally must also release the microphone. Never publish secret-bearing network URLs or debug token logs as evidence.
8. A real voice PASS requires a successful authenticated spoken exchange on your own Chrome plus cleanup/privacy checks. This review has not established that outcome. See `VOICE_INTEGRATION.md` for the full connection-loss and audio checklist.
