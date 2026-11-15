# Debait engine: handoff for the Firebase side

The UI is done against a **mock engine**. Your job is to replace it with Firebase AI Logic.
You only touch `src/engine/`. Nothing in the UI changes.

**Your web analyzer is still here.** `index.html`, `src/main.js` and `src/firebase.js` are
untouched. Run it with `npm run dev` (http://localhost:5173). The extension builds separately with
`npm run build`. To move the AI into the extension, reuse `src/firebase.js` and your prompt from
`src/main.js` inside `src/engine/firebaseEngine.js`, mapping your fields to the shape below.
For example, `neutralRewrite` becomes `honest_rewrite`. The extension also needs `kind`, `score`
and exact `triggers` words for the tags and highlights.

## Where the engine runs

`src/offscreen/` is an offscreen document: a hidden extension page with a DOM.
The Firebase SDK and Chrome's Prompt API (Gemini Nano) both work there.

```
content script ──► service worker (cache + stats) ──► offscreen page ──► engine
```

The service worker already does the cache (a headline is never scored twice) and
the daily stats. You only score the texts that reach you.

## What to implement: `src/engine/firebaseEngine.js`

```js
scoreHeadlines(texts, { localOnly })  // → Promise<ScoreResult[]>, same order as texts
getStatus({ localOnly })              // → Promise<EngineStatus>
initDeviceModel()                     // → Promise<EngineStatus>, after "Turn on Debait" click
```

Shapes are in `src/engine/contract.js`. One result looks like:

```json
{
  "kind": "rage",
  "score": 91,
  "triggers": [{ "word": "DESTROYS", "why": "outrage trigger" }],
  "honest_rewrite": "Senator disagrees with a reporter's question",
  "source": "on-device"
}
```

- `triggers[].word` must be the **exact words from the headline** (the UI highlights them).
- `source` must be `"on-device"` or `"cloud"`, depending on what actually ran. The UI shows it.
- Results go through `normalizeResult()`, so a bad field won't crash the UI.

## Turning it on

1. `npm install firebase` (pin the exact version).
2. Put the web app config in `src/engine/firebaseConfig.local.js` (this file is git-ignored).
3. In `firebaseEngine.js`:
   ```js
   import { initializeApp } from 'firebase/app';
   import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
   import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from 'firebase/ai';
   ```
   Use `InferenceMode.PREFER_ON_DEVICE`, or `ONLY_ON_DEVICE` when `localOnly` is true.
   Use a JSON response schema for scoring.
4. Set `USE_MOCK = false` in `src/engine/index.js`.
5. Run `npm run build` and reload the extension at `chrome://extensions`.

## Things to check

- **App Check in an extension:** reCAPTCHA loads remote script, which MV3 blocks.
  Set `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` *before* `initializeAppCheck` and register
  the debug token printed in the offscreen page's console. Open that console from
  chrome://extensions → Debait → "Inspect views: offscreen".
- **Model download needs a user click.** The popup's "Turn on Debait" button sends
  `debait/init` → `initDeviceModel()`. If Chrome refuses the download from the offscreen
  page (no user activation), call `LanguageModel.create()` once directly in `popup.js`
  inside the click handler. Once the model is downloaded, the offscreen page can use it.
- **On-device is single-turn.** Send each batch (≤ 8 headlines) as one prompt that asks for a JSON array.
- **Local only:** when `localOnly` is true, never fall back to the cloud. Return `kind: "clean"`
  with a `source` of `"on-device"`, or throw if the model is unavailable.

## Update: the engine is wired (Firebase AI Logic hybrid)

`src/engine/firebaseEngine.js` now calls Gemini through Firebase AI Logic with
`InferenceMode.PREFER_ON_DEVICE` (Gemini Nano when available, `gemini-3.5-flash-lite` in the cloud),
or `ONLY_ON_DEVICE` when "Local only" is on. Failures and timeouts produce errors; normal
operation never falls back to the mock engine. Incomplete or malformed answers are errors too.

**App Check is enforced on the project, so one step is needed:** open the Debait popup. It shows an
App Check debug token with a Copy button. Add that token in Firebase console → App Check → Apps →
(the web app) → Manage debug tokens. After that, Gemini answers and the popup chip says
"On-device AI" or "Cloud AI".

## Priority 1 failure and privacy checks

Run `npm test` for automated engine, background-message/cache, and voice-lifecycle tests.
These use controlled Firebase/Chrome substitutes, not paid requests or a downloaded Nano model.

Normal extension builds use Firebase. An intentionally simulated extension build requires BOTH:

```bash
VITE_DEBAIT_ENGINE=mock npm run build -- --mode demo
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
