import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ALLOWED_LIVE_MODELS,
  LIVE_VOICE,
  EPHEMERAL_API_VERSION,
  SESSION_TTL_MS,
  HANDSHAKE_WINDOW_MS,
  RATE_LIMIT_MAX,
  GLOBAL_RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  DEFAULT_TRUSTED_PROXY_HOPS,
  getTrustedProxyHops,
  isInternalProxyIp,
  getTrustedClientIp,
  getCallerDocId,
  createMintHandler,
  createAtomicRateLimiter,
  createMemoryTransactionStore,
} from '../functions/mintHandler.js';
import { buildConstrainedWsUrl, DEFAULT_LIVE_API_VERSION } from '../src/offscreen/call.js';

class MockHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const APP_ID = '1:63438015732:web:54ab25a947b03005efa2a1';
const makeReq = (overrides = {}) => ({
  app: { appId: APP_ID },
  data: {},
  rawRequest: { ip: '203.0.113.10', headers: {} },
  ...overrides,
});

const mockCreateClient = () => ({
  authTokens: { create: async () => ({ name: 'auth_tokens/ok' }) },
});

test('mintLiveVoiceToken: mints single-use constrained v1beta ephemeral token and matches client WebSocket URL', async () => {
  const fixedNow = Date.parse('2026-11-26T15:00:00.000Z');
  let capturedClientOpts = null;
  let capturedTokenArg = null;

  const handler = createMintHandler({
    getApiKey: () => 'fake-secret-gemini-key',
    HttpsErrorCtor: MockHttpsError,
    now: () => fixedNow,
    createClient: (opts) => {
      capturedClientOpts = opts;
      return {
        authTokens: {
          create: async (arg) => {
            capturedTokenArg = arg;
            return { name: 'auth_tokens/ephemeral-test-token-123' };
          },
        },
      };
    },
  });

  const requestedModel = ALLOWED_LIVE_MODELS[1];
  const res = await handler(makeReq({ data: { model: requestedModel } }));

  assert.equal(capturedClientOpts.apiKey, 'fake-secret-gemini-key');
  assert.equal(capturedClientOpts.httpOptions.apiVersion, 'v1beta');
  assert.equal(EPHEMERAL_API_VERSION, DEFAULT_LIVE_API_VERSION);
  assert.equal(capturedTokenArg.config.uses, 1);
  assert.equal(capturedTokenArg.config.expireTime, new Date(fixedNow + SESSION_TTL_MS).toISOString());
  assert.equal(capturedTokenArg.config.newSessionExpireTime, new Date(fixedNow + HANDSHAKE_WINDOW_MS).toISOString());
  assert.equal(capturedTokenArg.config.liveConnectConstraints.model, `models/${requestedModel}`);
  assert.deepEqual(capturedTokenArg.config.liveConnectConstraints.config.responseModalities, ['AUDIO']);
  assert.equal(
    capturedTokenArg.config.liveConnectConstraints.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
    LIVE_VOICE,
  );

  assert.deepEqual(res, {
    token: 'auth_tokens/ephemeral-test-token-123',
    model: requestedModel,
    apiVersion: 'v1beta',
    expiresAt: new Date(fixedNow + SESSION_TTL_MS).toISOString(),
  });
  assert.equal(JSON.stringify(res).includes('fake-secret-gemini-key'), false);

  const wsUrl = buildConstrainedWsUrl(res.token, res.apiVersion);
  assert.equal(
    wsUrl,
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens%2Fephemeral-test-token-123',
  );
});

test('mintLiveVoiceToken: enforces App Check presence, input validation, and missing secret checks', async () => {
  const handler = createMintHandler({
    getApiKey: () => 'fake-key',
    HttpsErrorCtor: MockHttpsError,
    createClient: mockCreateClient,
  });

  await assert.rejects(
    () => handler(makeReq({ app: null })),
    (err) => err instanceof MockHttpsError && err.code === 'unauthenticated',
  );

  await assert.rejects(
    () => handler(makeReq({ data: 'not-an-object' })),
    (err) => err instanceof MockHttpsError && err.code === 'invalid-argument',
  );

  await assert.rejects(
    () => handler(makeReq({ data: { model: 'gemini-unapproved-model' } })),
    (err) => err instanceof MockHttpsError && err.code === 'invalid-argument',
  );

  const missingSecretHandler = createMintHandler({
    getApiKey: () => '',
    HttpsErrorCtor: MockHttpsError,
    createClient: () => { throw new Error('should not initialize client without secret'); },
  });
  await assert.rejects(
    () => missingSecretHandler(makeReq()),
    (err) => err instanceof MockHttpsError && err.code === 'failed-precondition',
  );
});

test('mintLiveVoiceToken: concurrent Promise.all requests enforce exact atomic 5/min limit', async () => {
  const fixedNow = Date.parse('2026-11-26T15:00:00.000Z');
  const sharedStore = createMemoryTransactionStore();
  const handler = createMintHandler({
    getApiKey: () => 'fake-key',
    HttpsErrorCtor: MockHttpsError,
    now: () => fixedNow,
    rateLimitStore: sharedStore,
    createClient: mockCreateClient,
  });

  const req = makeReq({ rawRequest: { ip: '198.51.100.77', headers: {} } });
  const settled = await Promise.allSettled(Array.from({ length: 10 }, () => handler(req)));

  const ok = settled.filter((r) => r.status === 'fulfilled');
  const limited = settled.filter(
    (r) => r.status === 'rejected' && r.reason instanceof MockHttpsError && r.reason.code === 'resource-exhausted',
  );
  assert.equal(ok.length, RATE_LIMIT_MAX, 'exactly 5 concurrent requests must succeed');
  assert.equal(limited.length, 5, 'remaining 5 concurrent requests must fail with resource-exhausted');
});

test('mintLiveVoiceToken: multi-instance enforcement shares atomic per-caller limit and recovers after window', async () => {
  let clock = Date.parse('2026-11-26T15:00:00.000Z');
  const sharedStore = createMemoryTransactionStore();

  const instanceA = createMintHandler({
    getApiKey: () => 'fake-key',
    HttpsErrorCtor: MockHttpsError,
    now: () => clock,
    rateLimiter: createAtomicRateLimiter(sharedStore, { now: () => clock }),
    createClient: mockCreateClient,
  });
  const instanceB = createMintHandler({
    getApiKey: () => 'fake-key',
    HttpsErrorCtor: MockHttpsError,
    now: () => clock,
    rateLimiter: createAtomicRateLimiter(sharedStore, { now: () => clock }),
    createClient: mockCreateClient,
  });

  const callerReq = makeReq({ rawRequest: { ip: '198.51.100.1', headers: {} } });

  // 3 requests to Instance A + 2 requests to Instance B = 5 allowed total
  for (let i = 0; i < 3; i++) {
    assert.equal((await instanceA(callerReq)).token, 'auth_tokens/ok');
    clock += 500;
  }
  for (let i = 0; i < 2; i++) {
    assert.equal((await instanceB(callerReq)).token, 'auth_tokens/ok');
    clock += 500;
  }

  // 6th request to Instance B is rejected with resource-exhausted
  await assert.rejects(
    () => instanceB(callerReq),
    (err) => err instanceof MockHttpsError && err.code === 'resource-exhausted',
  );

  // Separate caller on Instance A is unaffected
  const callerB = await instanceA(makeReq({ rawRequest: { ip: '198.51.100.2', headers: {} } }));
  assert.equal(callerB.token, 'auth_tokens/ok');

  // After sliding window expires, original caller recovers on Instance A
  clock += RATE_LIMIT_WINDOW_MS;
  assert.equal((await instanceA(callerReq)).token, 'auth_tokens/ok');
});

test('mintLiveVoiceToken: proxy-hop caller ID handles 1-hop Cloud Run GFE, 2-hop GCLB, internal proxy stripping, auth.uid priority, and leftmost spoofing', async () => {
  const fixedNow = Date.parse('2026-11-26T15:00:00.000Z');

  // Env parsing & internal proxy IP detection
  assert.equal(DEFAULT_TRUSTED_PROXY_HOPS, 1);
  assert.equal(getTrustedProxyHops({}), 1);
  assert.equal(getTrustedProxyHops({ TRUSTED_PROXY_HOPS: '2' }), 2);
  assert.equal(isInternalProxyIp('10.128.0.5'), true);
  assert.equal(isInternalProxyIp('169.254.1.1'), true);
  assert.equal(isInternalProxyIp('127.0.0.1'), true);
  assert.equal(isInternalProxyIp('::1'), true);
  assert.equal(isInternalProxyIp('::ffff:10.0.0.2'), true);
  assert.equal(isInternalProxyIp('198.51.100.42'), false);

  // 1-hop (direct Cloud Run / GFE): rightmost external IP wins, trailing internal proxy IPs skipped
  assert.equal(
    getTrustedClientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 198.51.100.42' }, ip: '10.0.0.1' }, 1),
    '198.51.100.42',
  );
  assert.equal(
    getTrustedClientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.42, 10.128.0.9, ::1' }, ip: '10.0.0.1' }, 1),
    '198.51.100.42',
  );
  assert.equal(getTrustedClientIp({ headers: {}, ip: '203.0.113.9' }, 1), '203.0.113.9');

  // 2-hop (external GCLB + Cloud Run): 2nd-from-right external IP is real client, NOT the shared GCLB VIP
  const gclbVip = '34.117.10.20';
  assert.equal(
    getTrustedClientIp({ headers: { 'x-forwarded-for': `9.9.9.1, 198.51.100.11, ${gclbVip}` } }, 2),
    '198.51.100.11',
  );
  assert.equal(
    getTrustedClientIp({ headers: { 'x-forwarded-for': `198.51.100.22, ${gclbVip}, 169.254.1.1` } }, 2),
    '198.51.100.22',
  );

  // Caller doc IDs are SHA-256 hashed (never raw IP) and prioritize auth.uid
  const docId = getCallerDocId(makeReq({ rawRequest: { headers: { 'x-forwarded-for': '9.9.9.9, 198.51.100.42' } } }), 1);
  assert.match(docId, /^caller_[0-9a-f]{64}$/);
  assert.equal(docId.includes('198.51.100.42'), false);
  const uidDoc1 = getCallerDocId(makeReq({ auth: { uid: 'user-abc' }, rawRequest: { ip: '1.1.1.1', headers: {} } }), 1);
  const uidDoc2 = getCallerDocId(makeReq({ auth: { uid: 'user-abc' }, rawRequest: { ip: '2.2.2.2', headers: {} } }), 2);
  assert.equal(uidDoc1, uidDoc2, 'auth.uid must take priority over IP regardless of proxy hops');

  // 1-hop spoofing test: rotating leftmost XFF while rightmost trusted IP stays identical hits the same bucket
  const store1 = createMemoryTransactionStore();
  const handler1Hop = createMintHandler({
    getApiKey: () => 'fake-key',
    HttpsErrorCtor: MockHttpsError,
    now: () => fixedNow,
    trustedProxyHops: 1,
    rateLimitStore: store1,
    createClient: mockCreateClient,
  });
  for (let i = 0; i < RATE_LIMIT_MAX; i++) {
    const res = await handler1Hop(makeReq({
      rawRequest: { headers: { 'x-forwarded-for': `203.0.113.${i + 1}, 198.51.100.42, 10.128.0.5` }, ip: '10.0.0.1' },
    }));
    assert.equal(res.token, 'auth_tokens/ok');
  }
  await assert.rejects(
    () => handler1Hop(makeReq({
      rawRequest: { headers: { 'x-forwarded-for': '203.0.113.250, 198.51.100.42, 10.128.0.5' }, ip: '10.0.0.1' },
    })),
    (err) => err instanceof MockHttpsError && err.code === 'resource-exhausted',
  );

  // 2-hop GCLB test: different clients behind same GCLB VIP get separate buckets, while leftmost spoofing is blocked
  const store2 = createMemoryTransactionStore();
  const handler2Hop = createMintHandler({
    getApiKey: () => 'fake-key',
    HttpsErrorCtor: MockHttpsError,
    now: () => fixedNow,
    trustedProxyHops: 2,
    rateLimitStore: store2,
    createClient: mockCreateClient,
  });
  for (let i = 0; i < RATE_LIMIT_MAX; i++) {
    const res = await handler2Hop(makeReq({
      rawRequest: { headers: { 'x-forwarded-for': `198.18.0.${i + 1}, 198.51.100.11, ${gclbVip}` }, ip: '10.0.0.1' },
    }));
    assert.equal(res.token, 'auth_tokens/ok');
  }
  // 6th spoofed request from Client A behind GCLB is rate-limited
  await assert.rejects(
    () => handler2Hop(makeReq({
      rawRequest: { headers: { 'x-forwarded-for': `198.18.0.99, 198.51.100.11, ${gclbVip}` }, ip: '10.0.0.1' },
    })),
    (err) => err instanceof MockHttpsError && err.code === 'resource-exhausted',
  );
  // Client B behind the exact same GCLB VIP is NOT grouped with Client A and succeeds
  const clientBRes = await handler2Hop(makeReq({
    rawRequest: { headers: { 'x-forwarded-for': `198.51.100.22, ${gclbVip}` }, ip: '10.0.0.1' },
  }));
  assert.equal(clientBRes.token, 'auth_tokens/ok');
});

test('mintLiveVoiceToken: enforces global 30/min safety cap across distinct callers', async () => {
  const fixedNow = Date.parse('2026-11-26T15:00:00.000Z');
  const sharedStore = createMemoryTransactionStore();
  const handler = createMintHandler({
    getApiKey: () => 'fake-key',
    HttpsErrorCtor: MockHttpsError,
    now: () => fixedNow,
    rateLimitStore: sharedStore,
    createClient: mockCreateClient,
  });

  // 30 distinct callers succeed (hitting GLOBAL_RATE_LIMIT_MAX = 30)
  for (let i = 0; i < GLOBAL_RATE_LIMIT_MAX; i++) {
    const res = await handler(makeReq({ rawRequest: { ip: `192.0.2.${i + 1}`, headers: {} } }));
    assert.equal(res.token, 'auth_tokens/ok');
  }

  // 31st request from a brand-new caller fails due to global cap
  await assert.rejects(
    () => handler(makeReq({ rawRequest: { ip: '192.0.2.200', headers: {} } })),
    (err) => err instanceof MockHttpsError && err.code === 'resource-exhausted',
  );
});

test('mintLiveVoiceToken: handles upstream errors, empty responses, and production Firestore wiring', async () => {
  const logged = [];
  const throwingHandler = createMintHandler({
    getApiKey: () => 'super-secret-key',
    HttpsErrorCtor: MockHttpsError,
    logger: { error: (...args) => logged.push(args) },
    createClient: () => ({
      authTokens: {
        create: async () => { throw new Error('upstream 503 service unavailable'); },
      },
    }),
  });

  await assert.rejects(
    () => throwingHandler(makeReq()),
    (err) => err instanceof MockHttpsError && err.code === 'internal' && !err.message.includes('super-secret-key'),
  );
  assert.equal(logged.length, 1);

  const emptyHandler = createMintHandler({
    getApiKey: () => 'super-secret-key',
    HttpsErrorCtor: MockHttpsError,
    createClient: () => ({
      authTokens: { create: async () => ({}) },
    }),
  });

  await assert.rejects(
    () => emptyHandler(makeReq()),
    (err) => err instanceof MockHttpsError && err.code === 'internal',
  );

  // Verify production Cloud Function wires Firestore atomic limiter + firebase-admin dependency
  const fnPkg = JSON.parse(fs.readFileSync('functions/package.json', 'utf8'));
  assert.ok(fnPkg.dependencies['firebase-admin'], 'functions/package.json must include firebase-admin');
  const fnIdx = fs.readFileSync('functions/index.js', 'utf8');
  assert.ok(fnIdx.includes('createFirestoreRateLimitStore') && fnIdx.includes('enforceAppCheck: true') && fnIdx.includes('maxInstances: 5'));
});

test('Firestore security rules explicitly deny client access to /_rateLimits/{doc} and are wired in firebase.json', () => {
  assert.equal(fs.existsSync('firestore.rules'), true, 'firestore.rules must exist');

  const fbCfg = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
  assert.equal(fbCfg.firestore?.rules, 'firestore.rules', 'firebase.json must point to firestore.rules');
  assert.equal(Array.isArray(fbCfg.functions) && fbCfg.functions[0]?.source, 'functions', 'firebase.json must preserve functions config');

  const rules = fs.readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /rules_version\s*=\s*'2'/);
  assert.match(
    rules,
    /match\s+\/_rateLimits\/\{doc\}\s*\{[\s\S]*?allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/,
    'firestore.rules must explicitly deny client read/write on /_rateLimits/{doc}',
  );
  assert.match(
    rules,
    /match\s+\/\{document=\*\*\}\s*\{[\s\S]*?allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/,
    'firestore.rules must preserve default-deny fallback for other client documents',
  );
});
