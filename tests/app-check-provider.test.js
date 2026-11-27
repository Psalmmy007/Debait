import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createAppCheckTokenHandler,
  DEBAIT_WEB_APP_ID,
  APP_CHECK_TTL_MS,
  APP_CHECK_GLOBAL_BUCKET_ID,
  APP_CHECK_CALLER_MAX,
  APP_CHECK_WINDOW_MS,
  parseAllowedExtensionIds,
  parseExtensionOrigin,
  getAppCheckCallerDocId,
} from '../functions/appCheckHandler.js';
import {
  createAtomicRateLimiter,
  createMemoryTransactionStore,
} from '../functions/mintHandler.js';
import { createProductionAppCheckProvider } from '../src/engine/appCheckProvider.js';
import { createFirebaseAccess } from '../src/engine/authPolicy.js';
import { APP_CHECK_TOKEN_URL, APP_CHECK_TOKEN_FUNCTION, firebaseConfig } from '../src/engine/firebaseConfig.js';

const VALID_EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const OTHER_EXT_ID = 'ponmlkjihgfedcbaponmlkjihgfedcba';
const VALID_ORIGIN = `chrome-extension://${VALID_EXT_ID}`;

function mockRes() {
  const headers = {};
  let statusCode = 0;
  let body = '';
  return {
    headers,
    get statusCode() { return statusCode; },
    get body() { return body; },
    get json() { return body ? JSON.parse(body) : null; },
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    status(code) {
      statusCode = code;
      return {
        send(payload) { body = String(payload ?? ''); },
      };
    },
  };
}

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    headers: {
      origin: VALID_ORIGIN,
      'content-type': 'application/json',
      'x-debait-client': 'extension',
      'x-forwarded-for': '203.0.113.10',
      ...(overrides.headers || {}),
    },
    body: { appId: DEBAIT_WEB_APP_ID },
    ip: '127.0.0.1',
    ...overrides,
    ...(overrides.headers ? { headers: { ...{ origin: VALID_ORIGIN, 'content-type': 'application/json', 'x-debait-client': 'extension', 'x-forwarded-for': '203.0.113.10' }, ...overrides.headers } } : {}),
  };
}

test('issueAppCheckToken rejects missing, web, and malformed origins and never sets wildcard CORS', async () => {
  const store = createMemoryTransactionStore();
  let minted = 0;
  const handler = createAppCheckTokenHandler({
    createToken: async () => { minted++; return { token: 'signed-jwt', ttlMillis: APP_CHECK_TTL_MS }; },
    rateLimiter: createAtomicRateLimiter(store, { globalBucketId: APP_CHECK_GLOBAL_BUCKET_ID }),
  });

  for (const badOrigin of [
    undefined,
    '',
    'https://evil.example',
    'http://localhost:3000',
    'chrome-extension://short',
    'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', // outside a-p Chrome ID alphabet
    `chrome-extension://${VALID_EXT_ID}/path`,
  ]) {
    const res = mockRes();
    await handler(makeReq({ headers: { origin: badOrigin } }), res);
    assert.equal(res.statusCode, 403, `Expected 403 for origin ${String(badOrigin)}`);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(minted, 0);
});

test('issueAppCheckToken enforces ALLOWED_EXTENSION_IDS allowlist, method, header, and appId checks', async () => {
  const store = createMemoryTransactionStore();
  const allowed = parseAllowedExtensionIds({ ALLOWED_EXTENSION_IDS: `${VALID_EXT_ID}, invalid-id` });
  assert.equal(allowed.size, 1);
  assert.equal(allowed.has(VALID_EXT_ID), true);
  assert.equal(parseAllowedExtensionIds({}), null);

  const handler = createAppCheckTokenHandler({
    createToken: async () => ({ token: 'signed-jwt', ttlMillis: APP_CHECK_TTL_MS }),
    rateLimiter: createAtomicRateLimiter(store, { globalBucketId: APP_CHECK_GLOBAL_BUCKET_ID }),
    allowedExtensionIds: allowed,
  });

  // Unlisted extension ID rejected
  const resOther = mockRes();
  await handler(makeReq({ headers: { origin: `chrome-extension://${OTHER_EXT_ID}` } }), resOther);
  assert.equal(resOther.statusCode, 403);

  // OPTIONS preflight succeeds for allowed origin without minting
  const resOpt = mockRes();
  await handler(makeReq({ method: 'OPTIONS' }), resOpt);
  assert.equal(resOpt.statusCode, 204);
  assert.equal(resOpt.headers['access-control-allow-origin'], VALID_ORIGIN);

  // GET rejected with 405
  const resGet = mockRes();
  await handler(makeReq({ method: 'GET' }), resGet);
  assert.equal(resGet.statusCode, 405);

  // Missing X-Debait-Client rejected with 403
  const resNoHdr = mockRes();
  await handler(makeReq({ headers: { 'x-debait-client': '' } }), resNoHdr);
  assert.equal(resNoHdr.statusCode, 403);

  // Mismatched appId rejected with 400
  const resBadApp = mockRes();
  await handler(makeReq({ body: { appId: '1:999:web:wrong' } }), resBadApp);
  assert.equal(resBadApp.statusCode, 400);
});

test('issueAppCheckToken mints short-lived token with no-store headers and enforces atomic concurrent rate limits', async () => {
  const store = createMemoryTransactionStore();
  let clock = 1_700_000_000_000;
  let mintCount = 0;
  const handler = createAppCheckTokenHandler({
    createToken: async (appId, opts) => {
      assert.equal(appId, DEBAIT_WEB_APP_ID);
      assert.equal(opts.ttlMillis, APP_CHECK_TTL_MS);
      mintCount++;
      return { token: `appcheck-jwt-${mintCount}`, ttlMillis: APP_CHECK_TTL_MS };
    },
    rateLimiter: createAtomicRateLimiter(store, {
      callerMax: APP_CHECK_CALLER_MAX,
      globalMax: 120,
      windowMs: APP_CHECK_WINDOW_MS,
      globalBucketId: APP_CHECK_GLOBAL_BUCKET_ID,
      now: () => clock,
    }),
    now: () => clock,
    logger: { warn() {}, error() {} },
  });

  // Fire 10 concurrent requests from the same caller (with spoofed leftmost XFF varying) -> exact 6 succeed, 4 return 429
  const responses = await Promise.all(
    Array.from({ length: 10 }, async (_, i) => {
      const res = mockRes();
      await handler(makeReq({ headers: { 'x-forwarded-for': `198.51.100.${i}, 203.0.113.42` } }), res);
      return res;
    }),
  );

  const ok = responses.filter((r) => r.statusCode === 200);
  const limited = responses.filter((r) => r.statusCode === 429);
  assert.equal(ok.length, APP_CHECK_CALLER_MAX);
  assert.equal(limited.length, 4);
  assert.equal(mintCount, APP_CHECK_CALLER_MAX);

  assert.equal(ok[0].headers['cache-control'], 'no-store');
  assert.equal(ok[0].headers['access-control-allow-origin'], VALID_ORIGIN);
  assert.equal(ok[0].json.expireTimeMillis, clock + APP_CHECK_TTL_MS);
  assert.ok(Number(limited[0].headers['retry-after']) >= 1);

  // Spoofed leftmost XFF produces identical caller doc ID for the same real IP
  const idA = getAppCheckCallerDocId(VALID_EXT_ID, { headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.42' } }, 1);
  const idB = getAppCheckCallerDocId(VALID_EXT_ID, { headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.42' } }, 1);
  assert.equal(idA, idB);
  assert.equal(parseExtensionOrigin(VALID_ORIGIN).extensionId, VALID_EXT_ID);
});

test('createProductionAppCheckProvider enforces HTTPS, deduplicates concurrent calls, caches in memory, and maps errors cleanly', async () => {
  assert.equal(createProductionAppCheckProvider({ endpoint: 'http://insecure.example/token' }), null);
  assert.equal(createProductionAppCheckProvider({ endpoint: '' }), null);

  let clock = 1_700_000_000_000;
  let fetches = 0;
  const provider = createProductionAppCheckProvider({
    endpoint: APP_CHECK_TOKEN_URL,
    appId: firebaseConfig.appId,
    now: () => clock,
    fetchImpl: async (url, init) => {
      fetches++;
      assert.equal(url, APP_CHECK_TOKEN_URL);
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['X-Debait-Client'], 'extension');
      assert.deepEqual(JSON.parse(init.body), { appId: firebaseConfig.appId });
      await new Promise((r) => setTimeout(r, 10));
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: `tok-${fetches}`, expireTimeMillis: clock + 30 * 60 * 1000 }),
      };
    },
  });

  // Concurrent callers share one network request
  const [a, b] = await Promise.all([provider.getToken(), provider.getToken()]);
  assert.equal(fetches, 1);
  assert.deepEqual(a, b);
  assert.equal(a.token, 'tok-1');

  // Cached token reused while outside refresh buffer
  clock += 10 * 60 * 1000;
  const c = await provider.getToken();
  assert.equal(fetches, 1);
  assert.equal(c.token, 'tok-1');

  // Within 2-min refresh buffer -> fetches a fresh token
  clock += 19 * 60 * 1000;
  const d = await provider.getToken();
  assert.equal(fetches, 2);
  assert.equal(d.token, 'tok-2');

  // 404 (undeployed backend) surfaces actionable setup error
  const undeployed = createProductionAppCheckProvider({
    endpoint: APP_CHECK_TOKEN_URL,
    appId: firebaseConfig.appId,
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  await assert.rejects(() => undeployed.getToken(), (err) => {
    assert.equal(err.code, 'debait/app-check-setup');
    assert.match(err.message, /issueAppCheckToken.*not deployed/i);
    return true;
  });

  // 429 maps to debait/quota with retryAfterMs
  const rateLimited = createProductionAppCheckProvider({
    endpoint: APP_CHECK_TOKEN_URL,
    appId: firebaseConfig.appId,
    fetchImpl: async () => ({ ok: false, status: 429, headers: new Headers({ 'retry-after': '45' }) }),
  });
  await assert.rejects(() => rateLimited.getToken(), (err) => {
    assert.equal(err.code, 'debait/quota');
    assert.equal(err.retryAfterMs, 45000);
    return true;
  });
});

test('production createFirebaseAccess authenticates through productionProvider without any debug token', async () => {
  const store = createMemoryTransactionStore();
  let clock = Date.now();
  const handler = createAppCheckTokenHandler({
    createToken: async () => ({ token: 'verified-admin-appcheck-jwt', ttlMillis: APP_CHECK_TTL_MS }),
    rateLimiter: createAtomicRateLimiter(store, { globalBucketId: APP_CHECK_GLOBAL_BUCKET_ID, now: () => clock }),
    now: () => clock,
  });

  const productionProvider = createProductionAppCheckProvider({
    endpoint: APP_CHECK_TOKEN_URL,
    appId: firebaseConfig.appId,
    now: () => clock,
    fetchImpl: async (_url, init) => {
      const res = mockRes();
      await handler({
        method: init.method,
        headers: { origin: VALID_ORIGIN, ...init.headers, 'x-forwarded-for': '203.0.113.55' },
        body: JSON.parse(init.body),
      }, res);
      return {
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        headers: new Headers(res.headers),
        json: async () => res.json,
      };
    },
  });

  const globals = {};
  let sdkProvider;
  const access = createFirebaseAccess({
    sdk: {
      CustomProvider: class { constructor(opts) { this.getToken = opts.getToken; } },
      GoogleAIBackend: class {},
      initializeApp: () => ({}),
      initializeAppCheck: (_app, cfg) => { sdkProvider = cfg.provider; return {}; },
      getAI: () => ({ ok: true }),
      getToken: async () => sdkProvider.getToken(),
    },
    config: firebaseConfig,
    env: { MODE: 'production' },
    globals,
    productionProvider,
    getInstallation: async () => ({ installType: 'normal', manifest: {} }),
  });

  const ai = await access.getAi();
  assert.deepEqual(ai, { ok: true });
  assert.equal(globals.FIREBASE_APPCHECK_DEBUG_TOKEN, undefined);
  assert.equal(access.debug, false);

  // Verify functions/index.js exports issueAppCheckToken with getAppCheck().createToken
  const fnIdx = fs.readFileSync('functions/index.js', 'utf8');
  assert.ok(fnIdx.includes(`export const ${APP_CHECK_TOKEN_FUNCTION} = onRequest`), 'functions/index.js must export issueAppCheckToken');
  assert.ok(fnIdx.includes('getAppCheck().createToken'), 'issueAppCheckToken must mint tokens via Firebase Admin App Check');
});
