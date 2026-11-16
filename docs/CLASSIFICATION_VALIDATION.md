# Classification evidence repair

The four live categories remain rage, fear, envy and clean. The prompt explicitly
uses Clean when none of the supported emotional techniques is established. Clean
is not a fact-check and does not certify absence of every other clickbait technique.
Curiosity-only headlines must not become Envy merely because they withhold details.
The prompt contrasts the two localhost examples with wealth, appearance, success
and status pressure. Existing distress-reporting guidance and rewrite policy remain.

## What the validator establishes

Non-Clean responses need at least one trigger. Every supplied trigger must contain
a letter or number, have an explanation containing a letter or number, and match
text actually present in the input. Outer trigger/explanation whitespace is trimmed.
Matching is case-sensitive, preserves punctuation, and disallows partial-word
matches such as `rich` inside `Richard`. There is no vocabulary list assigning
categories, no score threshold, and no automatic relabeling to Clean.

All supplied entries are checked before limiting the displayed list to six. Unknown
categories and malformed answers throw `debait/invalid-classification`. The SDK
adapter produces a safe analysis error without exposing raw responses. Existing
runtime/worker validation prevents unsupported results from being cached or counted.
The policy version is `quality-classification-evidence-v4`; existing cache migration
invalidates older analysis without resetting statistics. Invalid current-policy
cached evidence also fails validation and is reanalyzed through normal scheduling.

A whole batch fails if one answer is invalid, matching existing malformed-response
behavior. No new retry loop is introduced; existing quota and retry limits apply.
Strict copying can reject an otherwise reasonable model answer that paraphrases a
trigger or changes case. This is deliberate: the prompt requires exact evidence.

## What this cannot establish

A model can copy real words and write a nonblank yet unpersuasive explanation.
Structural validation cannot prove that a category is correct. The regression suite
explicitly demonstrates this limitation. It does not use emotional-keyword shortcuts
to override model classifications. Generic or incorrect rationales require actual
model evaluation and human review, not claims that a format test solves semantics.
Existing rewrite tests now supply synthetic evidence so they continue to isolate
rewrite fidelity; those fixtures are not classification-accuracy expectations.

## Manual extension evaluation

1. Pull `repair/priority2-firebase-auth` and run
   `VITE_DEBAIT_APP_CHECK=debug npm run build:dev`.
2. In `chrome://extensions`, reload Debait, then refresh the localhost headline page.
   Use the installed extension on that page, not the separate `/?preview` mock UI.
   Keep automatic rewriting off.
3. Test U01 and U02 separately, then the three comparison examples below. Use normal
   analysis and respect any cooldown. Older cached answers are invalidated automatically.
4. Record the build, model, inference source, label, score, exact trigger and explanation.
   Record whether the result was fresh or cached when available. Never copy debug
   tokens, credentials or complete provider error payloads into a report.
5. Review classification and rewrite outcomes separately. A missing-evidence error
   is an analysis failure, not a Clean classification. Check that rejected rewrites
   still offer no action and do not increment the rewrite count.

| Input | Preliminary classification expectation | Reason |
|---|---|---|
| You will not believe what happened at the meeting | Clean under current supported categories | Withholding alone is not social comparison |
| The one thing doctors wish everyone understood | Clean under current supported categories | Reference to doctors and withholding do not establish inferiority |
| Everyone richer than you knows this — stop being a loser | Envy | Wealth comparison and explicit inferiority pressure |
| Your friends look better than you — buy this to catch up | Envy | Appearance comparison and pressure to catch up |
| Successful colleagues are leaving you behind — prove your status now | Envy | Success comparison and status pressure |
| 'I'd throw up in the car park': How school anxiety is harming children's futures | Clean absent separate supported framing evidence | Distress quotation and negative factual claim alone are insufficient |

These are proposed review expectations, not live Gemini results. Repeat with
paraphrases, different batch orders, and held-out headlines. Do not infer general
accuracy from exact examples embedded in the prompt. Review device and cloud
outputs separately where available. Any future Curiosity Gap or Uncertain schema
change requires a separate evaluation and coordination with the frontend teammate.
