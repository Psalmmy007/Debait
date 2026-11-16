import test from 'node:test';
import assert from 'node:assert/strict';
import { hasMeaningfulRewrite, canRewriteRecord, rewriteDecision, headlinePrompt } from '../src/engine/qualityPolicy.js';
import { normalizeResult } from '../src/engine/contract.js';
import { swapToRewrite } from '../src/content/ui/page.js';

const original = "'It felt like I was dying': Why some teenagers don't go to school";
// Synthetic evidence isolates rewrite mechanics; it is not a label-quality assertion.
const result = (rewrite, evidence = original) => ({ kind: 'fear', score: 65, triggers: [{ word: evidence, why: 'Controlled rewrite fixture, not a semantic classification judgment' }], honest_rewrite: rewrite, source: 'cloud' });

test('the reported distress quotation has no meaningful rewrite when the model repeats it', () => {
  const normalized = normalizeResult(result(original), original);
  assert.equal(normalized.rewriteReason, 'model_unchanged');
  assert.equal(hasMeaningfulRewrite(original, normalized.honest_rewrite), false);
  assert.equal(canRewriteRecord({ state: 'scored', text: original, result: normalized }), false);
});

test('whitespace, Unicode normalization and typographic quote changes alone are not alternatives', () => {
  assert.equal(hasMeaningfulRewrite(original, `  ${original.replaceAll(' ', '  ')}\n`), false);
  assert.equal(hasMeaningfulRewrite('“café”', '"cafe\u0301"'), false);
  assert.equal(hasMeaningfulRewrite('The US is involved', 'The us is involved'), true);
  assert.equal(hasMeaningfulRewrite('A question?', 'A question!'), true);
});

for (const proposed of [
  'Why some teenagers do not go to school',
  "'I was anxious': Why some teenagers don't go to school",
  "It felt like I was dying: Why some teenagers don't go to school",
]) {
  test(`quoted distress is retained if a rewrite alters or removes it: ${proposed}`, () => {
    const normalized = normalizeResult(result(proposed), original);
    assert.equal(normalized.honest_rewrite, original);
    assert.equal(normalized.rewriteReason, 'preservation_guard');
    const again = normalizeResult(normalized, original);
    assert.equal(again.rewriteReason, 'preservation_guard');
  });
}

test('promotional prefix removal retains the exact quotation and negation', () => {
  const before = "You won't believe this: 'I don't feel safe': The account of some teenagers";
  const proposed = "'I don't feel safe': The account of some teenagers";
  assert.deepEqual(rewriteDecision(before, proposed, 'fear'), { text: proposed, reason: 'alternative' });
});

test('unchanged swaps do not mutate DOM, set rewritten state or require browser APIs', async () => {
  const record = { state: 'scored', text: original, result: normalizeResult(result(original), original),
    el: { get childNodes() { throw new Error('must not touch DOM'); } } };
  assert.equal(await swapToRewrite(record), false);
  assert.equal(record.state, 'scored'); assert.equal(record.original, undefined);
});

test('a meaningful swap reports true only after changing the headline', async () => {
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.document = { createTextNode: text => ({ textContent: text }) };
  const before = 'Click to find out: The trend may last 5 years', proposed = 'The trend may last 5 years';
  let visible = before;
  const record = { state: 'scored', text: before, result: normalizeResult(result(proposed, before), before),
    el: { childNodes: [{ cloneNode: () => ({ textContent: before }) }], textContent: before,
      replaceChildren: node => { visible = node.textContent; } } };
  assert.equal(await swapToRewrite(record), true); assert.equal(visible, proposed);
  assert.equal(record.state, 'debaited');
  assert.equal(await swapToRewrite(record), false); // A repeated action cannot count twice.
});

test('eligibility excludes clean, unchanged and already-rewritten records for every caller', () => {
  for (const record of [
    { state: 'scored', text: 'Original', result: { ...result('Alternative'), kind: 'clean' } },
    { state: 'scored', text: 'Original', result: result(' Original ') },
    { state: 'debaited', text: 'Original', result: result('Alternative') },
  ]) assert.equal(canRewriteRecord(record), false);
});

test('classification guidance distinguishes reported fear from publisher manipulation without adding a category', () => {
  const prompt = headlinePrompt([original]);
  assert.ok(prompt.includes('Quoted first-person fear or distress is not, by itself, evidence of publisher manipulation'));
  assert.ok(prompt.includes('Fear label needs evidence beyond the quoted emotion itself'));
  assert.ok(prompt.includes('Use only rage, fear, envy, or clean'));
});

test('a DOM headline already equal to the proposal is not counted as another rewrite', async () => {
  const record = { state: 'scored', text: 'This alarming trend may last 5 years',
    result: result('This trend may last 5 years'),
    el: { textContent: 'This trend may last 5 years', get childNodes() { throw new Error('must not mutate'); } } };
  assert.equal(await swapToRewrite(record), false); assert.equal(record.state, 'scored');
});
