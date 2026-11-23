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
    deviceAvailability: async () => 'available',
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

test('BBC Clean headline permits faithful explanation and exact copied terms', () => {
  const headline = "Queer Eye's chef on his favourite meals from around the world";
  const result = normalizeAssistance({ ...answer('The chef from Queer Eye shares his favourite meals from around the world.'),
    definitions: [{ term: 'chef', meaning: 'A professional cook.' }] }, headline, 'explain');
  assert.equal(result.source, 'cloud'); assert.match(result.simple_explanation, /Queer Eye/);
});
test('assistance rejection has a specific privacy-safe reason, never headline text', () => {
  const headline = 'Maya Patel says the medicine may cause pain';
  assert.throws(() => normalizeAssistance(answer('Maya Patel says the medicine will cause pain'), headline, 'explain'), error => {
    assert.equal(error.reason, 'claims'); assert.match(error.message, /protected claim/);
    assert.ok(!error.message.includes(headline)); assert.ok(!/Try again later/.test(error.message)); return true;
  });
  assert.throws(() => normalizeAssistance(answer('A chef shares favourite meals'), "Queer Eye's chef on his favourite meals", 'explain'), error => error.reason === 'details');
});
test('malformed explanation, mismatched definition and unknown source remain rejected', () => {
  const original = 'Council approves repairs';
  for (const [raw, reason] of [
    [{ ...answer(original), missing_context: '' }, 'format'],
    [{ ...answer(original), definitions: [{ term: 'inflation', meaning: 'Prices rising.' }] }, 'definition'],
    [{ ...answer(original), source: 'mock' }, 'source'],
  ]) assert.throws(() => normalizeAssistance(raw, original, 'explain'), error => error.reason === reason);
});
test('SDK response rejection is distinguished from authentication, quota and timeout, and recovery is possible', async () => {
  const { createHeadlineEngine } = await import('../src/engine/inference.js');
  const { describeAiError } = await import('../src/engine/errors.js');
  const original = 'Council approves repairs'; let calls = 0;
  const engine = createHeadlineEngine({ getAi: async () => ({}), InferenceMode: { PREFER_ON_DEVICE: 'hybrid' },
    deviceAvailability: async () => 'unavailable',
    getGenerativeModel: () => ({ generateContent: async () => { calls++; return { response: { inferenceSource: 'in_cloud', text: () => calls === 1 ? 'invalid JSON' : JSON.stringify(answer(original)) } }; } }) });
  await assert.rejects(engine.assistHeadline(original, { localOnly: false, task: 'explain' }), error => error.code === 'debait/invalid-assistance' && error.reason === 'format');
  assert.equal(calls, 1); // No automatic retry of a rejected response.
  assert.equal((await engine.assistHeadline(original, { localOnly: false, task: 'explain' })).source, 'cloud');
  assert.equal(calls, 2);
  assert.equal(describeAiError({ message: 'Gemini request timed out' }).code, 'debait/timeout');
  assert.equal(describeAiError({ customData: { httpErrorCode: 503 } }).code, 'debait/service');
  assert.equal(describeAiError({ code: 'ai/app-check-error' }).code, 'debait/app-check');
  assert.equal(describeAiError({ customData: { httpErrorCode: 429 } }).code, 'debait/quota');
  assert.ok(!describeAiError({ code: 'debait/invalid-assistance', reason: 'private-headline-or-token' }).message.includes('private-headline-or-token'));
});

test('explicit authentication and rate limits take precedence over generic timeout text', async () => {
  const { describeAiError } = await import('../src/engine/errors.js');
  assert.equal(describeAiError({ customData: { httpErrorCode: 429 }, message: 'Upstream timeout' }).code, 'debait/quota');
  assert.equal(describeAiError({ code: 'ai/app-check-error', message: 'App Check timeout' }).code, 'debait/app-check');
});

test('only known validation diagnostics can cross message boundaries', async () => {
  const { assistanceReason } = await import('../src/engine/errors.js');
  assert.equal(assistanceReason({ code: 'debait/invalid-assistance', reason: 'claims' }), 'claims');
  assert.equal(assistanceReason({ code: 'debait/invalid-assistance', reason: 'private text' }), undefined);
  assert.equal(assistanceReason({ code: 'ai/error', reason: 'claims' }), undefined);
});
