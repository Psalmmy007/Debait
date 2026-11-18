// Experimental classification instructions. Shared rewrite instructions/contract come
// byte-for-byte from the frozen baseline; this policy does not loosen editing rules.
export const CANDIDATE_POLICY_VERSION = 'quality-subtle-framing-v5';
export const SUBTLE_CLASSIFICATION = `Classification:
- Use only rage, fear, envy, or clean. Assess observable presentation, not truth, danger severity or speculative publisher intentions. Ordinary criticism is allowed.
- rage: supported outrage/hostility pressure, including implied betrayal, hostile us-vs-them framing, inflammatory insinuations or rhetorical blame. Sarcasm can carry the technique without insults or capitals. Mere contrast, accountability reporting or disagreement is insufficient.
- fear: personalized vague danger, coercive urgency, ominous insinuation or catastrophic implications. Capitals or panic words are unnecessary. Concern alone does not establish exaggeration; uncertainty, genuine warnings and practical advice may be legitimate.
- envy: supported inferiority/status pressure, including implied inadequacy, being left behind or lifestyle/relative-success comparison directed at the reader. Reporting wealth or inequality is not enough; money, success, secrets or curiosity alone are not evidence of envy.
- clean: no supported rage, fear or envy technique established. Do not use Clean merely because a technique is indirect; do not force a category when evidence is insufficient. Clean does not mean true, fact-checked or free of other clickbait. Information withholding alone is outside the current four categories: use clean absent a supported emotional technique.

Concise decision procedure (use internally; output only the specified result fields):
1. Identify the claim, attribution/quotation and legitimate caution.
2. Identify emotional pressure beyond the subject, not a keyword.
3. Consider a reasonable neutral interpretation. Criticism/concern alone is insufficient; indirect observable pressure still counts.
4. Copy the exact pressure-bearing phrase and briefly explain the supported technique, without inventing facts/motives; otherwise choose clean.
- Require an observable presentation technique; emotional vocabulary alone is insufficient. Do not assume every quotation is clean.
- Quoted first-person fear or distress is not, by itself, evidence of publisher manipulation. A Fear label needs evidence beyond the quoted emotion itself.
- Negative health news, real threats and attributed harm/permanence claims are not automatically manipulation. Do not claim a warning is false or excessive without evidence. Lack of article context is not proof either way.

Contrastive examples (illustrative wording judgments, not verified article facts):
- "Audit finds councillors bought furniture after residents requested streetlights" -> clean: factual contrast. "Streetlights for residents? Apparently your comfort matters less than councillors' luxury chairs" -> rage: rhetorical dismissal and reader-directed betrayal.
- "Residents question the new tax proposal" -> clean. "One rule for them, another bill for you. Had enough yet?" -> rage: us-versus-them grievance and an outrage invitation.
- "A flood map identifies increased risk in some neighborhoods" -> clean: specific warning. "That safe street of yours? The next disaster may already be waiting" -> fear: vague personalized threat, not evidence the underlying risk is false.
- "Evacuate the eastern zone before the storm arrives" -> clean: urgent but actionable safety guidance. "Picture your child trapped. Act now before it is too late" -> fear: coercive emotional visualization.
- "Doctors advise patients to attend routine checks" -> clean. "Feeling fine? That is exactly when the hidden danger can catch you" -> fear: ominous personalized pressure. Hidden risk alone is insufficient.
- "Median pay rose faster for senior staff" -> clean. "Your colleagues moved ahead while you stayed ordinary. Still satisfied?" -> envy: relative success framed as reader inadequacy.
- "'I'd throw up in the car park': How school anxiety is harming children's futures" and "Patients report permanent pain after treatment" -> clean absent a separate technique: reported distress and negative factual claims alone are insufficient. "'I was scared': YOUR child is next — panic NOW!" -> fear: added threat/urgency, not the quotation itself.
- "You will not believe what happened at the meeting" and "The one thing doctors wish everyone understood" -> clean absent another supported technique; curiosity alone is not Envy.

- score: 0-100 for clarity/intensity of manipulative presentation, not danger, truth or calibrated confidence. Subtlety alone does not determine intensity. Plain alarming reporting scores low. No category is assigned by an arbitrary score cutoff.
- triggers: for every non-clean classification, provide at least one meaningful exact word or phrase copied from this headline, each with a nonempty explanation identifying the observable technique. Prefer the complete framing phrase rather than an isolated emotional word. Empty if clean. No invented evidence, facts or intentions. Retain the existing output schema.`;
