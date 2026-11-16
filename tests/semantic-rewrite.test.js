import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/engine/contract.js';
import { rewriteDecision, canRewriteRecord, headlinePrompt } from '../src/engine/qualityPolicy.js';
import { swapToRewrite } from '../src/content/ui/page.js';

const bbc = "'I'd throw up in the car park': How school anxiety is harming children's futures";
const output = honest_rewrite => ({ kind: 'fear', score: 35, triggers: [], honest_rewrite, source: 'cloud' });
for (const [name, original, proposed] of [
  ['BBC weakened harm', bbc, bbc.replace('harming', 'affecting')],
  ['BBC intensified harm', bbc, bbc.replace('harming', 'destroying')],
  ['causal reversal', 'Doctors say treatment causes pain', 'Doctors say treatment prevents pain'],
  ['causation to association', 'Treatment causes pain', 'Treatment is associated with pain'],
  ['permanence', 'Effects never go away', 'Effects persist over time'],
  ['certainty', 'Treatment may cause pain', 'Treatment causes pain'],
  ['negation', 'Treatment does not cause pain', 'Treatment causes pain'],
  ['attribution', 'Patients say treatment causes pain', 'Treatment causes pain'],
  ['quotation removal', bbc, "How school anxiety is harming children's futures"],
  ['quotation alteration', bbc, bbc.replace('throw up', 'feel sick')],
  ['number change', 'Council approves £2 million', 'Council approves £3 million'],
  ['quoted promotional words', '"Click to find out: Patients report pain"', 'Patients report pain'],
  ['prefix plus claim substitution', 'Click to find out: Treatment causes pain', 'Treatment prevents pain'],
  ['unapproved prefix', 'Warning: Flood water is dangerous', 'Flood water is dangerous'],
  ['embedded adjective removal', 'The alarming effects are permanent', 'The effects are permanent'],
]) {
  test(`rejects ${name}; no action, DOM change or successful rewrite count`, async () => {
    const normalized = normalizeResult(output(proposed), original);
    assert.equal(normalized.honest_rewrite, original);
    assert.ok(['semantic_change_risk', 'preservation_guard'].includes(normalized.rewriteReason));
    assert.equal(normalizeResult(normalized, original).rewriteReason, normalized.rewriteReason);
    const rec = { state: 'scored', text: original, result: normalized,
      el: { get textContent() { throw new Error('rejected rewrite must not touch DOM'); } } };
    assert.equal(canRewriteRecord(rec), false);
    let rewrittenCount = 0;
    if (await swapToRewrite(rec)) rewrittenCount++;
    assert.equal(rewrittenCount, 0);
    assert.equal(rec.state, 'scored');
  });
}

test('BBC substitutions have a privacy-safe semantic rejection reason', () => {
  for (const word of ['affecting', 'destroying']) {
    assert.deepEqual(rewriteDecision(bbc, bbc.replace('harming', word), 'fear'),
      { text: bbc, reason: 'semantic_change_risk' });
  }
});

for (const [before, after] of [
  ["You won't believe this: Council approves £2 million for repairs", 'Council approves £2 million for repairs'],
  ['You will not believe this: Patients report permanent pain', 'Patients report permanent pain'],
  ["Click to find out: 'I was scared', Maya Patel says", "'I was scared', Maya Patel says"],
  ["You won’t believe this: Treatment may not prevent pain", 'Treatment may not prevent pain'],
]) {
  test(`permits only promotional framing removal: ${before}`, () => {
    assert.deepEqual(rewriteDecision(before, after, 'fear'), { text: after, reason: 'alternative' });
    assert.equal(canRewriteRecord({ state: 'scored', text: before, result: normalizeResult(output(after), before) }), true);
    assert.equal(rewriteDecision(before, after, 'clean').text, before);
  });
}

for (const candidate of [bbc, `  ${bbc.replaceAll(' ', '  ')}\n`]) {
  test('unchanged and whitespace-only outputs remain unavailable', () => {
    assert.deepEqual(rewriteDecision(bbc, candidate, 'fear'), { text: bbc, reason: 'model_unchanged' });
  });
}

test('production prompt includes specific classification boundaries and restricted editing', () => {
  const prompt = headlinePrompt([bbc]);
  for (const instruction of ['observable presentation technique', 'emotional vocabulary alone is insufficient',
    'Do not assume every quotation is clean', 'YOUR child is next', 'Patients report permanent pain',
    'both alter the claim', 'entire remaining headline unchanged']) assert.ok(prompt.includes(instruction));
  // This tests instruction coverage, not Gemini accuracy.
});
