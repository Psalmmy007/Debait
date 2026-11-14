# Debait engine: handoff for the Firebase side

The UI is done against a **mock engine**. Your job is to replace it with Firebase AI Logic.
You only touch `src/engine/`. Nothing in the UI changes.

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
