# Judge / owner testing guide

**Conditional release candidate, not a production-authenticated public release. Voice is disabled.**

## Requirements and installation

Use Node.js 24.12+ (tested here: 24.22.1), desktop Chrome supporting the LanguageModel API, and eligible hardware for Nano. Chromium in this cloud environment blocks unpacked extensions. The partner reported one warm result on Chrome 150 / Windows 11 / 16 GB RAM; your current official hardware/browser requirements must be checked separately. No VM/remote desktop is claimed to be eligible; prefer a supported physical computer.

```bash
git switch release/hackathon-final-integration
git pull --ff-only origin release/hackathon-final-integration
npm ci
npm test
```

For an authorized development demonstration:

```bash
VITE_DEBAIT_APP_CHECK=debug npm run build:dev
```

Load `dist` using Chrome → `chrome://extensions` → Developer mode → Load unpacked. For updates, keep the same directory/extension identity, click Reload, and refresh the test page. The build includes no private token. Only an explicitly configured unpacked development installation may use debug authentication. Follow [Firebase setup](../FIREBASE_AUTH.md): the project owner privately registers this installation's token in the existing development app. The popup's Copy control transfers the hidden token directly to Firebase Console; do not paste it into chat, source, screenshots or an archive. Never disable App Check enforcement. A judge needs either this supervised setup or the still-unprovisioned reviewed production issuer.

For production packaging:

```bash
npm run build
node scripts/check-evaluation-build.js production
node scripts/check-release-build.js
node scripts/check-voice-build.js
```

Production intentionally rejects debug authentication. Without a trusted issuer, cloud requests fail closed. Local Only remains available on eligible hardware; do not advertise working public cloud installation until the issuer is implemented and verified. Do not distribute a demo build as a real-inference release.

## Reproducible synthetic page

Create a temporary local HTML file outside the application source, containing:

```html
<!doctype html><meta charset="utf-8"><title>Synthetic Debait review</title>
<h2 data-debait-headline>City council approves a new transport budget.</h2>
<h2 data-debait-headline>These officials are laughing at YOU — join the outrage now!</h2>
<h2 data-debait-headline>Everyone your age is getting rich except you!</h2>
<h2 data-debait-headline>'I was terrified during the storm,' survivor says.</h2>
<h2 data-debait-headline>Click to find out: Council approves £2 million for repairs</h2>
```

Serve its folder with `python3 -m http.server 5181 --bind 127.0.0.1`, visit `http://localhost:5181/`, and allow extension access. These are invented evaluation examples, not news, and predictions are not guaranteed answers. If localhost fails to inject, refresh after loading the extension and inspect its site-access permission; do not present that failure as a Nano result. BBC offers a separately tuned finder for real headlines.

## Demonstration checks

1. **Fresh local inference:** enable Local Only, keep Auto-Debait off, and initially use just the first synthetic headline. Start/download Nano from the popup if prompted. Confirm availability in the offscreen context. Wait: low-end hardware can take minutes. Inspect the tag/card and source metadata for an actual on-device response. A cached tag or “available” status is insufficient. Record failure honestly if the 150-second prompt budget is exceeded.
2. **Cloud fallback:** with owner-approved development authentication, disable Local Only. In a browser where Nano is unavailable, use a new headline to request cloud inference. On slow eligible hardware, a local attempt may expire after 10 seconds before one cloud request. Confirm a successful Firebase response and cloud source; no mock or second-project result. Lack of credentials/model/quota produces an error.
3. **Headline intelligence:** open tags. Check exact evidence, explanation and “not a fact-check” clarification. Distressing quotations may be legitimate reporting; review model judgments critically.
4. **Safe rewrite and restoration:** request neutral wording on a flagged example. A separable “Click to find out:” prefix can be safely removed when proposed, while the rest must remain identical. Rejected or unchanged proposals show no safe alternative, do not enable Apply and do not count a rewrite. Apply an accepted alternative, inspect links/figures/quotes, then restore the original. Do not promise every flagged headline is rewritable.
5. **Explain Simply:** request it on a complex headline; confirm the original is unchanged, general definitions are distinguished from event facts, missing context is admitted and source is shown.
6. **Auto-Debait:** explicitly opt in, test existing/dynamically inserted headlines, restore originals, then turn it off. Only accepted alternatives may apply. It is off by default.
7. **Privacy:** start with Local Only on and inspect offscreen network activity: no cloud headline inference. Repeat with an unavailable model and timeout. Switching Local Only during permitted inference must discard late cloud results and close/cancel the old context. Previously cached cloud results must not appear as local results.
8. **UI/statistics:** open page settings then toolbar popup; the page panel should close. Verify orb drag/size, light/dark, keyboard focus, safe share image, Weekly Mind Facts and real/sample labels. Evaluation Lab runs must not change browsing statistics. Curiosity Gap and Uncertain are educational/future states, not live predictions.
9. **Failures:** use actual permission/quota/model/authentication failures where encountered. Problems must use fixed descriptions, never show credentials or manufacture success. Voice controls should be absent and voice entry points blocked.

## Evidence and three-minute video outline

Record genuine successful inference, not controlled preview footage portrayed as AI. Suggested allocation: 0:00–0:20 problem/privacy; 0:20–1:00 actual on-device classification (honestly label elapsed time if cut); 1:00–1:35 permitted cloud fallback/source; 1:35–2:15 evidence, safe rewrite and restore; 2:15–2:40 Explain Simply and real statistics; 2:40–3:00 architecture and limitations. If either inference path is unverified, say so and complete that evidence before submission. The three-minute ceiling is the owner's requirement; current official rules remain unverified here.
