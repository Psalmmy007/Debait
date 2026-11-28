// MV3 Offscreen Document iframe bridge for Hosted reCAPTCHA Enterprise App Check attestation.
// Lazily embeds https://debait-d6d5d.web.app/attest.html ONLY when production cloud inference
// calls requestToken(). Never loads during Local Only mode or development debug builds.
import { appCheckSetupError } from '../engine/authPolicy.js';

export const MSG_READY = 'debait/app-check-ready';
export const MSG_TOKEN_REQUEST = 'debait/app-check-token-request';
export const MSG_TOKEN_RESPONSE = 'debait/app-check-token-response';
const DEFAULT_TIMEOUT_MS = 15_000;

function makeRequestId(randomId) {
  if (typeof randomId === 'function') return randomId();
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `ac-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createOffscreenAppCheckBridge({
  attestUrl,
  doc = globalThis.document,
  win = globalThis.window,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => Date.now(),
  randomId,
} = {}) {
  let parsed;
  try {
    parsed = new URL(String(attestUrl || ''));
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== 'https:') return null;

  const expectedOrigin = parsed.origin;
  let iframe = null;
  let readyPromise = null;
  let readyResolve = null;
  let readyReject = null;
  let isReady = false;
  const pending = new Map();

  function onMessage(event) {
    if (!iframe || !iframe.contentWindow) return;
    if (event.origin !== expectedOrigin) return;
    if (event.source !== iframe.contentWindow) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === MSG_READY) {
      isReady = true;
      if (readyResolve) {
        const resolve = readyResolve;
        readyResolve = null;
        readyReject = null;
        resolve(msg.configured !== false);
      }
      return;
    }

    if (msg.type === MSG_TOKEN_RESPONSE && typeof msg.requestId === 'string' && pending.has(msg.requestId)) {
      const entry = pending.get(msg.requestId);
      pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      if (msg.ok === true && typeof msg.token === 'string' && msg.token.trim() && Number.isFinite(msg.expireTimeMillis) && msg.expireTimeMillis > now()) {
        entry.resolve({ token: msg.token, expireTimeMillis: msg.expireTimeMillis });
      } else {
        const code = msg.code === 'debait/app-check' ? 'debait/app-check' : 'debait/app-check-setup';
        const message = typeof msg.error === 'string' && msg.error.trim()
          ? msg.error.trim()
          : 'Hosted App Check attestation failed to return a valid token.';
        entry.reject(Object.assign(new Error(message), { code }));
      }
    }
  }

  function ensureFrame() {
    if (!doc || !win || typeof doc.createElement !== 'function' || !doc.body) {
      throw appCheckSetupError('Hosted App Check attestation requires the extension offscreen document.');
    }
    if (iframe && readyPromise) return readyPromise;

    isReady = false;
    win.addEventListener('message', onMessage);
    readyPromise = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });

    const el = doc.createElement('iframe');
    el.id = 'debait-app-check-attest';
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('referrerpolicy', 'no-referrer');
    el.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    el.style.cssText = 'display:none;width:0;height:0;border:0;position:fixed;';
    el.addEventListener('error', () => {
      if (readyReject) {
        const reject = readyReject;
        readyResolve = null;
        readyReject = null;
        reject(appCheckSetupError('Could not load the hosted App Check attestation page.'));
      }
    });
    el.src = parsed.href;
    doc.body.appendChild(el);
    iframe = el;
    return readyPromise;
  }

  function dispose() {
    if (win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('message', onMessage);
    }
    if (readyReject) {
      readyReject(appCheckSetupError('Hosted App Check attestation bridge was disposed.'));
    }
    readyPromise = null;
    readyResolve = null;
    readyReject = null;
    isReady = false;
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(appCheckSetupError('Hosted App Check attestation was cancelled.'));
    }
    pending.clear();
    if (iframe) {
      try { iframe.remove(); } catch { /* already detached */ }
      iframe = null;
    }
  }

  async function requestToken({ forceRefresh = false } = {}) {
    const waitReady = ensureFrame();
    let readyTimer;
    try {
      await Promise.race([
        waitReady,
        new Promise((_, reject) => {
          readyTimer = setTimeout(() => {
            reject(appCheckSetupError(
              'Hosted App Check attestation page (attest.html) did not respond. Verify Firebase Hosting deployment and frame-ancestors CSP for this extension ID.',
            ));
          }, timeoutMs);
        }),
      ]);
    } catch (err) {
      dispose();
      throw err;
    } finally {
      clearTimeout(readyTimer);
    }

    if (!iframe?.contentWindow) {
      throw appCheckSetupError('Hosted App Check attestation frame is unavailable.');
    }

    const requestId = makeRequestId(randomId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(Object.assign(new Error('Hosted App Check attestation timed out.'), { code: 'debait/timeout' }));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      try {
        iframe.contentWindow.postMessage(
          { type: MSG_TOKEN_REQUEST, requestId, forceRefresh: forceRefresh === true },
          expectedOrigin,
        );
      } catch {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(appCheckSetupError('Could not send request to hosted App Check attestation frame.'));
      }
    });
  }

  return {
    expectedOrigin,
    get mounted() { return Boolean(iframe); },
    get ready() { return isReady; },
    requestToken,
    dispose,
  };
}
