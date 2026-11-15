import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseAccess, debugAppCheckAllowed, installationType, installationTypeFromWorker } from '../src/engine/authPolicy.js';
import { aiError } from '../src/engine/errors.js';
import { createDebugTokenStore } from '../src/engine/debugTokenStore.js';

const dev = { MODE: 'development', VITE_DEBAIT_APP_CHECK: 'debug' };
function fixture(options = {}) {
  const calls = { init: 0, tokens: 0, ai: 0 };
  let provider;
  const globals = {};
  const sdk = {
    CustomProvider: class { constructor(options) { this.getToken = options.getToken; } },
    GoogleAIBackend: class {},
    initializeApp: () => { calls.init++; return {}; },
    initializeAppCheck: (_app, config) => { provider = config.provider; assert.equal(config.isTokenAutoRefreshEnabled, false); return {}; },
    getAI: () => { calls.ai++; return { realSdkAdapter: true }; },
    getToken: async () => { calls.tokens++; return { token: 'test-response-not-a-credential' }; },
  };
  const access = createFirebaseAccess({ sdk, config: {}, env: dev, manifest: {}, globals, getInstallType: async () => 'development', ...options });
  return { access, sdk, calls, globals, provider: () => provider };
}

test('App Check debug mode requires explicit development/demo intent and unpacked packaging', () => {
  assert.equal(debugAppCheckAllowed(dev, {}, 'development'), true);
  assert.equal(debugAppCheckAllowed({ ...dev, MODE: 'demo' }, {}, 'development'), true);
  for (const [env, manifest] of [[dev, { update_url: 'store' }], [dev, undefined],
    [{ ...dev, MODE: 'production' }, {}], [{ MODE: 'development' }, {}]]) {
    assert.equal(debugAppCheckAllowed(env, manifest, 'development'), false);
  }
});

test('development needs an explicitly supplied installation token; never generates one in SDK initialization', async () => {
  const f = fixture();
  await assert.rejects(f.access.getAi(), /registered debug token/);
  assert.equal(f.calls.init, 0); assert.equal(f.globals.FIREBASE_APPCHECK_DEBUG_TOKEN, undefined);
});

test('debug flag is set before initialization and App Check is checked before AI access is returned', async () => {
  const f = fixture();
  f.sdk.initializeApp = () => { assert.equal(f.globals.FIREBASE_APPCHECK_DEBUG_TOKEN, 'test-installation'); return {}; };
  assert.equal((await f.access.getAi('test-installation')).realSdkAdapter, true);
  assert.equal(f.calls.tokens, 1);
  await assert.rejects(f.provider().getToken(), /debug mode was not activated/);
});

test('App Check exchange rejection prevents returning the AI client', async () => {
  const f = fixture(); f.sdk.getToken = async () => { throw Object.assign(new Error('rejected'), { code: 'appCheck/fetch-status-error' }); };
  await assert.rejects(f.access.getAi('test-installation'), /rejected/);
});

for (const value of [undefined, {}, { token: '' }, { token: 'dummy', error: new Error('failed') }]) {
  test(`missing/dummy App Check response fails closed: ${JSON.stringify(value)}`, async () => {
    const f = fixture(); f.sdk.getToken = async () => value;
    await assert.rejects(f.access.getAi('test-installation'), /valid token/);
  });
}

test('failed token exchange can recover on retry without silently changing the installation token', async () => {
  const f = fixture(); let fail = true;
  f.sdk.getToken = async () => { if (fail) throw new Error('offline'); return { token: 'test-response' }; };
  await assert.rejects(f.access.getAi('test-installation'));
  fail = false; assert.ok(await f.access.getAi('test-installation'));
  await assert.rejects(f.access.getAi('different-test-installation'), /changed/);
});

test('production without a trusted issuer fails before SDK initialization', async () => {
  const f = fixture({ env: { MODE: 'production', VITE_DEBAIT_APP_CHECK: 'debug' } });
  await assert.rejects(f.access.getAi('test-installation'), /production-mode build/);
  assert.equal(f.calls.init, 0); assert.equal(f.globals.FIREBASE_APPCHECK_DEBUG_TOKEN, undefined);
});

test('production rejects a pre-existing global debug flag', async () => {
  const f = fixture({ env: { MODE: 'production' }, globals: { FIREBASE_APPCHECK_DEBUG_TOKEN: true } });
  await assert.rejects(f.access.getAi(), /forbidden/);
  assert.equal(f.calls.init, 0);
});

test('production CustomProvider accepts only unexpired tokens supplied by a trusted external adapter', async () => {
  const issued = { token: 'test-issued-token', expireTimeMillis: Date.now() + 60000 };
  const f = fixture({ env: { MODE: 'production' }, productionProvider: { getToken: async () => issued } });
  await f.access.getAi();
  assert.deepEqual(await f.provider().getToken(), issued);
  assert.equal(f.globals.FIREBASE_APPCHECK_DEBUG_TOKEN, undefined);
});

for (const issued of [{ token: 'test', expireTimeMillis: 0 }, { expireTimeMillis: Date.now() + 60000 }]) {
  test('production provider rejects expired or absent tokens', async () => {
    const f = fixture({ env: { MODE: 'production' }, productionProvider: { getToken: async () => issued } });
    f.sdk.getToken = async () => f.provider().getToken();
    await assert.rejects(f.access.getAi(), /invalid or expired/);
  });
}

for (const [error, code] of [
  [{ code: 'appCheck/fetch-status-error', message: 'private-provider-payload' }, 'debait/app-check'],
  [{ message: 'HTTP 401 private-provider-payload' }, 'debait/auth'],
  [{ message: 'HTTP 403 private-provider-payload' }, 'debait/access'],
  [{ customData: { httpErrorCode: 404 }, message: 'private-provider-payload' }, 'debait/model'],
  [{ message: 'model not found private-provider-payload' }, 'debait/model'],
  [{ message: 'HTTP 429 private-provider-payload' }, 'debait/quota'],
  [{ message: 'network offline private-provider-payload' }, 'debait/network'],
]) {
  test(`provider errors are actionable and do not echo payloads: ${code}`, () => {
    const safe = aiError(error);
    assert.equal(safe.code, code); assert.ok(!safe.message.includes('private-provider-payload'));
    assert.equal(safe.needsAppCheck, code === 'debait/app-check');
    assert.equal(aiError(safe), safe);
  });
}

test('debug store migrates the legacy credential, removes exposed storage and deduplicates callers', async () => {
  let saved, writes = 0, removes = 0;
  const store = createDebugTokenStore({ read: async () => saved, write: async token => { writes++; saved = token; },
    local: { get: async () => ({ appCheckDebugToken: 'legacy-test' }), remove: async () => { removes++; } }, randomUUID: () => { throw new Error('must reuse'); } });
  assert.deepEqual(await Promise.all([store(), store()]), ['legacy-test', 'legacy-test']);
  assert.equal(saved, 'legacy-test'); assert.equal(writes, 1); assert.equal(removes, 1);
});

test('debug store does not remove the old credential if protected storage fails', async () => {
  let removed = false;
  const store = createDebugTokenStore({ read: async () => undefined, write: async () => { throw new Error('storage failed'); },
    local: { get: async () => ({ appCheckDebugToken: 'legacy-test' }), remove: async () => { removed = true; } } });
  await assert.rejects(store(), /storage failed/); assert.equal(removed, false);
});

test('a sideloaded packaged build without update_url still cannot use debug authentication', async () => {
  const f = fixture({ getInstallType: async () => 'normal' });
  await assert.rejects(f.access.getAi('test-installation'), /unpacked development installation/);
  assert.equal(f.globals.FIREBASE_APPCHECK_DEBUG_TOKEN, undefined);
});

test('production rejects even an empty string debug flag, matching the SDK activation rules', async () => {
  const f = fixture({ env: { MODE: 'production' }, globals: { FIREBASE_APPCHECK_DEBUG_TOKEN: '' } });
  await assert.rejects(f.access.getAi(), /forbidden/);
  assert.equal(f.calls.init, 0);
});

test('the offscreen runtime-only API obtains installation type from the service worker', async () => {
  const runtimeOnly = { runtime: { sendMessage: async message => {
    assert.deepEqual(message, { type: 'debait/installation-type' });
    return { ok: true, installType: await installationType({ management: { getSelf: async () => ({ installType: 'development' }) } }) };
  } } };
  assert.equal(runtimeOnly.management, undefined);
  const f = fixture({ getInstallType: () => installationTypeFromWorker(runtimeOnly) });
  assert.ok(await f.access.getAi('test-installation'));
  assert.equal(f.access.debug, true);
});

test('a packaged installation relayed by the worker cannot enable debug authentication', async () => {
  const f = fixture({ getInstallType: () => installationTypeFromWorker({ runtime: {
    sendMessage: async () => ({ ok: true, installType: 'normal' }),
  } }) });
  await assert.rejects(f.access.getAi('test-installation'), /never allowed for packaged/);
  assert.equal(f.calls.init, 0);
});

for (const reply of [undefined, { ok: false, installType: 'development' }, { ok: true, installType: 'invented' }]) {
  test(`unverified worker installation data fails closed: ${JSON.stringify(reply)}`, async () => {
    const getInstallType = () => installationTypeFromWorker({ runtime: { sendMessage: async () => reply } });
    assert.equal(await getInstallType(), 'unknown');
    const f = fixture({ getInstallType });
    await assert.rejects(f.access.getAi('test-installation'), /did not verify/);
    assert.equal(f.calls.init, 0);
  });
}

test('an unreachable worker does not enable development authentication', async () => {
  assert.equal(await installationTypeFromWorker({ runtime: { sendMessage: async () => { throw new Error('worker down'); } } }), 'unknown');
});
