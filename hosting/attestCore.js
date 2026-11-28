// Hosted Firebase App Check (ReCaptchaEnterpriseProvider) attestation core.
// Runs ONLY inside an iframe embedded by an explicitly allowlisted chrome-extension://<id> origin.
// Note on trust model: a reCAPTCHA Enterprise assessment is a web abuse/risk signal, NOT absolute
// cryptographic proof of extension binary authenticity; frame-ancestors CSP + exact origin/source
// checks bound token delivery to the allowlisted extension context.
// Dependency-injected so unit tests verify every trust-boundary check without live Firebase/reCAPTCHA.

export const MSG_READY = 'debait/app-check-ready';
export const MSG_TOKEN_REQUEST = 'debait/app-check-token-request';
export const MSG_TOKEN_RESPONSE = 'debait/app-check-token-response';
export const CHROME_EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;
export const FALLBACK_TTL_MS = 50 * 60 * 1000; // conservative fallback if JWT exp cannot be decoded

/** True when a placeholder config value has not been replaced before deployment. */
export function isPlaceholderValue(value) {
  return typeof value !== 'string' || !value.trim() || /^__[A-Z0-9_]+__$/.test(value.trim());
}

/** Filters allowed origins strictly to valid 32-char Chrome extension origins (never '*', never http/https). */
export function normalizeAllowedOrigins(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const origin = raw.trim();
    if (CHROME_EXTENSION_ORIGIN_RE.test(origin) && !out.includes(origin)) {
      out.push(origin);
    }
  }
  return out;
}

/** Extracts `exp` (ms) from a Firebase App Check JWT payload; falls back safely if unreadable. */
export function parseJwtExpiryMs(token, now = () => Date.now()) {
  if (typeof token !== 'string') return 0;
  const parts = token.split('.');
  if (parts.length !== 3) return now() + FALLBACK_TTL_MS;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = typeof atob === 'function'
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (Number.isFinite(payload?.exp) && payload.exp > 0) {
      return Math.floor(payload.exp * 1000);
    }
  } catch {
    // Non-JWT or malformed payload: fall back to conservative future TTL.
  }
  return now() + FALLBACK_TTL_MS;
}

/**
 * Initializes the hosted App Check attestation boundary inside an iframe.
 * - Refuses execution when not embedded in an iframe (`win.parent === win`).
 * - Refuses execution when `siteKey` or `allowedOrigins` is missing or still a placeholder.
 * - Validates `event.origin` against `allowedOrigins` and `event.source === win.parent`.
 * - Replies strictly via `win.parent.postMessage(payload, event.origin)` — NEVER `'*'`.
 */
export function createAttestHost({
  win = globalThis.window,
  sdk,
  firebaseConfig,
  siteKey,
  allowedOrigins,
  now = () => Date.now(),
}) {
  if (!win || !win.parent || win.parent === win) {
    return {
      active: false,
      reason: 'standalone-forbidden',
      dispose() {},
    };
  }

  const origins = normalizeAllowedOrigins(allowedOrigins);
  const configured = !isPlaceholderValue(siteKey) && origins.length > 0;
  let appCheck = null;

  function ensureAppCheck() {
    if (!configured) {
      throw new Error('Hosted reCAPTCHA Enterprise attestation is not configured (site key or allowed extension origin missing).');
    }
    if (!appCheck) {
      const app = sdk.initializeApp(firebaseConfig, 'debait-attest');
      appCheck = sdk.initializeAppCheck(app, {
        provider: new sdk.ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: false,
      });
    }
    return appCheck;
  }

  async function onMessage(event) {
    if (!event || event.source !== win.parent) return;
    if (typeof event.origin !== 'string' || !origins.includes(event.origin)) return;
    const msg = event.data;
    if (!msg || msg.type !== MSG_TOKEN_REQUEST) return;
    const requestId = typeof msg.requestId === 'string' && msg.requestId.length <= 128 ? msg.requestId : null;
    if (!requestId) return;

    const targetOrigin = event.origin;
    try {
      const ac = ensureAppCheck();
      const result = await sdk.getToken(ac, msg.forceRefresh === true);
      const token = result?.token;
      if (typeof token !== 'string' || !token.trim()) {
        throw new Error('App Check did not return a token.');
      }
      const expireTimeMillis = Number.isFinite(result?.expireTimeMillis) && result.expireTimeMillis > now()
        ? result.expireTimeMillis
        : parseJwtExpiryMs(token, now);
      if (!Number.isFinite(expireTimeMillis) || expireTimeMillis <= now()) {
        throw new Error('App Check returned an expired token.');
      }
      win.parent.postMessage(
        { type: MSG_TOKEN_RESPONSE, requestId, ok: true, token, expireTimeMillis },
        targetOrigin,
      );
    } catch (err) {
      win.parent.postMessage(
        {
          type: MSG_TOKEN_RESPONSE,
          requestId,
          ok: false,
          code: configured ? 'debait/app-check' : 'debait/app-check-setup',
          error: configured
            ? 'Hosted reCAPTCHA Enterprise App Check attestation failed.'
            : String(err?.message || 'Hosted reCAPTCHA Enterprise attestation is not configured.'),
        },
        targetOrigin,
      );
    }
  }

  win.addEventListener('message', onMessage);

  // Announce readiness strictly to each allowlisted chrome-extension:// origin (never '*').
  for (const targetOrigin of origins) {
    try {
      win.parent.postMessage({ type: MSG_READY, configured }, targetOrigin);
    } catch {
      // Ignore origins that do not match the embedding parent.
    }
  }

  return {
    active: true,
    configured,
    allowedOrigins: origins,
    dispose() {
      win.removeEventListener('message', onMessage);
    },
  };
}
