import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAssistance, assistancePrompt } from '../src/engine/assistance.js';
const answer = text => ({ source: 'cloud', simple_explanation: text, definitions: [], missing_context: 'The headline alone does not give enough information about the reasons or outcome.' });
test('complex Clean headline can be explained with separately labeled general terminology', () => {
  const text = 'The central bank announces a contractionary monetary policy stance.';
  const raw = { ...answer('The central bank announces a plan to limit demand in the economy.'), definitions: [{ term: 'contractionary monetary policy', meaning: 'A general term for measures intended to reduce demand in an economy.' }] };
  assert.equal(normalizeAssistance(raw, text, 'explain').source, 'cloud');
  assert.ok(assistancePrompt(text, 'explain').includes('GENERAL terminology'));
});
for (const [before, after] of [
  ['The drug may cause pain', 'The drug causes pain'], ['Patients report permanent pain', 'Patients have lasting discomfort'],
  ['Doctors say treatment causes pain', 'Doctors say treatment prevents pain'], ['The bill is £2 million', 'The bill is £3 million'],
  ["'I was scared', Maya Patel said", 'Maya Patel said she was concerned'], ['Investigators found no evidence', 'Investigators found evidence'],
]) test(`explanation rejects lost protected facts: ${before}`, () => assert.throws(() => normalizeAssistance(answer(after), before, 'explain')));
test('missing context and copied definition evidence are required', () => {
  const original = 'Council approves repairs';
  assert.throws(() => normalizeAssistance({ ...answer(original), missing_context: '' }, original, 'explain'));
  assert.throws(() => normalizeAssistance({ ...answer(original), definitions: [{ term: 'inflation', meaning: 'A general definition' }] }, original, 'explain'));
});
test('manual rewrite request uses the existing semantic gate, not a more permissive path', () => {
  const original = "School anxiety is harming children's futures";
  const result = normalizeAssistance({ source: 'cloud', honest_rewrite: original.replace('harming', 'affecting') }, original, 'rewrite', 'fear');
  assert.equal(result.honest_rewrite, original); assert.equal(result.rewriteReason, 'semantic_change_risk');
  const safe = "Click to find out: Doctors say treatment may cause pain";
  assert.equal(normalizeAssistance({ source: 'on-device', honest_rewrite: safe.replace('Click to find out: ', '') }, safe, 'rewrite', 'fear').rewriteReason, 'alternative');
});
test('mock and unknown sources cannot be used for assistance', () => {
  for (const source of ['mock', undefined, 'guessed']) assert.throws(() => normalizeAssistance({ ...answer('Headline'), source }, 'Headline', 'explain'));
});

test('the SDK-backed assistance path uses explicit schemas and metadata, not a separate API client', async () => {
  const { createHeadlineEngine } = await import('../src/engine/inference.js');
  let auth = 0, config;
  const text = 'The bank announces a policy';
  const engine = createHeadlineEngine({ getAi: async () => { auth++; return {}; }, getDeviceAi: () => ({}),
    InferenceMode: { ONLY_ON_DEVICE: 'local', PREFER_ON_DEVICE: 'hybrid' }, cloudModel: 'test-model', lang: [],
    assistantCloudSchemas: { explain: { controlled: 'cloud-schema' } }, assistantDeviceSchemas: { explain: { controlled: 'device-schema' } },
    getGenerativeModel: (_ai, c) => { config = c; return { generateContent: async () => ({ response: { inferenceSource: 'on_device', text: () => JSON.stringify(answer(text)) } }) }; } });
  const result = await engine.assistHeadline(text, { localOnly: true, task: 'explain' });
  assert.equal(auth, 0); assert.equal(result.source, 'on-device'); assert.equal(config.mode, 'local');
  assert.deepEqual(config.onDeviceParams.promptOptions.responseConstraint, { controlled: 'device-schema' });
});

test('added negation or unsupported certainty cannot pass an explanation guard', () => {
  for (const [before, after] of [['The plan causes pain', 'The plan never causes pain'], ['The plan could help', 'The plan will help']]) {
    assert.throws(() => normalizeAssistance(answer(after), before, 'explain'));
  }
});

test('assistance App Check errors stay honest failures without a mock fallback', async () => {
  const { createHeadlineEngine } = await import('../src/engine/inference.js');
  const engine = createHeadlineEngine({ getAi: async () => { throw { code: 'ai/app-check-error', message: 'App Check rejected' }; } });
  await assert.rejects(engine.assistHeadline('Headline', { localOnly: false, task: 'explain' }), error => error.code === 'debait/app-check');
});

test('the model cannot invent verification claims in an explanation', () => {
  assert.throws(() => normalizeAssistance(answer('The report is verified.'), 'The report was published', 'explain'));
});

test('a missing-context disclaimer can state that a headline has not been independently verified', () => {
  const original = 'Council approves repairs';
  const result = normalizeAssistance({ ...answer(original), missing_context: 'The headline has not been independently verified by this explanation.' }, original, 'explain');
  assert.ok(result.missing_context.includes('not been'));
});

test('an explanation cannot soften a factual severity claim', () => {
  assert.throws(() => normalizeAssistance(answer('Skipping a check could leave mild symptoms unnoticed'), 'Skipping a check could leave serious symptoms unnoticed', 'explain'));
});
