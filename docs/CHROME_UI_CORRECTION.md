# Chrome popup and Explain Simply correction

Branch: feature/ui-completion. Starting local and fetched remote commit:
18e41b0f24322accde33ef890cd9e364d2c965fa. No branch merge was performed.

## What the recording establishes

The supplied recording shows a Clean BBC Travel headline, "Queer Eye's chef on his
favourite meals from around the world", a silver/neutral orb, and a failed Explain
Simply request. The visible failure text matches the existing
`debait/invalid-assistance` mapping, not the separate App Check/auth/quota messages.
This establishes that the application reported a response-validation rejection.
It does not disclose the actual response, which field/guard rejected it, whether a
semantic guard was too conservative, or prove that every upstream step was healthy.
No live Gemini requests were made in this correction. No successful real explanation
or new authentication/Nano verification is claimed.

## Popup measurement and correction

Before modification, Chromium measurements at zoom 1 and DPR 1 were:

| Starting viewport | Root width | Body width | Computed body maximum |
| --- | --- | --- | --- |
| 200 | 200 | 200 | 200px |
| 348 | 348 | 348 | 348px |
| 380 | 380 | 348 | 380px |

The CSS `width: 348px` was capped by `max-width: 100vw`. At a small starting
viewport, nothing in the root established a larger intrinsic preferred width.
This reproduces the self-clamping CSS defect seen in the user's narrow screenshot.
Native toolbar auto-sizing cannot be measured here, so the platform negotiation
and the user's zoom/display scaling are not independently verified causes.
There is no action popup size setting or alternate popup document in the manifest.
The generated manifest points at src/popup/index.html. The added built-layout
regression inspects the generated document and assets after correction, rather
than relying only on a standalone source preview.

Correction: html has width/min-width 380px and overflow hidden. Body uses 100%
width without a viewport-relative maximum, max-height 600px and its own vertical
scroll area. This gives Chrome an explicit preferred document width while avoiding
root-scrollbar-induced horizontal overflow. It preserves the original design.
At both starting widths 200 and 380, corrected built HTML measures root/body 380px.
With a 15px scrollbar, body clientWidth and scrollWidth both measure 365px: no
horizontal overflow within the intended popup. A deliberately undersized ordinary
browser tab can crop this preferred width; it is not a toolbar auto-size simulation.
Do not restore viewport-width constraints as a workaround for that preview case.
Unavailable percentages now hide the percent sign instead of displaying an apparent
percentage without a valid denominator.

## Headline card

The Clean message was rendered in a two-column trigger/evidence grid. In the video
its text wrapped into only the first column, leaving unnecessary blank space.
A Clean assessment now uses a full-width block with 14px/1.5 text; result explanations
use 15px/1.55 and assistance statuses 13px/1.5. Empty status paragraphs have no margin.
Typeface, colors, materials/blur, rounded geometry, usable tilt and animations remain.
Existing original/suggested wording, guards, apply/restore, viewport containment,
keyboard focus and reduced-motion behavior are preserved.

## Explain Simply trace and change

Card onAssist -> content requestAssistance -> MSG.ASSIST -> worker assistText ->
shared requestGate (unless Local Only) -> toEngine/ensureOffscreen -> offscreen
engine.assistHeadline -> runtime timeout/source checks -> Firebase SDK-backed
createHeadlineEngine -> assistancePrompt + explicit schema -> generateContent ->
actual SDK inferenceSource -> JSON parse -> normalizeAssistance. Checked results
are revalidated by runtime and worker and checked against privacy revisions before
content displays them. No headline DOM mutation, statistics, browsing cache or
evaluation record is produced by explanations.

The previous generic rejection hid whether the response had missing fields, changed
protected details, or failed another safety check; telling users merely to retry
later did not explain a validation rejection. It is now separated into fixed reason
codes: format, source, verification, numbers, claims, details, definition. These cross
offscreen/worker/content boundaries. Only known enum values are serialized; no raw
model output, headline, credential or provider payload is added to diagnostics.
Claims/details messages say preservation could not be established, not that semantic
incorrectness has been proven. JSON SyntaxError for assistance becomes a format
failure, not an unspecified inference failure. Timeouts and temporary service
unavailability have distinct safe messages. Structured authentication and rate-limit
errors retain priority over generic timeout wording, preserving quota handling.
No new retries, model calls, timeout changes, credentials or acceptance-rule relaxation
were added. The classification prompt and semantic rewrite policy are unchanged.

A faithful controlled explanation for the exact BBC headline passes existing checks.
That is a deterministic test of the validator and SDK adapter, not evidence of what
Gemini returned during the user's recording. The exact live rejection remains unknown.
On the next live failure, record only its Reference code and task/source/setup details;
do not send debug tokens or browsing/model payloads.

## Orb and Weekly Mind Facts

An all-Clean page intentionally produces silver/neutral feedback, as the recording
shows. Existing real-result source filtering, deterministic majority, neutral ties,
loading/error/unavailable and Local Only behavior are unchanged. Controlled tests
exercise all ten visual states; core browser fixtures also exercise content events,
rewrites/restoration/dynamic updates and privacy invalidation. No new live states.

The popup and side panel are separate manifest entries. The popup opens Weekly Mind
Facts through chrome.sidePanel.open; content settings route through the worker.
The built side-panel document was checked at widths 320, 380 and 600, light and dark:
no horizontal overflow, real/sample switches, education and guide render correctly.
No sidebar CSS or statistics renderer/calculation was changed. Native side-panel
opening/docking and actual reading data still require the manual check below.

## Evidence and validation

- npm test: 352 passed, zero failed (345 prior + 7 focused regressions).
- Core browser script: passed controlled manual/page/restore, unsafe rewrite,
  explanation/cooldown, auto/dynamic, nested links, disabled sites and Local Only tests.
- Stage 2 script: 100 controlled assertions, zero failed; 36 screenshots, both themes,
  including the exact BBC Clean headline card and explanation presentation.
- check-built-layout.cjs: 30 assertions, zero failed, actual built assets with controlled
  Chrome APIs, four screenshots and JSON measurements. This is not a loaded extension.
- check-native-extension.cjs: attempted; BLOCKED (exit 2), not passed. Managed Chromium
  has ExtensionInstallBlocklist ["*"] and did not load Debait. A Chrome-for-Testing
  download was denied with HTTP 403 "Domain forbidden". No policy was changed/bypassed.
  The script supports real extension-document and native-toolbar checks on permitted
  Chrome installations, reports toolbar support separately and never fabricates AI.
- Development, production, web and demo builds passed. Evaluation build checks passed
  after each corresponding extension build, development -> production without manual
  cleaning, preserving development-only tool exclusion.

Optional reproduction (Playwright/Chromium required; not application dependencies):

    npm ci
    VITE_DEBAIT_APP_CHECK=debug npm run build:dev
    DEBAIT_LAYOUT_ARTIFACT_DIR="$PWD/ui-layout-review" node scripts/check-built-layout.cjs
    DEBAIT_UI_ARTIFACT_DIR="$PWD/ui-component-review" node scripts/check-ui-completion.cjs
    DEBAIT_NATIVE_ARTIFACT_DIR="$PWD/ui-native-review" node scripts/check-native-extension.cjs

Keep generated review folders uncommitted. Set CHROMIUM_EXECUTABLE_PATH if necessary.
Use DEBAIT_HEADED=1 for the native script when a graphical display is available.
A loaded extension URL in a browser tab is not proof of native toolbar auto-sizing;
the native script reports these separately. Screenshot artifacts explicitly distinguish
controlled document/component previews from any genuinely loaded extension captures.

## Required manual Chrome retest

1. Fetch/pull feature/ui-completion. Run npm ci and the debug development build above.
2. In chrome://extensions reload the existing unpacked dist (or load it). Refresh BBC
   tabs so old content scripts are replaced. Do not change Firebase enforcement/tokens.
3. Open the actual toolbar popup on bbc.com/travel. Confirm comfortable width and
   full four-category row, readable switches, and vertical-only scrolling. Test at
   normal zoom, then the user's normal display scale. Right-click inside the popup,
   Inspect, and evaluate the following in that popup's DevTools context:

       ({ viewport: innerWidth, root: document.documentElement.getBoundingClientRect().width,
          body: document.body.getBoundingClientRect().width,
          client: document.body.clientWidth, scroll: document.body.scrollWidth,
          dpr: devicePixelRatio, zoom: getComputedStyle(document.body).zoom })

   Expected preferred root/body: 380 CSS px; scroll must not exceed client. Save the
   measurement and screenshot if Chrome still constrains it. Do not run this on BBC's
   page context and confuse its viewport with the extension popup.
4. Open the same Clean headline. The full-width assessment should not have an empty
   evidence column. Try Explain Simply. Successful responses must show real source,
   definitions/context/disclaimer and leave the page headline unchanged. On rejection,
   note the fixed Reference code. Genuine Gemini success remains to be verified.
5. Check a safe rewrite and restoration, Auto-Debait opt-in and dynamic headlines.
6. Open Weekly Mind Facts from the toolbar, confirm it docks as a side panel, resize
   it, switch sample/real and check education/guide. Sample data must remain honest.
7. Repeat in light/dark, keyboard/Escape, reduced motion and Local Only. If Nano is
   unavailable, Local Only must report it without cloud inference or fake results.

No merging, release, publishing, alternate Firebase configuration or new permissions.
