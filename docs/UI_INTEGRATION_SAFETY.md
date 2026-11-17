# Functional statistics repair and later UI integration

Inspected remote tips: `repair/priority2-firebase-auth` at `5753ef3` and
`feature/ui-scaffold` at `b41207e`. Their last common UI commit is `8a0b3ae`.
No branches were merged. The UI branch is not a replacement for the repaired AI
branch: its older inference/authentication code predates our safety repairs.

## Functional changes in this repair

- Sample mode changes the existing badge to **Sample data**, uses a sample-specific
  footnote, and gives no advice based on the made-up statistics. The existing
  warning and sample-week button remain. Returning to real mode restores real
  data/text. Sample data is never saved.
- All-Clean periods explicitly say all analyzed headlines were classified Clean.
  Empty periods give a neutral message. Mixed periods use actual category counts
  over all analyzed headlines, describe the most common *flagged* category, and
  name ties rather than inventing a single winner.
- Incomplete/inconsistent category counts produce unavailable percentages and a
  neutral message. Counts must be nonnegative integers and add up to the analyzed
  total before weekly percentages/recommendations are trusted. Valid day-level
  rates can still appear; invalid days have no rate. Zero-denominator percentages
  are unavailable. No stored data is altered or retrospectively reclassified.
- Source totals do not identify which category a source contributed. Recommendations
  therefore no longer claim that particular sites supplied most of a given emotion.
- A newer render selection wins over delayed reads so sample/real modes cannot mix.

This changes presentation calculations and text only: no CSS, animations, layouts,
HTML structure, classifier categories/prompts, Firebase credentials, privacy settings,
quota policy, normal cache rules or stored statistics schema were changed.

## Proposed integration sequence (not performed)

1. Review visual commit `b41207e` separately from the rebuild commit and `ad2` assets.
   The eight coordinated CSS files are:
   `src/content/styles/{card,orb,panel,tag,tokens}.css`, `src/shared/tokens.css`,
   `src/popup/popup.css`, and `src/sidepanel/sidepanel.css`.
   Review them as a set: component styles depend on shared variables and compatibility
   aliases, including label/material/font tokens. Preserve the functional side-panel
   JavaScript and `statistics.js`; do not overwrite them with an older branch snapshot.
2. Include the single settings-legend markup change only with its corresponding CSS:
   `src/content/ui/settings.js` replaces inline background styles with `data-k`
   attributes used by the new `src/content/styles/panel.css` selectors. No settings
   persistence, Local Only, source-status or AI messaging logic should be replaced.
3. Resolve `package.json` and `vite.config.js` together. A read-only three-way text
   comparison found conflicts in both. Keep the test, dev/demo/prod/web commands,
   quota configuration validation, public build provenance and the development-only
   evaluation entry. Do not replace the mode-aware repair configuration wholesale.
4. Keep `scripts/stamp.js` while repair build scripts call it. The UI branch deletes
   it and moves stamping into a Vite plugin. A later reviewed conversion must update
   every caller and the service-worker stamp format atomically.
5. Review only the rebuild block in `src/background/sw.js`. It combines textually
   cleanly in the inspected three-way comparison, but changes the expected build.json
   shape and introduces `__DEBAIT_BUILD__`. Preserve evaluation sender restrictions,
   the shared quota gate, cache/privacy revision checks, statistics exclusion and voice
   privacy. Do not restore the UI branch's older whole service worker or engine files.
6. Keep clean production/demo output. The UI branch's `emptyOutDir: false` can retain
   the developer evaluation page after a development-to-production build. Do not adopt
   it unchanged. The repair branch retains `emptyOutDir: true`; preserve that boundary
   until an explicitly reviewed alternative passes isolation checks. The UI build ID
   is computed at config load, so repeat watch-build fingerprint behavior also needs
   testing before adopting that reload mechanism.
7. Advertising files (`ad2/*`) are a separate presentation workstream and need not be
   included in the extension's functional integration.

## Required checks after any later integration

- Run `npm test`, including real/sample transitions, all-Clean/empty/mixed/tied/invalid
  statistics and delayed-response tests. The privacy, cache, no-mock, App Check,
  inference-source, semantic-rewrite and evaluation-isolation regressions must pass.
- Run `VITE_DEBAIT_APP_CHECK=debug npm run build:dev`, then
  `node scripts/check-evaluation-build.js development`.
- Without manually cleaning dist, run `npm run build` and
  `node scripts/check-evaluation-build.js production` to detect leftover dev artifacts.
- Run `npm run build:web`, then `npm run build:demo` and
  `node scripts/check-evaluation-build.js demo`.
- In Chrome, reload the extension and refresh existing tabs. Confirm side-panel real
  data, sample labeling and restoration; test light/dark styles and keyboard behavior.
  Preserve automatic rewriting OFF by default. Verify actual source reporting and
  Local Only on an authorized device without changing credentials or enforcement.

Automated tests use controlled inputs/responses, not live Gemini evaluation. This
repair does not newly verify real cloud authentication or on-device inference.
Inconsistent stored category data is displayed conservatively, not repaired or reset.
The separate category guide and visual polish remain the UI developer's work.
