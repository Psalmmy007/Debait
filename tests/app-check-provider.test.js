import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createAttestHost,
  parseJwtExpiryMs,
  normalizeAllowedOrigins,
  isPlaceholderValue,
  MSG_READY,
  MSG_TOKEN_REQUEST,
  MSG_TOKEN_RESPONSE,
} from '../hosting/attestCore.js';
import { createOffscreenAppCheckBridge } from '../src/offscreen/appCheckBridge.js';
import { createProductionAppCheckProvider } from '../src/engine/appCheckProvider.js';
import { createFirebaseAccess } from '../src/engine/authPolicy.js';
import { createHeadlineEngine } from '../src/engine/inference.js';
import { APP_CHECK_ATTEST_URL, firebaseConfig } from '../src/engine/firebaseConfig.js';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXT_ORIGIN = `chrome-extension://${EXT_ID}`;
const OTHER_EXT_ORIGIN = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba';
const HOST_ORIGIN = 'https://debait-d6d5d.web.app';

function makeJwt(expSeconds) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: firebaseConfig.appId, exp: expSeconds })).toString('base64url');
  return `${h}.${p}.sig`;
}

/** Creates a paired fake parent window (offscreen doc) and iframe window (hosted attest.html). */
function createPairedWindows({ extOrigin = EXT_ORIGIN, hostOrigin = HOST_ORIGIN } = {}) {
  const parentListeners = new Set();
  const childListeners = new Set();
  const parentPosted = [];
  const childPosted = [];
  let attachedFrame = null;

  const childWin = {
    parent: null,
    addEventListener(type, fn) { if (type === 'message') childListeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'message') childListeners.delete(fn); },
    postMessage(data, targetOrigin) {
      parentPosted.push({ data, targetOrigin });
      assert.notEqual(targetOrigin, '*', 'Parent must never postMessage with wildcard targetOrigin');
      if (targetOrigin !== hostOrigin) return;
      queueMicrotask(() => {
        for (const fn of [...childListeners]) {
          fn({ origin: extOrigin, source: parentWin, data });
        }
      });
    },
  };

  const parentWin = {
    addEventListener(type, fn) { if (type === 'message') parentListeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'message') parentListeners.delete(fn); },
    postMessage(data, targetOrigin) {
      childPosted.push({ data, targetOrigin });
      assert.notEqual(targetOrigin, '*', 'Hosted page must never postMessage with wildcard targetOrigin');
      if (targetOrigin !== extOrigin) return;
      queueMicrotask(() => {
        for (const fn of [...parentListeners]) {
          fn({ origin: hostOrigin, source: childWin, data });
        }
      });
    },
  };
  childWin.parent = parentWin;

  let onFrameAttached = null;
  const doc = {
    body: {
      appendChild(el) {
        attachedFrame = el;
        el.contentWindow = childWin;
        onFrameAttached?.(el);
        return el;
      },
    },
    createElement(tag) {
      assert.equal(tag, 'iframe');
      const attrs = {};
      const listeners = {};
      return {
        tagName: 'IFRAME',
        attrs,
        style: {},
        contentWindow: null,
        setAttribute(k, v) { attrs[k] = v; },
        addEventListener(type, fn) { listeners[type] = fn; },
        remove() { attachedFrame = null; },
      };
    },
  };

  return {
    parentWin,
    childWin,
    doc,
    parentPosted,
    childPosted,
    get attachedFrame() { return attachedFrame; },
    onAttach(fn) { onFrameAttached = fn; },
    emitToParent(event) {
      for (const fn of [...parentListeners]) fn(event);
    },
    emitToChild(event) {
      for (const fn of [...childListeners]) fn(event);
    },
  };
}

test('hosted attestCore refuses standalone execution and validates allowed origins & placeholders', () => {
  const standalone = {};
  standalone.parent = standalone;
  const res = createAttestHost({
    win: standalone,
    sdk: {},
    firebaseConfig,
    siteKey: 'site-key-123',
    allowedOrigins: [EXT_ORIGIN],
  });
  assert.equal(res.active, false);
  assert.equal(res.reason, 'standalone-forbidden');

  assert.equal(isPlaceholderValue('__DEBAIT_RECAPTCHA_SITE_KEY__'), true);
  assert.equal(isPlaceholderValue(''), true);
  assert.equal(isPlaceholderValue('6LcRealSiteKey'), false);

  assert.deepEqual(
    normalizeAllowedOrigins([EXT_ORIGIN, '*', 'https://evil.example', 'chrome-extension://bad', EXT_ORIGIN]),
    [EXT_ORIGIN],
  );
});

test('hosted attestCore ignores untrusted origins/sources, replies only to exact targetOrigin, and fails closed if unconfigured', async () => {
  const pair = createPairedWindows();
  let sdkCalls = 0;
  const expSec = Math.floor((Date.now() + 45 * 60 * 1000) / 1000);
  const jwt = makeJwt(expSec);

  const host = createAttestHost({
    win: pair.childWin,
    sdk: {
      ReCaptchaEnterpriseProvider: class { constructor(key) { this.key = key; } },
      initializeApp: () => ({}),
      initializeAppCheck: (_app, opts) => {
        assert.equal(opts.provider.key, '6LcTestSiteKey');
        assert.equal(opts.isTokenAutoRefreshEnabled, false);
        return {};
      },
      getToken: async () => { sdkCalls++; return { token: jwt }; },
    },
    firebaseConfig,
    siteKey: '6LcTestSiteKey',
    allowedOrigins: [EXT_ORIGIN],
  });
  assert.equal(host.active, true);
  assert.equal(host.configured, true);
  assert.equal(pair.childPosted[0].data.type, MSG_READY);
  assert.equal(pair.childPosted[0].targetOrigin, EXT_ORIGIN);

  // Spoofed origins and wrong sources must be silently ignored
  pair.emitToChild({ origin: 'https://evil.example', source: pair.parentWin, data: { type: MSG_TOKEN_REQUEST, requestId: 'r1' } });
  pair.emitToChild({ origin: OTHER_EXT_ORIGIN, source: pair.parentWin, data: { type: MSG_TOKEN_REQUEST, requestId: 'r2' } });
  pair.emitToChild({ origin: EXT_ORIGIN, source: {}, data: { type: MSG_TOKEN_REQUEST, requestId: 'r3' } });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(sdkCalls, 0);

  // Valid request receives JWT + parsed expiry strictly targeting EXT_ORIGIN
  pair.emitToChild({ origin: EXT_ORIGIN, source: pair.parentWin, data: { type: MSG_TOKEN_REQUEST, requestId: 'r-ok' } });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(sdkCalls, 1);
  const reply = pair.childPosted.find((m) => m.data.type === MSG_TOKEN_RESPONSE);
  assert.equal(reply.targetOrigin, EXT_ORIGIN);
  assert.equal(reply.data.ok, true);
  assert.equal(reply.data.token, jwt);
  assert.equal(reply.data.expireTimeMillis, expSec * 1000);
  assert.equal(parseJwtExpiryMs(jwt), expSec * 1000);
  host.dispose();

  // Unconfigured placeholder siteKey fails closed
  const pair2 = createPairedWindows();
  const unconfigured = createAttestHost({
    win: pair2.childWin,
    sdk: { initializeApp: () => { throw new Error('must not init'); } },
    firebaseConfig,
    siteKey: '__DEBAIT_RECAPTCHA_SITE_KEY__',
    allowedOrigins: [EXT_ORIGIN],
  });
  assert.equal(unconfigured.configured, false);
  pair2.emitToChild({ origin: EXT_ORIGIN, source: pair2.parentWin, data: { type: MSG_TOKEN_REQUEST, requestId: 'r-unconf' } });
  await new Promise((r) => setTimeout(r, 15));
  const errReply = pair2.childPosted.find((m) => m.data.type === MSG_TOKEN_RESPONSE);
  assert.equal(errReply.data.ok, false);
  assert.equal(errReply.data.code, 'debait/app-check-setup');
  unconfigured.dispose();
});

test('offscreen bridge enforces HTTPS, strict origin/source validation, timeout, and clean disposal', async () => {
  assert.equal(createOffscreenAppCheckBridge({ attestUrl: 'http://debait-d6d5d.web.app/attest.html' }), null);

  // Timeout when hosted page never sends ready
  const silentPair = createPairedWindows();
  const silentBridge = createOffscreenAppCheckBridge({
    attestUrl: APP_CHECK_ATTEST_URL,
    doc: silentPair.doc,
    win: silentPair.parentWin,
    timeoutMs: 25,
  });
  assert.equal(silentBridge.mounted, false, 'iframe must not mount before requestToken()');
  await assert.rejects(() => silentBridge.requestToken(), (err) => {
    assert.equal(err.code, 'debait/app-check-setup');
    assert.match(err.message, /attest\.html.*did not respond/i);
    return true;
  });
  assert.equal(silentBridge.mounted, false, 'timed-out bridge must dispose iframe cleanly');

  // Spoofed origin response from another domain is ignored while real iframe response succeeds
  const pair = createPairedWindows();
  const expSec = Math.floor((Date.now() + 30 * 60 * 1000) / 1000);
  const realJwt = makeJwt(expSec);
  pair.onAttach(() => {
    queueMicrotask(() => {
      pair.emitToParent({ origin: 'https://evil.example', source: pair.childWin, data: { type: MSG_READY, configured: true } });
      pair.parentWin.postMessage({ type: MSG_READY, configured: true }, EXT_ORIGIN);
    });
  });

  const bridge = createOffscreenAppCheckBridge({
    attestUrl: APP_CHECK_ATTEST_URL,
    doc: pair.doc,
    win: pair.parentWin,
    timeoutMs: 500,
    randomId: () => 'req-1',
  });

  const pending = bridge.requestToken();
  await new Promise((r) => setTimeout(r, 10));
  // Spoofed origin + wrong source must be ignored
  pair.emitToParent({
    origin: 'https://evil.example',
    source: pair.childWin,
    data: { type: MSG_TOKEN_RESPONSE, requestId: 'req-1', ok: true, token: 'spoofed', expireTimeMillis: Date.now() + 999999 },
  });
  pair.emitToParent({
    origin: HOST_ORIGIN,
    source: {},
    data: { type: MSG_TOKEN_RESPONSE, requestId: 'req-1', ok: true, token: 'spoofed-source', expireTimeMillis: Date.now() + 999999 },
  });
  // Legitimate hosted reply succeeds
  pair.parentWin.postMessage(
    { type: MSG_TOKEN_RESPONSE, requestId: 'req-1', ok: true, token: realJwt, expireTimeMillis: expSec * 1000 },
    EXT_ORIGIN,
  );
  const issued = await pending;
  assert.equal(issued.token, realJwt);
  assert.equal(pair.attachedFrame.attrs.sandbox, 'allow-scripts allow-same-origin');
  assert.equal(pair.attachedFrame.attrs.referrerpolicy, 'no-referrer');
  bridge.dispose();
  assert.equal(bridge.mounted, false);
});

test('end-to-end production createFirebaseAccess authenticates via hosted ReCaptchaEnterpriseProvider bridge with dedupe/caching and zero debug tokens', async () => {
  const pair = createPairedWindows();
  let clock = Date.now();
  let recaptchaCalls = 0;
  let attestHost = null;

  pair.onAttach(() => {
    attestHost = createAttestHost({
      win: pair.childWin,
      sdk: {
        ReCaptchaEnterpriseProvider: class { constructor(key) { this.key = key; } },
        initializeApp: () => ({}),
        initializeAppCheck: () => ({}),
        getToken: async () => {
          recaptchaCalls++;
          await new Promise((r) => setTimeout(r, 10));
          return { token: makeJwt(Math.floor((clock + 30 * 60 * 1000) / 1000)) };
        },
      },
      firebaseConfig,
      siteKey: '6LcProductionKey',
      allowedOrigins: [EXT_ORIGIN],
      now: () => clock,
    });
  });

  const productionProvider = createProductionAppCheckProvider({
    attestUrl: APP_CHECK_ATTEST_URL,
    doc: pair.doc,
    win: pair.parentWin,
    now: () => clock,
  });

  // Deduplicates concurrent getToken() calls into a single ReCaptchaEnterpriseProvider request
  const [t1, t2] = await Promise.all([productionProvider.getToken(), productionProvider.getToken()]);
  assert.equal(recaptchaCalls, 1);
  assert.deepEqual(t1, t2);

  // Cached token reused while outside 2-minute buffer
  clock += 10 * 60 * 1000;
  await productionProvider.getToken();
  assert.equal(recaptchaCalls, 1);

  // Refreshes automatically inside 2-minute buffer
  clock += 19 * 60 * 1000;
  await productionProvider.getToken();
  assert.equal(recaptchaCalls, 2);

  // Works end-to-end with createFirebaseAccess in production mode without any debug flag
  const globals = {};
  let sdkProvider;
  const access = createFirebaseAccess({
    sdk: {
      CustomProvider: class { constructor(opts) { this.getToken = opts.getToken; } },
      GoogleAIBackend: class {},
      initializeApp: () => ({}),
      initializeAppCheck: (_app, cfg) => { sdkProvider = cfg.provider; return {}; },
      getAI: () => ({ authenticated: true }),
      getToken: async () => sdkProvider.getToken(),
    },
    config: firebaseConfig,
    env: { MODE: 'production' },
    globals,
    productionProvider,
    getInstallation: async () => ({ installType: 'normal', manifest: {} }),
  });

  const ai = await access.getAi();
  assert.deepEqual(ai, { authenticated: true });
  assert.equal(globals.FIREBASE_APPCHECK_DEBUG_TOKEN, undefined);
  assert.equal(access.debug, false);

  productionProvider.dispose();
  attestHost?.dispose();
});

test('Local Only never mounts the hosted iframe or touches Hosting/reCAPTCHA, and repo config/cleanup invariants hold', async () => {
  const pair = createPairedWindows();
  const productionProvider = createProductionAppCheckProvider({
    attestUrl: APP_CHECK_ATTEST_URL,
    doc: pair.doc,
    win: pair.parentWin,
  });

  const engine = createHeadlineEngine({
    getDeviceAi: () => ({ device: true }),
    getAi: async () => {
      await productionProvider.getToken();
      throw new Error('Local Only must never invoke cloud auth');
    },
    InferenceMode: { ONLY_ON_DEVICE: 'local', ONLY_IN_CLOUD: 'cloud' },
    getGenerativeModel: () => ({
      generateContent: async () => ({
        response: {
          inferenceSource: 'on_device',
          text: () => JSON.stringify({ results: [{ kind: 'clean', score: 0, triggers: [], honest_rewrite: 'City budget approved' }] }),
        },
      }),
    }),
    deviceAvailability: async () => 'available',
    prompt: () => 'City budget approved',
  });

  const [res] = await engine.scoreHeadlines(['City budget approved'], { localOnly: true });
  assert.equal(res.source, 'on-device');
  assert.equal(productionProvider.mounted, false, 'Local Only must never create the hosted attestation iframe');
  assert.equal(pair.attachedFrame, null);

  // Header-only custom issuer was removed cleanly while mintLiveVoiceToken remains intact
  assert.equal(fs.existsSync('functions/appCheckHandler.js'), false, 'header-only appCheckHandler.js must be removed');
  const fnIdx = fs.readFileSync('functions/index.js', 'utf8');
  assert.equal(fnIdx.includes('issueAppCheckToken'), false, 'functions/index.js must not export issueAppCheckToken');
  assert.ok(fnIdx.includes('export const mintLiveVoiceToken') && fnIdx.includes('enforceAppCheck: true'));

  // Hosting page & firebase.json CSP headers are wired properly
  const attestHtml = fs.readFileSync('hosting/attest.html', 'utf8');
  assert.ok(attestHtml.includes('ReCaptchaEnterpriseProvider') && attestHtml.includes('createAttestHost'));
  const fbCfg = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
  assert.equal(fbCfg.hosting?.public, 'hosting');
  const attestRule = fbCfg.hosting?.headers?.find((h) => h.source === '/attest.html');
  assert.ok(attestRule, 'firebase.json must define headers for /attest.html');
  const csp = attestRule.headers.find((h) => h.key === 'Content-Security-Policy')?.value || '';
  const cc = attestRule.headers.find((h) => h.key === 'Cache-Control')?.value || '';
  assert.match(csp, /^frame-ancestors chrome-extension:\/\//);
  assert.equal(cc, 'no-store');
  assert.equal(fbCfg.firestore?.rules, 'firestore.rules');
  assert.equal(fbCfg.functions?.[0]?.source, 'functions');
});
