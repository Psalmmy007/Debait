import test from 'node:test';
import assert from 'node:assert/strict';

const tick = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const result = source => ({ kind: 'fear', score: 50, triggers: [], honest_rewrite: 'Calmer headline', source });
let serial = 0;
async function fixture(t, { localOnly = false, voice = false, cache = [], engine, contexts = true, create } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const data = { settings: { localOnly, voice }, scoreCache: cache, appCheckDebugToken: 'test-only' };
  let router, onSettings;
  const messages = [], tabs = [];
  let closed = 0;
  globalThis.chrome = {
    runtime: {
      getURL: p => `chrome-extension://test/${p}`,
      getContexts: async () => contexts ? [{}] : [],
      onMessage: { addListener: fn => { router = fn; } },
      sendMessage: async msg => {
        messages.push(msg);
        if (msg.type === 'debait/mic-state') return { state: 'granted' };
        if (msg.type === 'debait/score') return engine ? engine(msg) : { ok: true, results: msg.texts.map(() => result(msg.localOnly ? 'on-device' : 'cloud')) };
        return { ok: true };
      },
    },
    storage: {
      local: {
        get: async key => ({ [key]: structuredClone(data[key]) }),
        set: async patch => {
          const oldValue = structuredClone(data.settings);
          Object.assign(data, structuredClone(patch));
          if (patch.settings) onSettings({ settings: { oldValue, newValue: structuredClone(patch.settings) } }, 'local');
        },
      },
      onChanged: { addListener: fn => { onSettings = fn; } },
    },
    offscreen: {
      createDocument: async () => { if (create) await create(); contexts = true; },
      closeDocument: async () => { closed++; contexts = false; },
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async (_id, msg) => { tabs.push(msg); return { result: {} }; },
      create: async msg => { tabs.push(msg); },
    },
  };
  await import(`../src/background/sw.js?test=${serial++}`);
  const send = msg => new Promise(resolve => router(msg, { tab: { id: 1, url: 'https://example.com' } }, resolve));
  const settings = patch => chrome.storage.local.set({ settings: { ...data.settings, ...patch } });
  return { send, settings, data, messages, tabs, closed: () => closed };
}

test('Local Only re-scores cached cloud and legacy mock answers on device', async t => {
  const f = await fixture(t, { localOnly: true, cache: [['cloud', result('cloud')], ['mock', result('mock')]] });
  const res = await f.send({ type: 'debait/score', texts: ['cloud', 'mock'] });
  assert.equal(res.ok, true); assert.equal(res.cacheHits, 0);
  assert.deepEqual(res.results.map(r => r.source), ['on-device', 'on-device']);
  assert.equal(f.messages.find(m => m.type === 'debait/score').localOnly, true);
});

test('Local Only can reuse a genuine device cache entry without inference', async t => {
  const f = await fixture(t, { localOnly: true, cache: [['device', result('on-device')]] });
  const res = await f.send({ type: 'debait/score', texts: ['device'] });
  assert.equal(res.ok, true); assert.equal(res.cacheHits, 1);
  assert.equal(f.messages.length, 0);
});

test('unavailable local model never returns an old cloud cached result or statistics', async t => {
  const f = await fixture(t, { localOnly: true, cache: [['headline', result('cloud')]], engine: async () => ({ ok: false, error: 'LOCAL_ONLY: Nano unavailable' }) });
  const res = await f.send({ type: 'debait/score', texts: ['headline'] });
  assert.equal(res.ok, false); assert.match(res.error, /Nano unavailable/);
  assert.equal(res.results, undefined); assert.equal(f.data.stats, undefined);
});

test('normal mode cannot reuse legacy mock cache entries', async t => {
  const f = await fixture(t, { cache: [['headline', result('mock')]] });
  const res = await f.send({ type: 'debait/score', texts: ['headline'] });
  assert.equal(res.results[0].source, 'cloud'); assert.equal(res.cacheHits, 0);
});

for (const response of [{ ok: false, error: 'Gemini timed out' }, { ok: true, results: [result('mock')] }, { ok: true, results: [] }]) {
  test(`engine failure/invalid result stays an error: ${JSON.stringify(response)}`, async t => {
    const f = await fixture(t, { engine: async () => response });
    const res = await f.send({ type: 'debait/score', texts: ['headline'] });
    assert.equal(res.ok, false); assert.equal(res.results, undefined);
    assert.equal(f.data.stats, undefined);
  });
}

test('cloud results finishing after a Local Only change are discarded, not cached', async t => {
  const pending = deferred();
  const f = await fixture(t, { engine: () => pending.promise });
  const request = f.send({ type: 'debait/score', texts: ['headline'] }); await tick();
  await f.settings({ localOnly: true });
  pending.resolve({ ok: true, results: [result('cloud')] });
  const res = await request;
  assert.equal(res.ok, false); assert.match(res.error, /Privacy settings changed/);
  assert.deepEqual(f.data.scoreCache, []); assert.equal(f.data.stats, undefined);
});

test('Local Only rejects a cloud response even if the engine violates the requested mode', async t => {
  const f = await fixture(t, { localOnly: true, engine: async () => ({ ok: true, results: [result('cloud')] }) });
  const res = await f.send({ type: 'debait/score', texts: ['headline'] });
  assert.equal(res.ok, false); assert.match(res.error, /LOCAL_ONLY/);
});

test('microphone permission callback cannot start cloud voice under Local Only', async t => {
  const f = await fixture(t, { localOnly: true, voice: true });
  const res = await f.send({ type: 'debait/mic-granted' });
  assert.equal(res.ok, false); assert.match(res.error, /LOCAL_ONLY/);
  assert.ok(!f.messages.some(m => m.type === 'debait/call-start'));
  const policy = await f.send({ type: 'debait/voice-allowed' });
  assert.equal(policy.allowed, false);
});

test('normal voice still starts when explicitly enabled and cloud is allowed', async t => {
  const f = await fixture(t, { voice: true });
  assert.equal((await f.send({ type: 'debait/mic-granted' })).ok, true);
  assert.ok(f.messages.some(m => m.type === 'debait/call-start'));
});

test('enabling voice while Local Only is on stops the context and resets voice', async t => {
  const f = await fixture(t, { localOnly: true });
  await f.settings({ voice: true }); await tick();
  assert.ok(!f.messages.some(m => m.type === 'debait/call-start'));
  assert.equal(f.data.settings.voice, false); assert.equal(f.closed(), 1);
});

test('enabling Local Only stops voice, destroys its context and disables the switch', async t => {
  const f = await fixture(t, { voice: true });
  await f.settings({ localOnly: true }); await tick();
  assert.ok(f.messages.some(m => m.type === 'debait/call-end'));
  assert.equal(f.closed(), 1); assert.equal(f.data.settings.voice, false);
});

test('Local Only stops sessions even when the voice flag is already false', async t => {
  const f = await fixture(t);
  await f.settings({ localOnly: true }); await tick();
  assert.equal(f.closed(), 1);
});

test('pending offscreen creation cannot start voice after Local Only is enabled', async t => {
  const creation = deferred();
  const f = await fixture(t, { voice: true, contexts: false, create: () => creation.promise });
  const request = f.send({ type: 'debait/mic-granted' }); await tick();
  await f.settings({ localOnly: true });
  creation.resolve();
  assert.equal((await request).ok, false); await tick();
  assert.ok(!f.messages.some(m => m.type === 'debait/call-start'));
  assert.equal(f.closed(), 1);
});

test('voice tools cannot retrieve page content with Local Only enabled', async t => {
  const f = await fixture(t, { localOnly: true, voice: true });
  const res = await f.send({ type: 'debait/tool', name: 'page_report' });
  assert.equal(res.ok, false); assert.equal(f.tabs.length, 0);
});
