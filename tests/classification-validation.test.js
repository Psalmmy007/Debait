import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult, KINDS } from '../src/engine/contract.js';
import { headlinePrompt } from '../src/engine/qualityPolicy.js';
import { describeAiError } from '../src/engine/errors.js';
import { createHeadlineEngine } from '../src/engine/inference.js';
import { createEngine } from '../src/engine/runtime.js';

const curiosity = [
  'You will not believe what happened at the meeting',
  'The one thing doctors wish everyone understood',
];
const comparisons = [
  ['Everyone richer than you knows this — stop being a loser', 'richer than you', 'Wealth comparison makes the reader inferior'],
  ['Your friends look better than you — buy this to catch up', 'look better than you', 'Appearance comparison pressures the reader to match friends'],
  ['Successful colleagues are leaving you behind — prove your status now', 'prove your status now', 'Success comparison pressures the reader to prove status'],
];
const headline = comparisons[0][0];
const valid = () => ({ kind: 'envy', score: 63.4, triggers: [{ word: comparisons[0][1], why: comparisons[0][2] }],
  honest_rewrite: headline, source: 'cloud' });
const invalid = error => error.code === 'debait/invalid-classification' && /No classification was produced/.test(error.message);

for (const text of curiosity) {
  test(`prompt treats withholding alone as insufficient for envy: ${text}`, () => {
    const prompt = headlinePrompt([text]);
    assert.ok(prompt.includes(`"${text}"`));
    assert.ok(prompt.includes('use clean absent'));
    assert.ok(prompt.includes('curiosity alone are not evidence of envy'));
    assert.ok(prompt.includes('at least one meaningful exact word or phrase'));
    // Supplied clean response checks normalization, not an actual Gemini judgment.
    const result = normalizeResult({ ...valid(), kind: 'clean', score: 8, triggers: [], honest_rewrite: text }, text);
    assert.equal(result.kind, 'clean'); assert.equal(result.honest_rewrite, text);
    assert.throws(() => normalizeResult({ ...valid(), triggers: [], honest_rewrite: text }, text), invalid);
  });
}

for (const [text, word, why] of comparisons) {
  test(`supplied genuine comparison evidence survives normalization: ${word}`, () => {
    assert.ok(headlinePrompt([text]).includes(`"${text}"`));
    const result = normalizeResult({ ...valid(), triggers: [{ word, why }], honest_rewrite: text }, text);
    assert.equal(result.kind, 'envy'); assert.deepEqual(result.triggers, [{ word, why }]);
    assert.equal(result.score, 63); assert.equal(result.source, 'cloud');
  });
}

for (const [name, patch] of [
  ['empty evidence', { triggers: [] }],
  ['missing evidence array', { triggers: undefined }],
  ['missing explanation', { triggers: [{ word: 'richer than you' }] }],
  ['blank explanation', { triggers: [{ word: 'richer than you', why: ' \n ' }] }],
  ['punctuation-only explanation', { triggers: [{ word: 'richer than you', why: '!!!' }] }],
  ['null explanation', { triggers: [{ word: 'richer than you', why: null }] }],
  ['blank trigger', { triggers: [{ word: ' ', why: 'Comparison pressure' }] }],
  ['punctuation-only trigger', { triggers: [{ word: '—', why: 'Comparison pressure' }] }],
  ['invented phrase', { triggers: [{ word: 'billionaires', why: 'Comparison pressure' }] }],
  ['paraphrased evidence', { triggers: [{ word: 'wealthier than you', why: 'Comparison pressure' }] }],
  ['wrong case, not copied', { triggers: [{ word: 'RICHER THAN YOU', why: 'Comparison pressure' }] }],
  ['null evidence entry', { triggers: [null] }],
  ['invalid seventh entry', { triggers: [...Array.from({ length: 6 }, () => valid().triggers[0]), { word: 'invented', why: 'Unsupported' }] }],
]) {
  test(`rejects ${name} instead of producing Clean`, () => {
    assert.throws(() => normalizeResult({ ...valid(), ...patch }, headline), invalid);
  });
}

for (const kind of ['curiosity_gap', 'uncertain', 'Envy', '', undefined]) {
  test(`explicitly rejects unsupported category ${String(kind)}`, () => {
    assert.throws(() => normalizeResult({ ...valid(), kind }, headline), error => invalid(error) && /unsupported category/.test(error.message));
  });
}

test('validator checks copied words, not arbitrary substrings or keyword assignments', () => {
  assert.throws(() => normalizeResult({ ...valid(), triggers: [{ word: 'rich', why: 'Status pressure' }] }, 'Richard speaks'), invalid);
  const text = 'Richard says the rich demand more';
  assert.equal(normalizeResult({ ...valid(), triggers: [{ word: 'rich', why: 'Supplied evidence, semantic validity not established' }] }, text).kind, 'envy');
  assert.deepEqual(KINDS, ['rage', 'fear', 'envy', 'clean']);
  for (const kind of ['rage', 'fear', 'envy']) {
    assert.equal(normalizeResult({ ...valid(), kind }, headline).kind, kind);
    assert.throws(() => normalizeResult({ ...valid(), kind, triggers: [] }, headline), invalid);
  }
});

test('normalization trims evidence, preserves categories and keeps original input unchanged', () => {
  const input = valid(); input.triggers[0].word = ' richer than you '; input.triggers[0].why += ' ';
  const snapshot = structuredClone(input);
  const normalized = normalizeResult(input, headline);
  assert.deepEqual(normalized.triggers, valid().triggers);
  assert.deepEqual(normalizeResult(normalized, headline), normalized);
  assert.deepEqual(input, snapshot);
  assert.equal(normalized.honest_rewrite, headline);
});

test('checking evidence presence does not claim to validate the explanation semantically', () => {
  const text = curiosity[0];
  // Demonstrates the remaining limit honestly: a copied phrase and nonblank but
  // unpersuasive explanation pass the structural gate. Real evaluation is separate.
  const supplied = { ...valid(), triggers: [{ word: 'what happened', why: 'This makes readers envious' }], honest_rewrite: text };
  assert.equal(normalizeResult(supplied, text).kind, 'envy');
});

test('cloud and device adapters reject unsupported evidence with an honest error and no mock fallback', async () => {
  for (const localOnly of [false, true]) {
    let cloudAccess = 0, mocks = 0;
    const sdk = createHeadlineEngine({
      getAi: async () => { cloudAccess++; return {}; }, getDeviceAi: () => ({}),
      getGenerativeModel: () => ({ generateContent: async () => ({ response: {
        inferenceSource: localOnly ? 'on_device' : 'in_cloud',
        text: () => JSON.stringify({ results: [{ ...valid(), triggers: [] }] }),
      } }) }),
      InferenceMode: { PREFER_ON_DEVICE: 'hybrid', ONLY_ON_DEVICE: 'local' },
      prompt: headlinePrompt, lang: [], deviceAvailability: async () => localOnly ? 'available' : 'unavailable',
    });
    const engine = createEngine({ firebaseEngine: sdk, mockEngine: { scoreHeadlines() { mocks++; } } });
    await assert.rejects(engine.scoreHeadlines([headline], { localOnly }), error => {
      assert.equal(error.code, 'debait/invalid-classification');
      assert.match(error.message, /No analysis was produced/);
      assert.ok(!error.message.includes(headline)); return true;
    });
    const status = await engine.getStatus({ localOnly });
    assert.equal(status.ready, false); assert.equal(status.source, 'none');
    assert.equal(mocks, 0); assert.equal(cloudAccess, localOnly ? 0 : 1);
  }
});

test('classification failure has a specific safe error description', () => {
  const error = describeAiError({ code: 'debait/invalid-classification', message: 'private raw response' });
  assert.equal(error.needsAppCheck, false);
  assert.match(error.message, /No analysis was produced/);
  assert.ok(!error.message.includes('private raw response'));
});

for (const text of [
  "'I'd throw up in the car park': How school anxiety is harming children's futures",
  'Patients report permanent pain after treatment',
  "'I was scared', Maya Patel says after the flood",
]) {
  test(`supplied Clean emotional reporting stays unchanged: ${text}`, () => {
    const result = normalizeResult({ ...valid(), kind: 'clean', triggers: [], honest_rewrite: 'A calmer account' }, text);
    assert.equal(result.kind, 'clean'); assert.equal(result.honest_rewrite, text);
    assert.equal(result.rewriteReason, 'clean');
  });
}
