import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_LIVE_MODELS,
  LIVE_VOICE,
  EPHEMERAL_API_VERSION,
  SESSION_TTL_MS,
  HANDSHAKE_WINDOW_MS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  createMintHandler,
  createRateLimiter,
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

  // Verify backend client & constraints
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

  // Verify response shape & no secret leakage
  assert.deepEqual(res, {
    token: 'auth_tokens/ephemeral-test-token-123',
    model: requestedModel,
    apiVersion: 'v1beta',
    expiresAt: new Date(fixedNow + SESSION_TTL_MS).toISOString(),
  });
  assert.equal(JSON.stringify(res).includes('fake-secret-gemini-key'), false);

  // Verify 100% version & query-param parity with client WebSocket handshake
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
    createClient: () => ({ authTokens: { create: async () => ({ name: 'auth_tokens/ok' }) } }),
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

test('mintLiveVoiceToken: enforces per-caller sliding-window rate limit (5/min) and recovers after window', async () => {
  let clock = Date.parse('2026-11-26T15:00:00.000Z');
  const rateLimiter = createRateLimiter({ now: () => clock });
  const handler = createMintHandler({
    getApiKey: () => 'fake-key',
    HttpsErrorCtor: MockHttpsError,
    now: () => clock,
    rateLimiter,
    createClient: () => ({ authTokens: { create: async () => ({ name: 'auth_tokens/ok' }) } }),
  });

  // First 5 requests from caller A succeed
  for (let i = 0; i < RATE_LIMIT_MAX; i++) {
    const res = await handler(makeReq({ rawRequest: { ip: '198.51.100.1', headers: {} } }));
    assert.equal(res.token, 'auth_tokens/ok');
    clock += 1000;
  }

  // 6th request within 60 s from caller A is rejected with resource-exhausted
  await assert.rejects(
    () => handler(makeReq({ rawRequest: { ip: '198.51.100.1', headers: {} } })),
    (err) => err instanceof MockHttpsError && err.code === 'resource-exhausted',
  );

  // Separate caller B is unaffected
  const callerB = await handler(makeReq({ rawRequest: { ip: '198.51.100.2', headers: {} } }));
  assert.equal(callerB.token, 'auth_tokens/ok');

  // After sliding window expires, caller A can mint again
  clock += RATE_LIMIT_WINDOW_MS;
  const recovered = await handler(makeReq({ rawRequest: { ip: '198.51.100.1', headers: {} } }));
  assert.equal(recovered.token, 'auth_tokens/ok');
});

test('mintLiveVoiceToken: handles upstream token creation errors and empty responses cleanly', async () => {
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
});
