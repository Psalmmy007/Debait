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

test('mintLiveVoiceToken: header spoofing resistance uses rightmost x-forwarded-for, SHA-256 doc IDs, and prioritizes auth.uid', async () => {
  const fixedNow = Date.parse('2026-11-26T15:00:00.000Z');
  const sharedStore = createMemoryTransactionStore();
  const handler = createMintHandler({
    getApiKey: () => 'fake-key',
    HttpsErrorCtor: MockHttpsError,
    now: () => fixedNow,
    rateLimitStore: sharedStore,
    createClient: mockCreateClient,
  });

  // Rightmost trusted proxy IP extraction
  assert.equal(getTrustedClientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 198.51.100.42' }, ip: '10.0.0.1' }), '198.51.100.42');
  assert.equal(getTrustedClientIp({ headers: {}, ip: '203.0.113.9' }), '203.0.113.9');

  // Caller doc IDs are SHA-256 hashed (never raw IP) and prioritize auth.uid
  const docId = getCallerDocId(makeReq({ rawRequest: { headers: { 'x-forwarded-for': '9.9.9.9, 198.51.100.42' } } }));
  assert.match(docId, /^caller_[0-9a-f]{64}$/);
  assert.equal(docId.includes('198.51.100.42'), false);
  const uidDoc1 = getCallerDocId(makeReq({ auth: { uid: 'user-abc' }, rawRequest: { ip: '1.1.1.1', headers: {} } }));
  const uidDoc2 = getCallerDocId(makeReq({ auth: { uid: 'user-abc' }, rawRequest: { ip: '2.2.2.2', headers: {} } }));
  assert.equal(uidDoc1, uidDoc2, 'auth.uid must take priority over IP');

  // Rotating spoofed leftmost x-forwarded-for IPs while rightmost proxy IP stays identical hits the same bucket
  for (let i = 0; i < RATE_LIMIT_MAX; i++) {
    const res = await handler(makeReq({
      rawRequest: { headers: { 'x-forwarded-for': `203.0.113.${i + 1}, 198.51.100.42` }, ip: '10.0.0.1' },
    }));
    assert.equal(res.token, 'auth_tokens/ok');
  }

  await assert.rejects(
    () => handler(makeReq({
      rawRequest: { headers: { 'x-forwarded-for': '203.0.113.250, 198.51.100.42' }, ip: '10.0.0.1' },
    })),
    (err) => err instanceof MockHttpsError && err.code === 'resource-exhausted',
  );
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
