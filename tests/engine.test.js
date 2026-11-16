import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/engine/runtime.js';
import { isDemoBuild } from '../src/engine/mode.js';
import { normalizeResult } from '../src/engine/contract.js';

const result = source => ({ kind: 'fear', score: 50, triggers: [{ word: 'headline', why: 'Controlled evidence fixture; not a classification accuracy claim' }], honest_rewrite: 'A calmer headline', source });
const opts = { localOnly: false };
function fixture(overrides = {}, options = {}) {
  let mocks = 0, real = 0;
  const firebaseEngine = {
    scoreHeadlines: async () => { real++; return [result('cloud')]; },
    getStatus: async () => ({ ready: true, source: 'on-device', message: 'Nano available' }),
    initDeviceModel: async () => ({ ready: true }),
    ...overrides,
  };
  const mockEngine = {
    scoreHeadlines: async () => { mocks++; return [result('mock')]; },
    getStatus: async () => ({ ready: true, source: 'mock', message: 'Mock engine' }),
  };
  return { engine: createEngine({ firebaseEngine, mockEngine, ...options }), counts: () => ({ mocks, real }) };
}

test('first normal request uses real engine, never probes or returns mock', async () => {
  const { engine, counts } = fixture();
  assert.equal((await engine.scoreHeadlines(['headline'], opts))[0].source, 'cloud');
  assert.deepEqual(counts(), { real: 1, mocks: 0 });
});
for (const message of ['App Check 403', 'Network unavailable', 'Invalid JSON']) {
  test(`${message} propagates as failure, with no mock result`, async () => {
    const { engine, counts } = fixture({ scoreHeadlines: async () => { throw new Error(message); } });
    await assert.rejects(engine.scoreHeadlines(['headline'], opts), { message });
    const status = await engine.getStatus(opts);
    assert.equal(status.ready, false);
    assert.equal(status.source, 'none');
    assert.ok(status.message.includes(message));
    assert.equal(status.needsAppCheck, message === 'App Check 403');
    assert.equal(counts().mocks, 0);
  });
}

test('timeout returns an honest error; a late answer cannot replace it', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const { engine, counts } = fixture({ scoreHeadlines: () => pending }, { timeoutMs: 10 });
  await assert.rejects(engine.scoreHeadlines(['headline'], opts), /timed out/);
  resolve([result('cloud')]);
  assert.equal((await engine.getStatus(opts)).source, 'none');
  assert.equal(counts().mocks, 0);
});

test('successful retry clears the previous error', async () => {
  let fail = true;
  const { engine } = fixture({ scoreHeadlines: async () => {
    if (fail) throw new Error('offline');
    return [result('cloud')];
  } });
  await assert.rejects(engine.scoreHeadlines(['headline'], opts));
  fail = false;
  await engine.scoreHeadlines(['headline'], opts);
  assert.equal((await engine.getStatus(opts)).ready, true);
});

test('mock requires both explicit demo build switches', () => {
  for (const env of [undefined, {}, { MODE: 'demo' }, { MODE: 'production', VITE_DEBAIT_ENGINE: 'mock' }]) {
    assert.equal(isDemoBuild(env), false);
  }
  assert.equal(isDemoBuild({ MODE: 'demo', VITE_DEBAIT_ENGINE: 'mock' }), true);
});

test('explicit demo mode remains visibly mock', async () => {
  const { engine, counts } = fixture({}, { demo: true });
  assert.equal((await engine.scoreHeadlines(['headline'], opts))[0].source, 'mock');
  assert.equal((await engine.getStatus(opts)).source, 'mock');
  assert.deepEqual(counts(), { mocks: 1, real: 0 });
});

test('Local Only bypasses demo engine and accepts only device results', async () => {
  const { engine, counts } = fixture({ scoreHeadlines: async (_texts, options) => {
    assert.equal(options.localOnly, true);
    return [result('on-device')];
  } }, { demo: true });
  assert.equal((await engine.scoreHeadlines(['headline'], { localOnly: true }))[0].source, 'on-device');
  assert.equal(counts().mocks, 0);
});

test('Local Only fails without Nano instead of using cloud or mock', async () => {
  const { engine, counts } = fixture({ getStatus: async () => ({ source: 'none', message: 'Nano unavailable' }) });
  await assert.rejects(engine.scoreHeadlines(['headline'], { localOnly: true }), /LOCAL_ONLY.*Nano unavailable/);
  assert.deepEqual(counts(), { real: 0, mocks: 0 });
});

for (const response of [[], [result('mock')], [result(undefined)], [{ source: 'cloud' }]]) {
  test(`invalid real result fails instead of becoming Clean: ${JSON.stringify(response)}`, async () => {
    const { engine } = fixture({ scoreHeadlines: async () => response });
    await assert.rejects(engine.scoreHeadlines(['headline'], opts));
    assert.equal((await engine.getStatus(opts)).ready, false);
  });
}

test('Local Only rejects a cloud answer even if device availability was reported', async () => {
  const { engine } = fixture();
  await assert.rejects(engine.scoreHeadlines(['headline'], { localOnly: true }), /invalid inference source/);
});

test('normalizer cannot turn an absent answer into a fake clean classification', () => {
  assert.throws(() => normalizeResult(undefined, 'headline'), /No classification/);
});

test('failure status retains Nano download capability for the existing popup button', async () => {
  const { engine } = fixture({ scoreHeadlines: async () => { throw new Error('App Check failure'); },
    getStatus: async () => ({ source: 'none', ready: false, canDownloadDevice: true }) });
  await assert.rejects(engine.scoreHeadlines(['headline'], opts));
  assert.equal((await engine.getStatus(opts)).canDownloadDevice, true);
});

test('an old cloud error does not overwrite the status after switching to Local Only', async () => {
  const { engine } = fixture({ scoreHeadlines: async () => { throw new Error('App Check failure'); },
    getStatus: async () => ({ source: 'none', ready: false, deviceAvailable: true, message: 'Nano available, not verified' }) });
  await assert.rejects(engine.scoreHeadlines(['headline'], opts));
  assert.equal((await engine.getStatus({ localOnly: true })).message, 'Nano available, not verified');
});
