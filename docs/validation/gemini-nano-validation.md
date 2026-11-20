# Debait: Gemini Nano and hybrid inference validation

Date: 2026-11-19 · Branch tested: `feature/ui-scaffold` @ `8e9fb8e` · Report branch: `test/gemini-nano-validation` (no app code changed)

Everything below was observed during testing. Where something could not be verified, this report says so.

## A. Hardware eligibility

| Item | This machine | Google's requirement (developer.chrome.com/docs/ai/get-started) | Meets it? |
|---|---|---|---|
| OS | Windows 11 Pro 10.0.26200, 64-bit | Windows 10 or 11 | Yes |
| CPU | AMD A8-7410 APU, 4 cores / 4 threads | CPU path: 4+ cores | Yes |
| RAM | 16 GB installed. Windows reports 14.9 GB usable (the APU reserves the rest); Chrome reports `navigator.deviceMemory = 16` | CPU path: 16 GB+ | Borderline |
| GPU | AMD Radeon R5 (integrated), 1 GB dedicated. Chrome's `Local State` records `vram_mb = 7653` (shared memory counted) | GPU path: more than 4 GB VRAM | Only because shared memory is counted |
| Disk | 273 GB free on C: | 22 GB free | Yes |
| Chrome | 150.0.7871.187, no `chrome://flags` overrides | — | — |
| Model on disk | `OptGuideOnDeviceModel\2025.8.21.1028`, 3.98 GB, downloaded 2026-11-15 | — | Present |
| Chrome's own rating | `optimization_guide.on_device.performance_class = 2` (very low tier), `model_crash_count = 0` | — | Eligible, very low tier |

**Conclusion:** Chrome treats this laptop as eligible, and Gemini Nano is installed and runs. It is at the bottom of the supported range, though, and that dominates every result below.

## B. Chrome Prompt API (raw, outside Debait)

Test: in a normal `https://example.com` tab in Chrome, call `LanguageModel.availability({expectedInputs:[en], expectedOutputs:[en]})`.
- Result: **`"available"`**.
- Each headline was then sent with Debait's exact prompt and JSON schema (`responseConstraint`), one at a time.

| # | Headline | Expected | Nano result | Time |
|---|---|---|---|---|
| 1 | These corrupt officials are laughing at YOU while stealing your money! | rage | **rage 90**, trigger "YOU". Rewrite: "Officials are accused of misappropriating funds, and citizens may be affected." | 244.6 s (first prompt, cold) |
| 2 | YOUR family could be next — act NOW before it's too late! | fear | **fear 85**, trigger "next". Rewrite: "Certain conditions may increase the risk of a specific health issue. Further research is ongoing." (**invented a health topic**) | 114.0 s |
| 3 | Everyone your age is getting rich except you! | envy | **envy 75**, triggers "rich", "everyone". Rewrite: "Younger generations show higher levels of financial success compared to older generations." (changes the claim) | 107.9 s |
| 4 | City council approves a new transport budget. | clean | **clean 10**, no triggers. Rewrite: "City council allocates new funding for transportation initiatives." (it should have repeated the headline unchanged) | 71.2 s |
| 5 | 'I was terrified during the storm,' survivor says. | clean (legitimate reporting) | Try 1: **failed**, `UnknownError: kErrorUnknown` after 42.5 s. Try 2 (new session): **fear 60**, trigger "terrified", 230.9 s. Try 3 (same session, warm): **fear 60**, 111.5 s | — |

- **Session creation:** 6.1 s on first use and 7.9 s later. Session creation is not where the time goes.
- **Response format:** every successful answer was valid JSON matching the schema. 6 of 7 prompts succeeded; 1 failed with `kErrorUnknown`.
- **Classification:** correct for 4 of 5 headlines. Nano mislabels quoted emotion in legitimate reporting (#5), and it did so both times.
- **Rewrites:** weak. They sometimes add facts (#2) or change the claim (#3), which breaks Debait's own "never add facts" rule.
- **Explanations:** short and understandable, but sometimes they name a minor word (#2 flags "next" and skips "act NOW").
- **5-headline batch:** started but stopped after about 2 minutes, before it finished, to keep the machine usable. Debait sends up to 8 headlines per request, so a real batch would take longer than any single result above.

## C. Firebase AI Logic integration

- **Code path (read, `@firebase/ai` 3.1.0, `callCloudOrDevice`):**
  - `ONLY_ON_DEVICE` only ever calls the on-device model and **throws** if it's unavailable. There is no cloud branch.
  - `PREFER_ON_DEVICE` uses the device whenever availability is `available`, and goes to the cloud only when it isn't. **It does not fall back to the cloud if the on-device call is slow or fails.**
- **Debait's own engine on Nano:**
  - I loaded `src/engine/firebaseEngine.js` unmodified into a local test page (Vite, `localhost`) and opened it in Chrome.
  - `getStatus({localOnly:true})` returned `source: on-device · "Gemini Nano, on this device"`.
  - `scoreHeadlines([headline 1], {localOnly:true})` **ran for more than 28 minutes and never returned**, while Chrome's `OnDeviceModelService` process used 100% CPU and 2.5–3.5 GB of memory.
  - Chrome then exited, so the run did not finish.
  - **A successful on-device result through Firebase AI Logic was not obtained on this machine.** The likely cause is in section G, issue 2.
- **Network (that test page, captured with the browser's network log):**
  - Logging was active from page load, but the log was read only once, a few seconds after the run started. Chrome disconnected before it could be read again.
  - Requests seen up to then: the page, Vite modules, the Firebase SDK bundles, and one request from the installed Debait extension.
  - **No request to `firebasevertexai.googleapis.com` and no App Check request** had been made by then.
  - This does not prove that no request happened later in the run.

## D. Debait behaviour in Chrome (the installed extension, Nano available)

Test page: `example.com`, with the 5 headlines inserted as `<h2>` links.

**Hybrid mode (Local only off, the default):**
- After 30 s, **every headline was a "Quick estimate"** (Debait's backup heuristic), and each tag said so in its tooltip.
- Neither Nano nor cloud Gemini answered:
  - Debait picked Nano because it reported `available`.
  - Nano needs minutes, and Debait gives up after 25 s.
  - The SDK never tries the cloud in that case.
- The quick estimates were poor:
  - "corrupt officials" came out **Clean**.
  - "YOUR family…" came out **Rage 59**.
- **The status chip said "Gemini Nano · on device" at the same time** (screenshot `hybrid-nano-available-status-chip.png`). That is not truthful: no headline was scored by Nano.
- One click on the orb ("Debait this page") **rewrote the quick-estimate headline anyway**. "YOUR family could be next — act NOW" became "Your family could be next— act Now", which is a case change, not a real rewrite.
- The panel counted "0 bait headlines, 1 debaited".

**Local only on:**
- Tags showed "Reading", then hid after about 30 s.
- The orb said **"Debait is paused · Debait could not reach its AI. Retrying in a minute."** (screenshot `local-only-honest-failure.png`).
- **No made-up result was shown as a local result. Good.**
- The wording is misleading: nothing was being "reached"; Nano timed out on this device.
- **Not observed:** the extension's offscreen engine page can't be inspected from Claude in Chrome, so its network traffic in Chrome was not captured. The no-cloud guarantee for Local Only rests on the SDK code path in section C and the Edge capture below.

**Model unavailable** (headless Edge with Debait loaded; Edge exposes no `LanguageModel` to the engine page):

| Mode | Result | Source label | Engine-page network (CDP) |
|---|---|---|---|
| Hybrid | rage 95, fear 90, envy 90, clean, **clean** (all 5 correct, including #5) in under 30 s | "Gemini · cloud" on every tag | Each request was preceded by an App Check exchange to `content-firebaseappcheck.googleapis.com` (54-byte body, no headline). The first two Vertex calls (team project, then backup) carried only a warm-up headline. Then **2 identical `firebasevertexai` requests carried the test headlines** (the deliberate duplicate for slow responses). |
| Local only | Tags hidden after 4.3 s. Orb: "Local only is on, but Gemini Nano is not downloaded yet…" | none shown | Not captured: the engine page wasn't found within the harness's 10 s window. In code, Debait throws before any Firebase call when availability isn't `available` (`src/engine/index.js:24-27`). The message says "not downloaded" even though this browser can't run Nano at all. |

## E. Hybrid behaviour summary

| Question | Answer |
|---|---|
| Prefers local when the model is ready? | **Yes.** The SDK uses Nano whenever availability is `available`, however slow it is. |
| Uses the cloud when permitted and necessary? | **Only when Nano is unavailable** (Edge test: cloud worked). When Nano is available but too slow (this laptop), it **never falls back to the cloud**; it shows Quick estimates instead. |
| UI truthfully names the model? | Per-headline tags: **yes** (each tag says "Quick estimate", "Gemini · cloud" or "Gemini Nano · on device"). Status chip: **no**; it says "Gemini Nano · on device" from availability alone, even when every result is a Quick estimate. |
| Fallback follows the settings? | Local only never showed cloud or mock results. Hybrid falls back to mock, not cloud, when Nano is slow. |
| Local only prevents cloud fallback? | **Yes**, by the SDK code path, and no cloud request was seen in the part of the Local Only page test that was captured. Debait's cache is keyed by headline text only, so a headline scored by the cloud earlier would be shown, labelled "cloud", under Local only. That is not a new cloud call. |

**Two genuinely working inference paths, end to end in Debait:**
- **Cloud: demonstrated.**
- **On-device through Debait: not demonstrated on this hardware.** Nano itself works through the raw Prompt API (section B), but Debait's 25–30 s limits and request pile-up stop it from producing a result.

## F. Performance (measured)

| Measurement | Value |
|---|---|
| `LanguageModel.create()`, first use | 6.1 s |
| `LanguageModel.create()`, later | 7.9 s |
| One headline, first prompt (cold) | 244.6 s |
| One headline, later prompts (warm) | 71–114 s (4 samples: 71.2, 107.9, 111.5, 114.0) |
| One headline, new session after other prompts | 230.9 s |
| Failure rate | 1 of 7 prompts (`kErrorUnknown`) |
| Model service memory | about 1.4 GB early, 2.5–3.5 GB later |
| CPU | 100% total load during inference; Chrome stopped responding to automation and then exited during the long Debait-engine run |
| Cloud (Edge, hybrid), 5 headlines | all scored within 30 s of insertion (not timed more finely) |

No large batches were run on purpose.

## G. Problems found (reproducible) and minimal fixes

1. **Hybrid never reaches the cloud when Nano is available but slow.**
   - Where: `src/engine/firebaseEngine.js:232-244` (`PREFER_ON_DEVICE`) and `src/engine/index.js:33` (20/25 s limit, then mock).
   - Reproduce: Chrome on a "very low" Nano device with Local only off. Every headline becomes a Quick estimate.
   - Fix: in hybrid mode, if the on-device call hasn't answered within about 8 s, cancel it and run the same request with `InferenceMode.ONLY_IN_CLOUD`. Optionally, remember for the session that this device is slow and go straight to the cloud.

2. **Timed-out on-device calls are never cancelled, so they pile up.**
   - Where: `src/engine/index.js:19` (`withTimeout` only stops waiting), plus `PARALLEL = 3` and the 1-minute Local-only retry in `src/content/main.js`.
   - Observed: Debait's engine waited more than 28 min for one headline with the model service at 100% CPU, after which Chrome exited.
   - Fix: pass an `AbortSignal` that `withTimeout` aborts (the SDK already takes `{ signal }`). On device, score one batch at a time.

3. **The Local only time limit (30 s) is below what eligible hardware needs.**
   - Where: `src/engine/index.js:28`.
   - Fix: scale the limit for on-device use (for example 180 s, or set from a timed first prompt), and show "Gemini Nano is working…" instead of "paused".

4. **The status chip claims Nano when nothing was scored by Nano.**
   - Where: `src/engine/index.js:45-57`, `src/engine/firebaseEngine.js:384-389`.
   - Fix: base the chip on the source of the last real result (or on a running failure state) rather than on `availability()` alone.

5. **Failure messages don't say what happened.**
   - Where: `src/content/main.js:317-319` and `src/engine/index.js:27`.
   - "could not reach its AI" is shown for an on-device timeout; "not downloaded yet" is shown when the device can't run Nano at all.
   - Fix: carry a reason code (`timeout`, `unavailable`, `downloadable`) and show matching text.

6. **A quick-estimate result can be debaited by a manual click.**
   - Where: the `toggleDebaitPage` path in `src/content/main.js`. Auto-debait already skips mock results at line 383.
   - Fix: skip `source === 'mock'` in the manual path too, or label the result as an estimate.

7. **Nano's output quality.**
   - Quoted emotion in real reporting is called "fear".
   - Rewrites add or change facts.
   - Fix (prompt only): add an example such as "'I was terrified,' survivor says -> clean (quoted feelings are reporting, not bait)". For on-device rewrites, prefer deleting the bait words over rewriting the whole headline.

8. **Minor:** the score cache in `src/background/sw.js:206-222` ignores which model produced a result, so cloud results show under Local only (labelled "cloud").

**Fixes 1–3 are applied on this branch (`test/gemini-nano-validation`).** See "Fixes 1–3: what changed and how they were tested" below. Issues 4–8 are not fixed. Merging needs the owner of `repair/priority2-firebase-auth` to agree, since the fixes touch the Firebase engine.

## H. Evidence

- `hybrid-nano-available-status-chip.png`: hybrid mode with Nano available. The chip says "Gemini Nano · on device" while the tags are Quick estimates (tooltips captured as text in section D).
- `local-only-honest-failure.png`: Local only, honest paused state, no made-up results.
- No tokens, keys or personal data appear in either image.
- **Not captured:** a screenshot of a successful on-device Debait tag. That did not happen on this hardware (see C and G).
- Raw Prompt API outputs for section B are reproduced verbatim above.

## Test environment notes

- Tests in Chrome used the person's normal Chrome with Debait installed unpacked from `dist/`, driven by Claude in Chrome. No App Check token was entered or exposed.
- Debait's **Local only setting was left ON** in that Chrome profile, because Chrome exited before it could be switched back. **Turn it off in Debait's settings.**
- Cloud and "model unavailable" tests used a throwaway headless Edge profile (`%TEMP%\dbt\nanoval.mjs`).
- `.claude/launch.json` was edited temporarily for the local test page and reverted afterwards.

## Fixes 1–3: what changed and how they were tested

Changed files: `src/engine/firebaseEngine.js`, `src/engine/index.js`, plus message text only in `src/content/main.js` and `src/content/ui/settings.js`. Nothing visual changed.

1. **Hybrid falls back to the cloud when Nano is slow.**
   - Hybrid no longer uses `PREFER_ON_DEVICE`.
   - When Nano is `available`, Debait asks it first (`ONLY_ON_DEVICE`) with a **10 s budget**.
   - If Nano misses the budget or fails, the request is cancelled and sent to the cloud (`ONLY_IN_CLOUD`, same project race and duplicate-on-slow logic as before).
   - Nano is then skipped for 10 minutes, so later requests go straight to the cloud.
   - The status chip now says "Gemini in the cloud: Gemini Nano is too slow on this computer" during that time instead of claiming Nano.
2. **Timed-out requests are really cancelled, and Nano runs one request at a time.**
   - `withTimeout` in `index.js` now aborts an `AbortController` instead of only stopping waiting.
   - The SDK doesn't forward `signal` to Chrome on device (`ChromeAdapterImpl.generateContent` calls `session.prompt(contents, promptOptions)`), so the signal is put in `onDeviceParams.promptOptions`. That goes straight to Chrome's `prompt()` / `promptStreaming()`.
   - A small lock lets only one Nano request run at a time. Parallel batches wait their turn instead of competing inside Chrome.
3. **Local only allows for slow hardware.**
   - Each Nano request gets **150 s** once its turn starts, inside an overall **4 min** limit (was 30 s). That stays under the 5-minute limit on extension service-worker events.
   - Failures are reported as `LOCAL_ONLY_SLOW` / `LOCAL_ONLY_FAILED`. The orb shows "Local only is on, and Gemini Nano did not finish on this computer. Retrying in a minute, or turn off Local only to use Gemini in the cloud."
   - The old "not downloaded yet" message is kept only for a Nano that isn't available.
   - Summaries follow the same rules: Nano must start writing within its budget, and once it starts it may finish.

**Test method:**
- Headless Edge, a throwaway profile, the rebuilt `dist/`, and the same five headlines (`%TEMP%\dbt\nanofake.mjs`).
- Chrome's `LanguageModel` was replaced in Debait's engine page with a stand-in. It answers in valid Debait JSON after a set delay unless cancelled, and it counts prompts, overlap and cancellations.
- The engine page's network was logged with CDP.
- This tests Debait's timing, cancellation and routing. It does **not** test real Gemini Nano. Re-test in Chrome on real hardware before relying on it.

| Scenario | Result |
|---|---|
| Hybrid, Nano takes 60 s | Nano tried once, **cancelled after 10 s** (aborted 1, finished 0). Cloud answered all 5 correctly (rage, fear, envy, clean, clean), each labelled "Gemini · cloud", about 16 s after the headlines appeared. Never more than 1 Nano request at a time. Network: App Check plus 2 `firebasevertexai` requests (the duplicate-on-slow). |
| Local only, Nano takes 40 s (would have failed under the old 30 s limit) | All 5 shown as "Gemini Nano · on device" at 44.7 s. 1 prompt, 0 cancelled. **Network: no `firebasevertexai` request at all**, only 2 App Check token requests (Firebase start-up, no headline text). |
| Local only, Nano never answers | Tags hid at 154 s. The stuck request was **cancelled** at its 150 s budget (aborted 1, never more than 1 at a time), so nothing keeps the CPU busy in the background. Orb: "Local only is on, and Gemini Nano did not finish on this computer. Retrying in a minute, or turn off Local only to use Gemini in the cloud." No guessed results. **Network: no `firebasevertexai` request**, only 3 App Check token requests. |

**Still to do:**
- Re-test on real Gemini Nano in Chrome. It needs `dist/` rebuilt from this branch and Debait reloaded on `chrome://extensions`.
- On this laptop, real Nano took 71–245 s per single headline. A Local only batch of up to 8 headlines will often exceed 150 s and fail honestly instead of waiting forever.
- Hybrid will now switch to the cloud after 10 s.
