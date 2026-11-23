# Debait

**Nutrition facts for your feed.** Debait is a Chrome Manifest V3 extension that identifies Rage, Fear, Envy and Clean headline framing, shows exact wording evidence, offers conservative neutral alternatives, and explains difficult headlines in plain English. It is not a fact-check.

## Release candidate — review required

Work branch: `release/hackathon-final-integration`. **PARTIAL readiness:** automated checks pass, but production cloud authentication and fresh real-hardware hybrid verification remain blockers. Voice is deliberately disabled. The owner's hackathon deadline is November 30, 2026; current official rules could not be retrieved here.

Start with the [judge installation/testing guide](docs/release/JUDGE_TESTING_GUIDE.md), [integration report](docs/release/INTEGRATION_REPORT.md), [hybrid evidence](docs/release/HYBRID_VERIFICATION.md), [submission checklist](docs/release/SUBMISSION_CHECKLIST.md) and [internal scorecard](docs/release/FINAL_SCORECARD.md).

## Experience

- Floating orb: scan/apply accepted alternatives, restore originals, double-click settings; draggable/resizable with persisted positioning.
- Headline tags/cards: category, score, exact evidence, source, original versus suggested wording. No safe alternative means no rewrite action or rewrite count.
- Explain Simply: separate headline-only explanation, general definitions and missing-context notice; original stays unchanged.
- Auto-Debait is off by default and opt-in. Only validated safe edits apply; restoration remains available.
- Popup and nutrition-label Weekly Mind Facts distinguish real versus sample statistics and avoid invented dominant emotions. Safe share images are not fact-checks.
- Curiosity Gap and Uncertain are educational/future concepts, not live model categories.

## AI, security and privacy

The engine uses Firebase AI Logic for both device and cloud inference. Available Nano gets a 10-second hybrid attempt; slow/unavailable local inference can fall back to one authenticated cloud request when allowed. Local Only uses only the device path, with a longer local budget and honest errors on unsupported/slow hardware. Source labels require actual SDK response metadata, not model availability or generated JSON. Normal operation never substitutes mocks or heuristics.

Local Only blocks cloud inference/voice and cloud cached-result exposure. Switching privacy mode cancels pending work and closes the old offscreen context. The extension processes headline text; page summarization/article-body collection was not imported. Headlines/results are cached locally, and daily category/site statistics persist locally; these are browsing-related data, not anonymous merely because local. Evaluation datasets/results remain in memory and are separate from browsing caches/statistics. Shared quota scheduling stores scalar budgets. Do not upload private browsing content for testing.

Cloud authentication retains Firebase App Check enforcement. Explicit unpacked development builds can use privately registered installation tokens; production rejects debug auth and currently has no trusted token issuer. Never bundle private tokens or service-account keys. See [Firebase security setup](docs/FIREBASE_AUTH.md). Existing public Firebase web configuration is not an App Check credential. No secondary-project fallback is used.

## Build and install

Use Node.js 24.12+ (24.22.1 tested here) and current eligible desktop Chrome. Nano needs compatible hardware/model availability, not simply any Chrome installation; see the judge guide and current official Chrome requirements. No cloud VM/hardware success is claimed.

```bash
npm ci
npm test
VITE_DEBAIT_APP_CHECK=debug npm run build:dev
```

Load `dist` unpacked through `chrome://extensions`. The project owner must privately register that installation's debug token for cloud development testing. After rebuilding, reload the extension and refresh the news tab. Production uses `npm run build` and deliberately fails closed for cloud without a reviewed trusted issuer. Local Only on eligible hardware does not require cloud authentication. Do not distribute a debug-token-bearing profile as a public build.

```bash
npm run build
node scripts/check-release-build.js
node scripts/check-evaluation-build.js production
node scripts/check-voice-build.js
npm run build:web
npm run build:demo
```

The web prototype remains separate and unchanged. `build:demo` alone does not silently select mock AI; explicit demo engine selection is required. `npm run demo` serves a synthetic feed; `?preview` and `demo/pages.html` use **controlled UI fixtures**, not live Gemini evidence. Evaluation Lab is available only in development builds.

Browser regression scripts require externally installed Playwright/Chromium; they are not runtime extension dependencies. `scripts/check-core-experience.cjs`, `check-ui-completion.cjs`, `check-built-layout.cjs` and `check-voice-integration.cjs` use controlled fixtures/synthetic audio. `check-native-extension.cjs` attempts genuine extension loading and reports blocking policy honestly.

## Architecture and evidence

`src/content` → `src/background` (privacy/cache/quota/statistics) → `src/offscreen` → `src/engine` → Firebase AI Logic → device/cloud. [Engine details](docs/ENGINE.md).

Existing tests cover factual preservation, privacy, source validation, cache compatibility, statistics, evaluation isolation, UI and experimental voice lifecycle. Passing fixtures do not prove semantic accuracy or real model execution. The partner reported one warm Nano headline on an earlier branch at about 88 seconds; this release must be retested. Public release and eligibility are not certified.

## License and contributions

[Apache 2.0](LICENSE). Release work preserves the repaired foundation and Chisom's UI/personalization/sharing contributions; Nano timing and cancellation improvements adapt his validation branch. Source commits and exclusions are recorded in the integration report. No source development history was overwritten.
