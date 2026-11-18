# Stage 2 UI completion

Foundation: `7ce673036738f15b8019789a0529401710644c19` on the repaired AI branch.
Visual reference: `9d2c0bdc3f2855c640ac536a0a1238bd5de15803` on the UI branch.
Implementation branch: `feature/ui-completion`. No branch merge was performed.
The two separately named original Stage 2 specification documents were unavailable;
the user's final implementation authorization is the requirements baseline.

## Preserved design and boundaries

The eight coordinated CSS files bring over the existing Apple-inspired typography,
category colors, light/dark tokens, translucent/blurred materials, rounded controls,
orb styling, gradients, shadows and purposeful transitions. The existing card tilt
remains for mouse/pen use and is suppressed for touch, reduced motion and
scrollable/near-full-height cards where rotation could clip readable controls.
The eyeless/faceless WebGL sphere and its shader geometry remain unchanged.
No new visual aesthetic, sharing, whole-page summary or voice routing is included.
No package, manifest, permission, Firebase, App Check, engine contract, classification
prompt, semantic policy, quota, cache, settings-storage schema or build configuration
was imported from the older UI branch. The original web prototype is untouched.
The repaired weekly calculations and sidepanel renderer are unchanged.

Effects changed only for concrete usability reasons:
- The old clipping comparison is replaced by readable Original headline and Suggested
  neutral wording. Existing repaired request/apply/restore/rejection checks remain.
- Reduced-motion preferences suppress continuous shader motion, drag bounce, CSS
  transitions/loops and popup count animation; category/status frames still update.
- Cards retain viewport-height containment and long-text wrapping. Trigger/evidence
  columns avoid squeezing a short trigger into broken fragments.
- A percentage and its percent sign stay together in the existing settings hero.
- Lengthy action results/errors use a live status paragraph rather than enlarging the
  popup's primary button. Sources are shown as reported, not inferred from availability.
- Nonmodal card/settings popovers receive focus and restore the opener when appropriate.
  They deliberately do not trap keyboard focus away from the underlying page.

## Orb behavior

Previously: idle/busy/bait/calm monochrome moods, drag/parallax and voice feedback.
Now: those behaviors remain, with a restrained category-token tint over the same sphere.
Rage = red, Fear = orange, Envy = violet, Clean = silver/calm. Only supported results
with actual cloud/on-device provenance count toward a primary category. Mock/unknown
sources and future categories cannot produce live category feedback. All still-visible,
unrewritten supported headline categories participate: a unique largest count wins;
any tie or no usable results is neutral. Rewritten headlines do not become classified
Clean: the existing calm/restoration state represents successful transformations.
Loading, failed analysis, invalidated extension context and disabled status take
precedence over a category tint. Disabled sites continue to mount no content UI.
Local Only excludes cloud results from orb feedback immediately. No inference or
privacy behavior is changed. This tint is a presentation summary, not a new AI result.

## UI contracts

- Popup: Debait this page / Restore originals, pageStatus live region, engineNote,
  validated Today’s Feed percentages and Emotional Ingredients counts, existing switches
  and Weekly Mind Facts navigation. Empty/inconsistent counts use an unavailable value.
  External settings/statistics changes refresh the display; stale status reads are ignored.
- Cards preserve `request-rewrite`, `debait`, `restore`, `explain`,
  `data-assistance-status`, `data-explanation`, `data-rewrite-source`.
  Explanations use the existing real worker/offscreen/Firebase pipeline and show
  definitions, missing context, provenance and not-a-fact-check wording separately.
- Auto-Debait remains opt-in; safe application/restoration behavior is unchanged.
  The transient autoApplied flag only labels how an existing transformation occurred;
  it is not persisted, counted differently or sent to the model.
- Know Your Ingredients uses native expandable details in popup, settings and weekly
  panel. Four current framing categories have definitions, icons and fictional examples.
  Curiosity Gap is explicitly a future framing category. Uncertain is explicitly a
  future abstention state, not an emotion or synonym for Curiosity Gap. Both say Not
  active even while collapsed, and never join live schemas/counts/caches/orb states.
- Understanding Your Feed explains denominators, limits of labels/scores and source
  rankings. It does not give advice from invented data. All prior real/sample, empty,
  all-Clean, mixed/tied/inconsistent weekly safeguards remain in the existing renderer.

## Validation and honest limits

`npm test`: 345 passed, zero failed (331 existing + 14 new UI state/guide tests).
`node scripts/check-core-experience.cjs`: passed existing controlled browser scenarios
for page/manual apply/restore, unsafe rewrite rejection, Clean explanation/cooldown,
automatic opt-in/manual restoration, recycled dynamic content, nested link preservation,
Local Only invalidation and disabled sites. Its popup assertion now reads pageStatus.
`node scripts/check-ui-completion.cjs`: 94 assertions, zero failed, light + dark,
34 authentic source-component screenshots. Covers popup controls/status/empty data,
real/sample weekly transitions and denominators, six guide entries, readable cards,
request/rejection/apply/restore/automatic/explanation/error states, focus restoration,
10 orb states, narrow viewports and reduced motion. All AI/engine/statistics fixtures
are explicitly controlled; no real Gemini, App Check or Nano verification is claimed.
The screenshot gallery is generated under `/tmp/debait-ui-completion/gallery.html`.
Set DEBAIT_UI_ARTIFACT_DIR to change the output directory. Playwright and Chromium
are environment prerequisites, not new application dependencies. CHROMIUM_EXECUTABLE_PATH
can select a different Chromium binary. Optional browser scripts are not npm unit tests.

Build commands: development (`VITE_DEBAIT_APP_CHECK=debug npm run build:dev`),
production (`npm run build`), web (`npm run build:web`), demo (`npm run build:demo`).
Run `node scripts/check-evaluation-build.js development|production|demo` after the
corresponding extension build. Specifically build development then production without
manual deletion to prove no evaluation artifacts remain. The safe repair build config
still cleans output; no new permissions or credentials are required.

Still manual: installed Chrome extension behavior on real supported news sites,
OS-specific font rendering, high zoom/screen-reader review and GPU-specific WebGL
appearance/performance. Fresh real Gemini responses and genuine Nano execution require
authorized runtime testing. Controlled tests cannot establish classification or semantic
accuracy, App Check success or genuine on-device inference. Suggested wording can still
be rejected and headlines are not fact-checked. Curiosity Gap and Uncertain stay inactive.

## Beginner review

1. Switch to feature/ui-completion and install dependencies with npm ci.
2. Run VITE_DEBAIT_APP_CHECK=debug npm run build:dev for the existing unpacked development
   setup. Do not share private App Check tokens. Keep enforcement enabled.
3. In chrome://extensions, use Load unpacked on dist, or reload the already loaded
   extension if it points to this same dist folder. Refresh existing news tabs too.
4. Start with Auto-Debait OFF. Inspect the popup, then a headline tag. Compare original
   and suggested wording, request neutral wording, apply only an available alternative,
   and use Show original to undo it. Rejections should leave the page unchanged.
5. Try Explain Simply on a technical headline; it should not alter the page headline.
6. Enable Auto-Debait explicitly and scroll for new headlines. Only accepted changes
   apply. A manually restored headline should stay restored.
7. Open Weekly Mind Facts: real data and sample data must be labeled differently.
   Expand Understanding Your Feed/Know Your Ingredients. Future entries say Not active.
8. Toggle the OS light/dark preference. Try keyboard Tab/Enter/Escape, a small window,
   zoom and the OS reduced-motion setting. Repeat under Local Only on eligible hardware;
   unavailable local AI must report an error rather than using cloud or fake results.
9. For no-credential design previews, npm run demo serves /?preview and /pages.html
   (?page=popup for popup). These are explicitly mock/demo surfaces, not real AI proof.
   For the complete controlled evidence, run the optional browser script above.
