# Chisom feature integration — work in progress

Branch: `integration/chisom-features` (based on `feature/ui-completion`).

## Implemented
- Orb personalization: persisted `orbSize` setting, 75%–160% slider, immediate resizing, saved positioning, live response to settings changes. Reuses current orb rendering/color and never replaces the classifier.
- Shareable headline images: adapted the teammate's canvas design into the current Ingredients card. Share is available only when the validated engine has a meaningful safe wording alternative. Images explicitly say **Suggested neutral wording** and **Not a fact-check**; clipboard attempts fall back to local PNG download.
- Voice-conversation guidance: shorter, more understandable responses, ask to repeat unclear speech, avoid misrepresenting tool failures. Keeps existing live-session privacy/Local Only protections.

## Not yet integrated
- Teammate's WebSocket monkeypatch, speculative audio retry/hedging, secondary Firebase project, fallback mock inference, unsafe free-form rewrite behavior and older metrics. These require separate security/compatibility evaluation.
- Teammate's page-summary API. It was not part of the currently requested set and auto-collects page text on settings open; needs explicit opt-in/consent design.

## Mandatory validation before merge
1. Run `npm ci && npm test && npm run build:dev && npm run build`; inspect errors.
2. Re-run the existing UI/layout checks and manually install unpacked dev build in Chrome.
3. Test orb size 75/100/160% near all viewport edges, resizing/dragging/reload, reduced motion, disabled sites, keyboard and panel accessibility.
4. Test sharing only after valid safe alternative (classification and requested rewrite), impossible share for Clean/no rewrite/mock, permission denied clipboard fallback, long and multilingual headlines, quote content, HTML escaping, and users not prompted to share unaudited facts.
5. Test voice start/stop, unclear speech, permission denied, Local Only toggle while connecting/in call, App Check/quota errors, rapid stop/restart, background tabs, and actual spoken response. Controlled tests cannot prove real audio reliability.
6. Verify no mock fallback, security regressions, fake statistics, changed rewrite acceptance, or policy leakage.
7. Review teammate attribution and keep experiments separate: `experiment/subtle-framing-classification` is **not** merged.
8. Only after test evidence and user approval, merge selected features into the product branch.

Current status: code committed, not build-verified or native-Chrome-verified in this environment. This branch is **not production ready**.
