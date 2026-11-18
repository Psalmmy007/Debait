# Gemini Live voice integration

## Scope and source review

Implemented only on `integration/chisom-features`, starting at `7c10ca1672950cd09ad23c46f9f56cbc1912e226`. Reviewed Chisom's `feature/ui-scaffold` at `7bfa076e3b2fd2a772536a9e1c2f7f0f627763c0`; no branch merge. Orb personalization and safe share-card features already on the integration branch are retained.

The audio design adapts Chisom's native microphone processing, separate capture/playback rates, short capture frames, buffered playback and speaking feedback. It does not copy his backend, credentials, classifier, statistics or alternate Firebase configuration.

## Why a packaged audio adapter

Firebase 13.3.0's public `startAudioConversation` implementation creates a blob worklet URL. That is unsuitable for this extension's strict self-only MV3 policy; its initialization failure path also does not reliably release an acquired microphone stream. The extension now packages its own small AudioWorklet and uses public `LiveSession` methods exclusively.

API evidence is the installed `@firebase/ai/dist/ai-public.d.ts` and `dist/esm/index.esm.js`: `connect(sessionResumption)`, `sendAudioRealtime`, `receive`, `sendFunctionResponses`, `send` and `close`. Input transcription is a supported generation option. There is one receiver per session. No private socket access, WebSocket monkeypatch, speculative duplicate request, new permission, blob CSP exception, or independent Gemini caller.

- Capture: mono PCM16 little endian, 16 kHz, 40 ms frames. Request Chrome echo cancellation, noise suppression and automatic gain control; actual effectiveness depends on hardware/drivers.
- Playback: 24 kHz PCM, short adaptive jitter cushion, short-turn flushing, interruption clearing, restrained boundary fades and bounded buffer. An excessive backlog stops with an error rather than silently dropping speech.
- Contexts must actually run at the required rates. Unsupported/suspended initialization fails honestly. No unverified fractional resampler.
- Do not use a fixed microphone volume gate: it could suppress quiet speech. Firebase 13.3.0 does not expose the proposed VAD/pause sensitivity settings in its public Live configuration. Those enhancements are deliberately omitted.
- Actual SDK input transcription alone produces the heard indicator. No fabricated transcript. Transcript text is temporary, not written to storage.

## Consent, cancellation and cleanup

The existing service worker owns voice consent and Local Only. Enabling Local Only continues to hard-close the offscreen document, including a pending connection. Audio, tool dispatch and reconnection recheck permission; no queued audio may send after cancellation. Stopping releases tracks and both audio contexts. A single audio owner prevents duplicate capture, including during permission prompts.

Browser `getUserMedia` and SDK `connect` do not accept an abort signal here. A late microphone stream is stopped before graph setup; a late SDK connection is immediately closed. While an unresolved permission prompt exists, another capture is refused. Switching Local Only destroys the offscreen document rather than relying only on late completion checks. Audio already transmitted before a setting change cannot be recalled.

Connection handshakes use the existing shared local request gate and daily budget. A server quota error persists a scalar cooldown and honors exposed server retry guidance. This gate is not a reservation of streaming tokens, project-wide Live concurrency or other users' quota; Firebase still enforces those limits. No App Check or Firebase configuration changed.

## Reconnection and page actions

Only a server-issued resumable handle enables automatic reconnection, with the same model and existing tool identities. Release microphone during backoff. At most three retries per call, after 10, 20 and 40 seconds; the count does not reset after a brief successful reconnection. Each attempt also passes the shared quota gate and privacy checks. Authentication, quota and fatal audio failures do not start an automatic retry loop. Without a handle, end the call and ask for a new call/new conversation.

The public SDK supplies no client acknowledgement/replay API for pending audio. We do not replay audio or the greeting. A resumption message explicitly warns that recent speech may be missing. Context preservation must be confirmed in a real Gemini session; it is not described as seamless.

Tool calls execute serially. Cache each call ID and arguments only in this call's memory, bounded to 128 entries. Repeated IDs return the recorded result with an explicit replay notice, not a second page action or a claim of fresh success. Changed arguments under the same ID are rejected. Server cancellations and Local Only prevent new dispatch/response. A page action already dispatched cannot be undone, but no new action is sent after revocation. Failed actions return errors to Gemini and the orb; voice instructions prohibit pretending they succeeded.

## Controlled verification and limits

- `npm ci`: successful, Firebase 13.3.0 installed.
- `npm test`: 379 passed, 0 failed. Fixtures test lifecycle, permission denial, unsupported model, authentication failures, late connections, retries, cancellation, Local Only, replayed/cancelled/failed tools, PCM, buffering and cleanup. These are deterministic tests, not Gemini quality evidence.
- `scripts/check-voice-integration.cjs`: real Chromium AudioContext/worklets under self-only CSP, **synthetic microphone and controlled Live session**. Checks privacy abort, released tracks, no later sends, permission page, orb sizes and share PNG/download fallback. Zero real Gemini requests.
- Existing core browser suite passed. UI checks: 100 passed, 0 failed, 36 controlled screenshots; built-layout checks: 30 passed, 0 failed. Their Chrome API/AI fixtures are controlled. They do not establish native extension or cloud voice success.
- Development, production, web and demo builds passed. Evaluation Lab isolation passed for development, production and demo; production/demo exclude it. Extension worklet packaging checks passed. No classification/rewrite, Firebase configuration, statistics or Evaluation Lab source changes.
- `scripts/check-voice-build.js`: packaged worklet, unchanged minimum permissions and no blob CSP relaxation.
- Native extension loading is blocked by this environment's managed Chromium `ExtensionInstallBlocklist: ["*"]`. No policy bypass attempted. Native toolbar/offscreen audio, real microphone, App Check-authenticated Live model and real server resumption remain manual checks. Do not call this native voice verified or production ready.

## Laptop verification checklist

1. Check out/pull `integration/chisom-features`. Run `npm ci`, then `VITE_DEBAIT_APP_CHECK=debug npm run build:dev`. Use only your privately registered development App Check token. Never paste it into issues or screenshots.
2. Open Chrome Extensions, reload the unpacked extension from `dist`, then refresh the news tab. Keep Auto-Debait off for the first voice test. Cloud voice requires Local Only off and explicit voice opt-in.
3. Start voice from the popup. Allow microphone access in the extension permission tab. Verify the orb's actual status and Chrome's microphone indicator; permission granted alone is not a connected call.
4. Speak two sentences, pause, and listen. Test quiet speech, background sound, headphones, interruption and a brief utterance. Capture actual errors if audio fails; do not infer that a controlled test proves a successful conversation.
5. Ask what Debait found on the page, then request a supported page action. Verify the page really changed. Test an unavailable page action: it must report failure, not success. Restore originals afterwards.
6. Stop voice: microphone indicator must disappear. Deny permission and retry: clear error, no live session. Repeat a small number of start/stop cycles; never hammer the free-tier project.
7. Enable Local Only before starting: no cloud call. Enable it while connecting and during a call: microphone stops, offscreen document/cloud connection closes, and no automatic restart occurs. Check extension service worker/offscreen inspectors without sharing secret-bearing URLs or token logs.
8. Briefly disconnect networking. With a valid server handle, expect microphone release, bounded retry and a context-loss warning. Otherwise expect a stopped call and a request to start again. Cancel during backoff: no later reconnection. Confirm a page command is not executed twice. If the SDK/server does not provide a handle, automatic resume is correctly unavailable.
9. Verify orb 75%, 100%, 160%, dragging and saved setting; verify safe share-card PNG/clipboard fallback. Clean, unchanged or rejected rewrites must not gain a shareable fabricated alternative.

PASS requires an actual authenticated spoken exchange plus cleanup/privacy checks on native Chrome. PARTIAL means only some runtime behaviors verified. BLOCKED means hardware, permission, model, quota or policy prevents a test. FAIL means a reproducible safeguard/functionality defect. Record browser/OS/model/build SHA and exact redacted error, not credentials or private page content.
