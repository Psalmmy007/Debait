# Quality Stage 1

This stage preserves the Rage/Fear/Envy/Clean schema and existing card layout.
The card now calls the output a Suggested rewrite and says it is not a fact-check.

The shared headline prompt now distinguishes emotional subject matter from manipulative
presentation and tells the model to preserve claims, names, numbers, negation,
attribution, uncertainty, duration, comparisons and quantities. It contains no
meaning-changing substitution examples. Clean headlines must be copied exactly;
when a useful faithful edit is not possible, the model must return the original.
This prompt is used through the existing Firebase SDK integration for both cloud
and on-device headline analysis. Authentication and inference-mode choices are unchanged.

The normalizer additionally enforces exact original text for Clean results. A small
lexical safeguard detects the loss/change of selected words, phrases, numbers,
time units and obvious multiword proper names/acronyms, then retains the original.
It can reject harmless paraphrases. It is not full entity recognition, entailment
checking, or fact-checking. It cannot establish whether the original claim is true,
catch every introduced fact, or guarantee equivalent meaning. For example, changing
“causes pain” to “prevents pain” can pass these limited checks. The regression suite
explicitly documents that limitation. Do not interpret a passing suite as a measured
Gemini classification accuracy or a medical-quality certification.

The two reported BBC outputs are covered as supplied-model-response regressions:
loss of “one of the most” / “many” / “never” returns the original body-part headline;
replacing “never go away” with “persist over time” returns the original childbirth
headline. Classification accuracy is not asserted by those tests. No new category,
confidence rubric or factual-verification service is introduced in this stage.

`QUALITY_POLICY_VERSION` in `src/engine/qualityPolicy.js` also versions the score cache.
Unversioned or older entries are discarded on the next analysis request, and current
entries remain reusable. Bump the version when changing the policy again. Existing
reading statistics are retained; previously counted headlines are not counted again
just because they were reanalysed under the new prompt. Historical statistics do not
become retrospectively reclassified. Refresh pages after updating to replace old
on-screen results.

## Update and manual review

1. Update `repair/priority2-firebase-auth` and run `npm ci`.
2. Build with `VITE_DEBAIT_APP_CHECK=debug npm run build:dev`.
3. Reload the existing unpacked Debait extension in `chrome://extensions`, then
   refresh test pages. Keep the same dist location and do not clear credential storage.
4. Retest the two BBC headlines with automatic rewriting off first. Inspect their
   explanations and proposed wording, then test inline rewriting/restoration.
5. Test plain health warnings, attributed quotations, names, quantities, negatives,
   uncertainty and permanent versus temporary effects. Check real cloud and Nano
   separately when available. Keep App Check enforcement and Local Only protections on.

No secret values are required for the automated tests. The tests use controlled SDK
outputs; real Gemini quality needs separate browser evaluation. The explicit mock
preview can check card rendering but cannot establish AI quality.
