## Problem and resulting behavior

The repaired foundation could stall on available but slow Nano, its outer timeout stopped waiting without cancelling work, and voice lacked verified secure Live authentication. This release candidate selectively adapts Chisom's Nano cancellation/timing ideas while preserving the repaired quality, privacy, authentication, statistics and UI architecture.

- Explicit Firebase device-first routing: bounded 10-second hybrid attempt then at most one authenticated cloud request; Local Only has a longer budget and no cloud route.
- Abort signals reach Chrome create/prompt options; bounded device queue prevents accumulation, runtime deadlines cancel work and privacy changes cancel/close the old context.
- Preserve exact evidence/source validation, semantic rewrites/restoration, Explain Simply, caches, quotas, App Check, private setup, real/sample statistics and development Evaluation Lab isolation.
- Disable release voice UI/entry points and exclude its transport/permission page; retain experimental sources without importing secondary-project/WebSocket workarounds.
- Add release reports, judge instructions, submission checklist and explicitly internal 65/100 readiness scorecard.

## Validation and limitations

423 deterministic tests passed, 0 failed; core browser, 100 UI, 48 layout, controlled audio/privacy checks and development/production/web/demo builds passed. Installed Firebase browser SDK exercised with a stand-in Chrome model; zero real Gemini requests. Native extension loading is policy-blocked here.

Production cloud auth still needs a trusted issuer. Partner's historical 88-second Nano run is not release-build validation. Official rules fetch and GitHub API access are blocked. See docs/release for exact evidence and pending hardware/network tests. No eligibility, real voice, model accuracy or public-production readiness claim.

Review as a **draft** against integration/chisom-features. Do not merge automatically. No main or teammate branches were modified.

## Independent-review corrections

Request-specific, acknowledged worker/offscreen cancellation now blocks new cloud fallback after cancellation, including preparation/queue/authentication races, without aborting unrelated browsing. Queue wait and active Nano budgets are separate; physical settlement still owns the slot. The Local Only waiting message is wired through the actual content script, and background tests default to the voice-disabled release. See REVIEW_FIXES.md for scoped guarantees, exact tests, file list and unchanged production issuer/hardware blockers. No merge or new pull request is requested.
