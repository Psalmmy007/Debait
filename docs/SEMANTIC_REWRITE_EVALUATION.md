# Conservative rewrite policy and review set

This policy deliberately trades rewrite coverage for trust. It does not verify
article facts or prove semantic equivalence. Clean results keep the exact input.
For non-Clean results, only removal of one of these initial promotional prefixes
is accepted: `You won't believe this: `, `You will not believe this: `,
`Click to find out: `. Matching the prefix ignores case and typographic apostrophes.
The entire remainder must match, including case, quotes and attribution; spacing,
Unicode composition and typographic quote normalization are tolerated. No edit
length/distance or changed-word threshold is used. Safety warnings, reporting
labels, adjective removal and synonyms are not in this initial supported subset.

Rejected proposals retain the original. Existing actions therefore show no safe
alternative and do not count a rewrite. `semantic_change_risk` means acceptance
could not be established, not proof the candidate is false. Existing
`preservation_guard` identifies lost protected details; `model_unchanged` identifies
unchanged model output. Reasons contain no rejected headline text. Cache policy
version changes invalidate earlier answers without resetting reading statistics.

## Human review protocol

These are proposed judgments, NOT recorded Gemini outputs. Tests inject controlled
responses to check rejection and UI behavior; they do not establish classification
accuracy. Run actual Gemini evaluation separately using public/synthetic headlines
only, normal authenticated operation and existing quota pacing. Record model/build,
date, inference source, returned label/score, exact trigger/explanation, proposed
rewrite and final accepted rewrite. Review framing and factual fidelity separately;
a good classification does not imply an acceptable rewrite. Repeat ambiguous cases
and have two reviewers discuss disagreements. No numerical accuracy is claimed here.

For ambiguous examples, reviewers should assess the presentation technique. No
new category is introduced: prefer Clean if manipulation evidence is weak. Scores
remain wording intensity judgments, not confidence, truth or danger probabilities.
Do not impose a numerical threshold or treat quoted headlines as automatically Clean.

| Headline | Proposed classification / review rationale | Safe rewrite expectation |
|---|---|---|
| 'I'd throw up in the car park': How school anxiety is harming children's futures | Clean absent separate manipulation evidence; distress quote and harm claim alone insufficient | Original; reject harming → affecting or destroying |
| 'It felt like I was dying': Why some teenagers don't go to school | Clean absent separate technique; reported experience | Original |
| 'It blew my mind': The alarming health effects of childbirth that never go away | Ambiguous within existing labels: inspect publisher-added alarming; permanence is a factual claim, not proof of manipulation | Original; never weaken never go away |
| Patients report permanent pain after treatment | Clean; attributed negative health reporting | Original |
| Flood warning issued for three counties | Clean; safety warning | Original; do not remove warning |
| Study finds treatment may increase risk by 20% | Clean; qualified risk reporting | Original |
| Doctors say treatment causes pain | Clean unless additional framing supplies manipulation | Original; no association or prevention substitution |
| 'I was scared': YOUR child is next — panic NOW! | Fear; publisher-added personal threat and coercive urgency outside quote | Original; preserve quote and claim |
| YOUR family is doomed unless you click NOW | Fear; unsupported personal threat and coercive urgency | Original |
| Officials you should HATE: join the outrage now | Rage; explicit hostility and outrage pressure | Original |
| Everyone richer than you knows this — stop being a loser | Envy; explicit wealth comparison and status pressure | Original |
| Council approves £2 million for repairs | Clean; ordinary factual reporting | Original |
| One of the most commonly injured body parts that many of us never train | Clean absent other evidence; curiosity is not envy | Original; no invented body part |
| School anxiety is harming children's futures | Clean absent separate framing evidence; negative claim alone insufficient | Original |
| You won't believe this: Council approves £2 million for repairs | Review as Clean unless supported rage/fear/envy technique; curiosity alone is not those categories | If Clean original; if independently non-Clean, prefix removal passes structural guard |
| Click to find out: YOUR family is doomed unless you click NOW | Fear; personal threat supports label independently of curiosity | YOUR family is doomed unless you click NOW (permitted deletion, remaining claim is not verified or guaranteed calm) |
| You won't believe this: Everyone richer than you knows this — stop being a loser | Envy; explicit status pressure | Everyone richer than you knows this — stop being a loser (permitted deletion, remaining manipulation may persist) |
| 'Click to find out: I was scared', Maya Patel says | Clean absent surrounding manipulation; promotional-looking text is inside speech | Original; no quotation deletion |

## Remaining limits

The restricted gate can still accept a useless prefix removal, and residual
manipulation can remain. It establishes preservation of the retained text, not
truth, usefulness or absence of all framing effects. Broader editing requires a
separate evaluated policy, not simply more synonyms or model self-assurance.
Prompt examples encourage better judgment but require actual Gemini/browser review.
On-device model behavior also requires separate runtime evaluation. No credentials,
App Check, Local Only, quota policy or frontend files change in this repair.
