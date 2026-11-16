import test from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY_POLICY_VERSION } from '../src/engine/qualityPolicy.js';
import { readFile } from 'node:fs/promises';

const tick = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const result = (source, text = 'headline') => ({ kind: 'fear', score: 50, triggers: [{ word: text, why: 'Controlled evidence fixture; not a classification accuracy claim' }], honest_rewrite: 'Calmer headline', source });
let serial = 0;
async function fixture(t, { localOnly = false, voice = false, cache = [], engine, contexts = true, create, statsVersion = 2, stats = {}, demo = false, debug = false, scoreCacheVersion = QUALITY_POLICY_VERSION } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const data = { settings: { localOnly, voice }, scoreCache: cache, scoreCacheVersion, appCheckDebugToken: 'test-only', statsVersion, stats };
  let router, onSettings;
  const messages = [], tabs = [];
  let closed = 0;
  globalThis.self = { addEventListener() {} };
  globalThis.chrome = {
    management: { getSelf: async () => ({ installType: 'development' }) },
    runtime: {
      id: 'test',
      getManifest: () => debug ? {} : ({ update_url: 'https://example.com/update' }),
      onInstalled: { addListener() {} },
      getURL: p => `chrome-extension://test/${p}`,
      getContexts: async () => contexts ? [{}] : [],
      onMessage: { addListener: fn => { router = fn; } },
      sendMessage: async msg => {
        messages.push(msg);
        if (msg.type === 'debait/engine-ready') return { ok: true, ready: true };
        if (msg.type === 'debait/mic-state') return { state: 'granted' };
        if (msg.type === 'debait/score') return engine ? engine(msg) : { ok: true, results: msg.texts.map(text => result(msg.localOnly ? 'on-device' : 'cloud', text)) };
        return { ok: true };
      },
    },
    storage: {
      local: {
        get: async key => ({ [key]: structuredClone(data[key]) }),
        remove: async key => { delete data[key]; },
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
  if (debug) {
    // A minimal asynchronous IDB read of a synthetic already-persisted credential.
    globalThis.indexedDB = { open() {
      const request = {};
      queueMicrotask(() => {
        request.result = { close() {}, transaction: () => ({ objectStore: () => ({ get: () => {
          const read = {};
          queueMicrotask(() => { read.result = 'test-only-debug'; read.onsuccess(); });
          return read;
        } }) }) };
        request.onsuccess();
      });
      return request;
    } };
  }
  if (demo || debug) {
    // Simulate Vite's explicit demo constant while exercising the real worker/recorder.
    const url = new URL('../src/background/sw.js', import.meta.url);
    let source = await readFile(url, 'utf8');
    const modeImport = "import { DEMO_MODE } from '../engine/mode.js';";
    assert.ok(source.includes(modeImport));
    source = source.replace(modeImport, `const DEMO_MODE = ${demo};`)
      .replaceAll('import.meta.env', debug ? JSON.stringify({ MODE: 'development', VITE_DEBAIT_APP_CHECK: 'debug' }) : 'undefined')
      .replace(/from '(\.[^']+)'/g, (_, path) => `from '${new URL(path, url).href}'`);
    await import(`data:text/javascript,${encodeURIComponent(source)}#test=${serial++}`);
  } else {
    await import(`../src/background/sw.js?test=${serial++}`);
  }
  await tick(); // Let the real statistics-version migration finish.
  const send = (msg, host = 'example.com') => new Promise(resolve => router(msg, { tab: { id: 1, url: `https://${host}` } }, resolve));
  const settings = patch => chrome.storage.local.set({ settings: { ...data.settings, ...patch } });
  const sendPopup = msg => new Promise(resolve => router(msg, { url: chrome.runtime.getURL('src/popup/index.html') }, resolve));
  const sendOffscreen = msg => new Promise(resolve => router(msg, { id: chrome.runtime.id, url: chrome.runtime.getURL('src/offscreen/index.html') }, resolve));
  return { send, sendPopup, sendOffscreen, settings, data, messages, tabs, closed: () => closed };
}

test('Local Only re-scores cached cloud and legacy mock answers on device', async t => {
  const f = await fixture(t, { localOnly: true, cache: [['cloud', result('cloud')], ['mock', result('mock')]] });
  const res = await f.send({ type: 'debait/score', texts: ['cloud', 'mock'] });
  assert.equal(res.ok, true); assert.equal(res.cacheHits, 0);
  assert.deepEqual(res.results.map(r => r.source), ['on-device', 'on-device']);
  assert.equal(f.messages.find(m => m.type === 'debait/score').localOnly, true);
});

test('Local Only can reuse a genuine device cache entry without inference', async t => {
  const f = await fixture(t, { localOnly: true, cache: [['device', result('on-device', 'device')]] });
  const res = await f.send({ type: 'debait/score', texts: ['device'] });
  assert.equal(res.ok, true); assert.equal(res.cacheHits, 1);
  assert.equal(f.messages.length, 0);
});

test('unavailable local model never returns an old cloud cached result or statistics', async t => {
  const f = await fixture(t, { localOnly: true, cache: [['headline', result('cloud')]], engine: async () => ({ ok: false, error: 'LOCAL_ONLY: Nano unavailable' }) });
  const res = await f.send({ type: 'debait/score', texts: ['headline'] });
  assert.equal(res.ok, false); assert.match(res.error, /Nano unavailable/);
  assert.equal(res.results, undefined); assert.deepEqual(f.data.stats, {});
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
    assert.deepEqual(f.data.stats, {});
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
  assert.deepEqual(f.data.scoreCache, []); assert.deepEqual(f.data.stats, {});
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

test('the same real headline counts once across cache hits, repeat visits and hosts', async t => {
  const f = await fixture(t);
  const first = await f.send({ type: 'debait/score', texts: ['Headline A', 'Headline A'] });
  assert.equal(first.ok, true);
  const second = await f.send({ type: 'debait/score', texts: ['Headline A'] }, 'another.example');
  assert.equal(second.ok, true); assert.equal(second.cacheHits, 1);
  await tick();
  const [day] = Object.values(f.data.stats);
  assert.equal(day.total, 1); assert.equal(day.fear, 1);
  assert.deepEqual(day.sources, { 'example.com': 1 });
  assert.equal(day.seen.length, 1);
});

test('different real headlines count independently, including cached on-device results', async t => {
  const f = await fixture(t, { localOnly: true, cache: [['Headline A', result('on-device', 'Headline A')]] });
  const response = await f.send({ type: 'debait/score', texts: ['Headline A', 'Headline B', 'Headline B'] });
  assert.equal(response.ok, true); assert.equal(response.cacheHits, 2);
  await tick();
  const [day] = Object.values(f.data.stats);
  assert.equal(day.total, 2); assert.equal(day.fear, 2);
  assert.equal(day.seen.length, 2);
});

test('a mixed real/mock batch is rejected without adding any reading statistics', async t => {
  const f = await fixture(t, { engine: async () => ({ ok: true, results: [result('cloud'), result('mock')] }) });
  const response = await f.send({ type: 'debait/score', texts: ['Real headline', 'Mock headline'] });
  await tick();
  assert.equal(response.ok, false); assert.match(response.error, /Mock results are disabled/);
  assert.deepEqual(f.data.stats, {}); assert.deepEqual(f.data.scoreCache, []);
});

test('legacy mock cache entries are replaced with real analysis before being counted', async t => {
  const f = await fixture(t, { cache: [['Headline A', result('mock', 'Headline A')]] });
  const response = await f.send({ type: 'debait/score', texts: ['Headline A'] });
  await tick();
  assert.equal(response.ok, true); assert.equal(response.results[0].source, 'cloud');
  assert.equal(f.messages.filter(msg => msg.type === 'debait/score').length, 1);
  const [day] = Object.values(f.data.stats);
  assert.equal(day.total, 1);
});

test('a rejected Local Only request leaves existing real statistics untouched', async t => {
  const stats = { '2026-11-01': { total: 3, fear: 3, seen: ['existing'] } };
  const f = await fixture(t, { localOnly: true, stats: structuredClone(stats), cache: [['headline', result('cloud')]],
    engine: async () => ({ ok: false, error: 'LOCAL_ONLY: Nano unavailable' }) });
  const response = await f.send({ type: 'debait/score', texts: ['headline'] });
  await tick();
  assert.equal(response.ok, false); assert.deepEqual(f.data.stats, stats);
});

test('the teammate statistics migration clears old mixed counts and marks version 2', async t => {
  const f = await fixture(t, { statsVersion: 1, stats: { '2026-11-01': { total: 99 } } });
  assert.equal(f.data.statsVersion, 2); assert.deepEqual(f.data.stats, {});
});

test('current-version statistics survive service worker initialization', async t => {
  const stats = { '2026-11-01': { total: 3, fear: 3, seen: ['existing'] } };
  const f = await fixture(t, { statsVersion: 2, stats: structuredClone(stats) });
  assert.deepEqual(f.data.stats, stats);
});

test('explicit demo results are displayed but never counted or cached as genuine analysis', async t => {
  const f = await fixture(t, { demo: true, engine: async () => ({ ok: true, results: [result('mock', 'Mock headline')] }) });
  const response = await f.send({ type: 'debait/score', texts: ['Mock headline'] });
  await tick();
  assert.equal(response.ok, true); assert.equal(response.results[0].source, 'mock');
  const [day] = Object.values(f.data.stats);
  assert.equal(day.total, 0); assert.equal(day.fear, 0);
  assert.deepEqual(day.sources, {}); assert.deepEqual(day.seen, []);
  assert.deepEqual(f.data.scoreCache, []);
});

test('normal builds remove legacy debug credentials and never return them with status', async t => {
  const f = await fixture(t);
  const response = await f.send({ type: 'debait/status' });
  assert.equal(response.debugToken, undefined);
  assert.equal(f.data.appCheckDebugToken, undefined);
  assert.ok(f.messages.every(message => message.debugToken === undefined));
});

test('an explicit unpacked debug build shares its synthetic setup credential only with the popup', async t => {
  const f = await fixture(t, { debug: true });
  const websiteResponse = await f.send({ type: 'debait/status' });
  assert.equal(websiteResponse.debugToken, undefined);
  const popupResponse = await f.sendPopup({ type: 'debait/status' });
  assert.equal(popupResponse.debugToken, 'test-only-debug');
  assert.equal(f.data.appCheckDebugToken, undefined);
});

test('the service worker uses getSelf to answer the authenticated offscreen installation query', async t => {
  const f = await fixture(t);
  let queried = false;
  chrome.management.getSelf = async () => { queried = true; return { installType: 'development' }; };
  const response = await f.sendOffscreen({ type: 'debait/installation-type' });
  assert.equal(queried, true); assert.deepEqual(response, { ok: true, installType: 'development', hasUpdateUrl: true });
});

test('website content scripts cannot supply or obtain trusted installation metadata', async t => {
  const f = await fixture(t);
  const response = await f.send({ type: 'debait/installation-type', installType: 'development' });
  assert.equal(response.ok, false); assert.equal(response.installType, undefined);
});

for (const version of [undefined, 'old-policy', 'quality-semantic-prefix-v3']) {
  test(`outdated quality cache is invalidated before reuse: ${version}`, async t => {
    const stats = { '2026-11-01': { total: 3, fear: 3, seen: ['existing'] } };
    const f = await fixture(t, { scoreCacheVersion: version === undefined ? null : version,
      cache: [['headline', { ...result('cloud'), honest_rewrite: 'Old misleading rewrite' }]], stats });
    if (version === undefined) delete f.data.scoreCacheVersion;
    const response = await f.send({ type: 'debait/score', texts: ['headline'] });
    assert.equal(response.ok, true); assert.equal(response.cacheHits, 0);
    assert.equal(response.results[0].honest_rewrite, 'headline');
    assert.equal(response.results[0].rewriteReason, 'semantic_change_risk');
    assert.equal(f.data.scoreCacheVersion, QUALITY_POLICY_VERSION);
    assert.deepEqual(f.data.scoreCache, []);
    assert.deepEqual(f.data.stats['2026-11-01'], stats['2026-11-01']);
    t.mock.timers.tick(1000); await tick();
    assert.equal(f.data.scoreCache[0][1].honest_rewrite, 'headline');
    assert.equal(f.data.scoreCacheVersion, QUALITY_POLICY_VERSION);
  });
}

test('current-policy cache entries remain reusable', async t => {
  const f = await fixture(t, { cache: [['headline', result('cloud')]] });
  const response = await f.send({ type: 'debait/score', texts: ['headline'] });
  assert.equal(response.ok, true); assert.equal(response.cacheHits, 1);
  assert.ok(!f.messages.some(message => message.type === 'debait/score'));
});

test('concurrent tabs share in-flight analysis of the same headline, then reuse cache', async t => {
  const pending = deferred(); let calls = 0;
  const f = await fixture(t, { engine: async () => { calls++; return pending.promise; } });
  const first = f.send({ type: 'debait/score', texts: ['same headline'] });
  const second = f.send({ type: 'debait/score', texts: ['same headline'] }, 'another.example');
  await tick(); assert.equal(calls, 1);
  pending.resolve({ ok: true, results: [result('cloud')] });
  assert.equal((await first).ok, true); assert.equal((await second).ok, true);
  const third = await f.send({ type: 'debait/score', texts: ['same headline'] });
  assert.equal(third.cacheHits, 1); assert.equal(calls, 1);
});

test('distinct concurrent tab batches are deferred centrally, not submitted together', async t => {
  const pending = deferred(); let calls = 0;
  const f = await fixture(t, { engine: async () => { calls++; return pending.promise; } });
  const first = f.send({ type: 'debait/score', texts: ['first headline'] }); await tick();
  const second = await f.send({ type: 'debait/score', texts: ['second headline'] }, 'another.example');
  assert.equal(second.ok, false); assert.equal(second.code, 'debait/quota-pacing'); assert.ok(second.retryAt > Date.now());
  assert.equal(second.results, undefined); assert.equal(calls, 1);
  pending.resolve({ ok: true, results: [result('cloud')] }); await first;
});

test('429 propagates a shared cooldown across tabs without caching failures or counting Clean', async t => {
  let calls = 0;
  const f = await fixture(t, { engine: async () => { calls++; return { ok: false, error: 'Gemini is rate limited', code: 'debait/quota', retryAfterMs: 120000 }; } });
  const first = await f.send({ type: 'debait/score', texts: ['limited headline'] });
  assert.equal(first.ok, false); assert.equal(first.code, 'debait/quota'); assert.ok(first.retryAt >= Date.now() + 120000);
  const second = await f.send({ type: 'debait/score', texts: ['another headline'] });
  assert.equal(second.ok, false); assert.equal(second.results, undefined); assert.equal(calls, 1);
  assert.deepEqual(f.data.scoreCache, []); assert.deepEqual(f.data.stats, {});
});

test('Local Only bypasses the cloud pacing gate and preserves device-source reporting', async t => {
  const f = await fixture(t, { localOnly: true });
  for (const text of ['first local headline', 'second local headline']) {
    const response = await f.send({ type: 'debait/score', texts: [text] });
    assert.equal(response.ok, true); assert.equal(response.results[0].source, 'on-device');
  }
  assert.equal(f.data.aiRequestBudget, undefined);
});


test('unsupported classification is neither cached nor counted as a reading result', async t => {
  const f = await fixture(t, { engine: async () => ({ ok: true, results: [{ ...result('cloud'), triggers: [] }] }) });
  const response = await f.send({ type: 'debait/score', texts: ['headline'] });
  assert.equal(response.ok, false);
  assert.match(response.error, /No classification was produced/);
  assert.equal(response.results, undefined);
  t.mock.timers.tick(1000); await tick();
  assert.deepEqual(f.data.scoreCache, []);
  assert.deepEqual(f.data.stats, {});
});

test('invalid current-policy cached evidence is reanalyzed rather than reused', async t => {
  const f = await fixture(t, { cache: [['headline', { ...result('cloud'), triggers: [] }]] });
  const response = await f.send({ type: 'debait/score', texts: ['headline'] });
  assert.equal(response.ok, true); assert.equal(response.cacheHits, 0);
  assert.equal(f.messages.filter(msg => msg.type === 'debait/score').length, 1);
  assert.ok(response.results[0].triggers.length);
});
