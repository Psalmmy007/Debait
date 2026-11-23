import test from 'node:test';
import assert from 'node:assert/strict';
import { headlinePrompt, preserveRewrite } from '../src/engine/qualityPolicy.js';
import { normalizeResult } from '../src/engine/contract.js';
import { createHeadlineEngine } from '../src/engine/inference.js';

const bbcBody = 'One of the most commonly injured body parts that many of us never train';
const bbcChildbirth = "'It blew my mind': The alarming health effects of childbirth that never go away";
// Controlled labels isolate rewrite behavior; these are not classifier expectations.
const output = (rewrite, kind = 'fear', evidence = bbcChildbirth) => ({ kind, score: 70, triggers: kind === 'clean' ? [] : [{ word: evidence, why: 'Controlled rewrite fixture, not a classification accuracy claim' }], honest_rewrite: rewrite, source: 'cloud' });

test('BBC body-part rewrite cannot drop the comparison, population or negation', () => {
  const r = normalizeResult(output('A commonly injured body part that is often not trained', 'envy', bbcBody), bbcBody);
  assert.equal(r.honest_rewrite, bbcBody);
  // Stage 1 protects the text; it does not claim this fabricated category is correct.
  assert.equal(r.kind, 'envy');
});

test('BBC childbirth rewrite cannot weaken never go away into persist over time', () => {
  assert.equal(normalizeResult(output('The notable health effects of childbirth that persist over time'), bbcChildbirth).honest_rewrite, bbcChildbirth);
});

test('removing a claim adjective cannot be established as safe from headline text alone', () => {
  const candidate = "'It blew my mind': The health effects of childbirth that never go away";
  assert.equal(preserveRewrite(bbcChildbirth, candidate, 'fear'), bbcChildbirth);
});

for (const [name, original, proposed] of [
  ['name', 'Maya Patel says the plan is alarming', 'Maya Singh says the plan is concerning'],
  ['amount', 'Council says the alarming bill is £2 million', 'Council says the concerning bill is £3 million'],
  ['number embedded in another number', 'Researchers report 7 cases', 'Researchers report 17 cases'],
  ['negation', 'Investigators found no evidence of payments', 'Investigators found evidence of payments'],
  ['word-boundary negation', 'This is not a health risk', 'This is a notable health risk'],
  ['uncertainty', 'The drug may cause serious side effects', 'The drug causes serious side effects'],
  ['attribution', 'Patients report alarming symptoms', 'Patients have concerning symptoms'],
  ['duration unit', 'Symptoms may persist for 5 years', 'Symptoms may persist for 5 days'],
  ['duration', 'The effects are permanent', 'The effects are long-lasting'],
  ['comparison', 'Rates are more than twice the previous level', 'Rates are twice the previous level'],
  ['quantity', 'Some patients report permanent symptoms', 'Patients report permanent symptoms'],
]) {
  test(`the lexical safeguard retains the original after loss/change of ${name}`, () => {
    assert.equal(preserveRewrite(original, proposed, 'fear'), original);
  });
}

test('Clean preserves the exact original, including punctuation and whitespace', () => {
  const original = '  Council approves £2 million — report  ';
  assert.equal(normalizeResult(output('Council approves funding', 'clean'), original).honest_rewrite, original);
});

test('retaining lexical details does not make an unsupported synonym safe', () => {
  const original = 'Researchers say this alarming trend may last 5 years';
  const proposed = 'Researchers say this concerning trend may last 5 years';
  assert.equal(preserveRewrite(original, proposed, 'fear'), original);
});

test('the real prompt requires conservative classification and preservation without harmful substitutions', () => {
  const prompt = headlinePrompt([bbcBody, bbcChildbirth]);
  for (const rule of ['names', 'numbers', 'negation', 'attribution', 'uncertainty', 'duration', 'comparisons', 'factual claims',
    'If clean, repeat the original headline EXACTLY', 'If no faithful and useful rewrite is possible',
    'curiosity alone are not evidence of envy', 'Negative health news', 'association and causation']) assert.ok(prompt.includes(rule), rule);
  assert.ok(!prompt.includes('silently killing you')); assert.ok(!prompt.includes('DESTROYS'));
  const data = JSON.parse(prompt.split('HEADLINES (JSON data):\n')[1]);
  assert.deepEqual(data.map(item => item.text), [bbcBody, bbcChildbirth]);
});

test('SDK-backed adapter uses the production prompt and applies the BBC safeguards before returning results', async () => {
  let captured;
  const engine = createHeadlineEngine({
    getAi: async () => ({}), getDeviceAi: () => { throw new Error('not device'); },
    getGenerativeModel: (_ai, parameters) => {
      assert.equal(parameters.mode, 'cloud');
      return { generateContent: async text => {
        captured = text;
        return { response: { inferenceSource: 'in_cloud', text: () => JSON.stringify({ results: [
          output('A commonly injured body part that is often not trained', 'envy', bbcBody),
          output('The notable health effects of childbirth that persist over time'),
        ] }) } };
      } };
    },
    InferenceMode: { ONLY_IN_CLOUD: 'cloud' }, lang: [], prompt: headlinePrompt,
  });
  const results = await engine.scoreHeadlines([bbcBody, bbcChildbirth], { localOnly: false });
  assert.equal(captured, headlinePrompt([bbcBody, bbcChildbirth]));
  assert.deepEqual(results.map(result => result.honest_rewrite), [bbcBody, bbcChildbirth]);
});

test('causal reversal is rejected even when lexical tripwires survive', () => {
  const original = 'Doctors say the treatment causes pain';
  const unsupported = 'Doctors say the treatment prevents pain';
  // A relation can change while every protected lexical span survives.
  assert.equal(preserveRewrite(original, unsupported, 'fear'), original);
});
