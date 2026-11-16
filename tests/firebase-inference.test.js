import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeadlineEngine } from '../src/engine/inference.js';
import { createEngine } from '../src/engine/runtime.js';

const item = { kind: 'clean', score: 0, triggers: [], honest_rewrite: 'A factual headline' };
const modes = { ONLY_ON_DEVICE: 'only_on_device', PREFER_ON_DEVICE: 'prefer_on_device' };
function fixture({ source = 'in_cloud', data = { results: [item] }, error, availability = 'available' } = {}) {
  const calls = { auth: 0, device: 0, generate: 0 };
  let parameters, requestOptions;
  const engine = createHeadlineEngine({
    getAi: async () => { calls.auth++; return 'authenticated-sdk-client'; },
    getDeviceAi: () => { calls.device++; return 'device-sdk-client'; },
    getGenerativeModel: (ai, config) => {
      parameters = { ai, ...config };
      return { generateContent: async (_text, options) => {
        requestOptions = options;
        calls.generate++; if (error) throw error;
        return { response: { inferenceSource: source, text: () => typeof data === 'string' ? data : JSON.stringify(data) } };
      } };
    },
    InferenceMode: modes, cloudModel: 'test-model', cloudSchema: {}, deviceSchema: {}, lang: [],
    prompt: texts => JSON.stringify(texts), deviceAvailability: async () => availability,
    createDevice: async () => ({ destroy() {} }),
  });
  return { engine, calls, parameters: () => parameters, requestOptions: () => requestOptions };
}

test('normal operation authenticates before Firebase generateContent and uses hybrid mode', async () => {
  const f = fixture();
  const results = await f.engine.scoreHeadlines(['headline'], { localOnly: false });
  assert.equal(f.calls.auth, 1); assert.equal(f.calls.generate, 1); assert.equal(f.calls.device, 0);
  assert.equal(f.parameters().ai, 'authenticated-sdk-client');
  assert.equal(f.parameters().mode, modes.PREFER_ON_DEVICE);
  assert.equal(f.parameters().inCloudParams.model, 'test-model');
  assert.equal(results[0].source, 'cloud');
});

test('Local Only uses ONLY_ON_DEVICE without requesting App Check/cloud access', async () => {
  const f = fixture({ source: 'on_device' });
  const results = await f.engine.scoreHeadlines(['headline'], { localOnly: true });
  assert.equal(f.calls.auth, 0); assert.equal(f.calls.device, 1);
  assert.equal(f.parameters().mode, modes.ONLY_ON_DEVICE);
  assert.equal(results[0].source, 'on-device');
});

test('model response metadata, not a payload field, determines source', async () => {
  const f = fixture({ source: 'on_device', data: { results: [{ ...item, source: 'cloud' }] } });
  assert.equal((await f.engine.scoreHeadlines(['headline'], { localOnly: false }))[0].source, 'on-device');
});

for (const scenario of [{ source: undefined }, { source: 'guessed_cloud' }, { data: { results: [] } },
  { data: 'not json' }, { data: { results: [{ kind: 'clean' }] } }]) {
  test(`invalid/absent model response is rejected: ${JSON.stringify(scenario)}`, async () => {
    const f = fixture({ ...scenario, source: Object.hasOwn(scenario, 'source') ? scenario.source || null : 'in_cloud' });
    await assert.rejects(f.engine.scoreHeadlines(['headline'], { localOnly: false }));
    assert.equal((await f.engine.getStatus({ localOnly: false })).source, 'none');
  });
}

test('an unexpected cloud source in Local Only is an error, never relabeled on-device', async () => {
  const f = fixture();
  await assert.rejects(f.engine.scoreHeadlines(['headline'], { localOnly: true }));
});

test('Nano availability is not reported as successful inference', async () => {
  const f = fixture(); const status = await f.engine.getStatus({ localOnly: true });
  assert.equal(status.source, 'none'); assert.equal(status.ready, false);
  assert.equal(status.deviceAvailable, true); assert.match(status.message, /not been verified/);
});

test('Priority 1 runtime can use available Nano without claiming prior verified inference', async () => {
  const f = fixture({ source: 'on_device' });
  const runtime = createEngine({ firebaseEngine: f.engine, mockEngine: { scoreHeadlines() { throw new Error('mock forbidden'); } } });
  const results = await runtime.scoreHeadlines(['headline'], { localOnly: true });
  assert.equal(results[0].source, 'on-device'); assert.equal(f.calls.auth, 0);
});

test('successful SDK response updates status to its actual source', async () => {
  const f = fixture();
  assert.equal((await f.engine.getStatus({ localOnly: false })).source, 'none');
  await f.engine.scoreHeadlines(['headline'], { localOnly: false });
  const status = await f.engine.getStatus({ localOnly: false });
  assert.equal(status.source, 'cloud'); assert.equal(status.ready, true);
  assert.equal((await f.engine.getStatus({ localOnly: true })).source, 'none');
});

test('model access failure is actionable and never treated as App Check approval or success', async () => {
  const f = fixture({ error: { code: 'ai/fetch-error', customData: { httpErrorCode: 404 } } });
  await assert.rejects(f.engine.scoreHeadlines(['headline'], { localOnly: false }), error => {
    assert.equal(error.code, 'debait/model'); assert.equal(error.needsAppCheck, false); return true;
  });
  assert.equal((await f.engine.getStatus({ localOnly: false })).ready, false);
});

test('the installed Firebase integration fails closed with unconfigured production authentication', async () => {
  // Loads the real installed SDK. This verifies a negative path only, not Firebase success.
  const { getAi } = await import('../src/engine/firebaseEngine.js');
  await assert.rejects(getAi(), error => {
    assert.equal(error.code, 'debait/app-check-setup'); assert.match(error.message, /installation|trusted App Check/); return true;
  });
});

test('cloud requests receive SDK-supported timeout and AbortSignal controls', async () => {
  const f = fixture();
  await f.engine.scoreHeadlines(['headline'], { localOnly: false });
  assert.equal(f.requestOptions().timeout, 25000);
  assert.ok(f.requestOptions().signal instanceof AbortSignal);
});

test('late authentication after the deadline cannot submit a new cloud inference request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve, calls = 0;
  const engine = createHeadlineEngine({ getAi: () => new Promise(r => { resolve = r; }),
    getGenerativeModel: () => { calls++; throw new Error('must not submit'); } });
  const operation = engine.scoreHeadlines(['headline'], { localOnly: false });
  t.mock.timers.tick(25000); resolve({});
  await assert.rejects(operation); assert.equal(calls, 0);
});

test('rewrite provenance is computed internally, not trusted from generated JSON', async () => {
  const original = "'It felt like I was dying': Why some teenagers don't go to school";
  const f = fixture({ data: { results: [{ kind: 'fear', score: 65, triggers: [], honest_rewrite: original, rewriteReason: 'preservation_guard' }] } });
  const [result] = await f.engine.scoreHeadlines([original], { localOnly: false });
  assert.equal(result.rewriteReason, 'model_unchanged');
});
