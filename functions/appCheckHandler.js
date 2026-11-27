// Production Firebase App Check custom-token issuer handler for Debait MV3 Chrome extension.
// Dependency-injected so unit tests verify origin checks, allowlist enforcement, atomic Firestore
// rate limiting, and token payload validation without requiring live Firestore or Admin credentials.
import { createHash } from 'node:crypto';
import {
  getTrustedClientIp,
  getTrustedProxyHops,
} from './mintHandler.js';

export const DEBAIT_WEB_APP_ID = '1:63438015732:web:54ab25a947b03005efa2a1';
export const APP_CHECK_TTL_MS = 30 * 60 * 1000;            // 30 min (minimum Admin SDK App Check TTL)
export const APP_CHECK_GLOBAL_BUCKET_ID = 'global_issue_app_check';
export const APP_CHECK_CALLER_MAX = 6;                     // max 6 tokens per 10 min per extension+IP
export const APP_CHECK_GLOBAL_MAX = 120;                   // global safety cap per 10 min
export const APP_CHECK_WINDOW_MS = 10 * 60 * 1000;
export const CHROME_EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/([a-p]{32})$/;

/** Parses optional comma-separated ALLOWED_EXTENSION_IDS env var into a Set (empty = allow any valid 32-char Chrome extension ID). */
export function parseAllowedExtensionIds(env = process.env) {
  const raw = String(env?.ALLOWED_EXTENSION_IDS || '').trim();
  if (!raw) return null;
  const ids = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((id) => /^[a-p]{32}$/.test(id));
  return new Set(ids);
}

/** Validates that Origin is a Chrome extension origin and returns { origin, extensionId } or null. */
export function parseExtensionOrigin(originHeader) {
  if (typeof originHeader !== 'string') return null;
  const trimmed = originHeader.trim();
  const match = CHROME_EXTENSION_ORIGIN_RE.exec(trimmed);
  if (!match) return null;
  return { origin: trimmed, extensionId: match[1] };
}

/** Deterministic SHA-256 caller doc ID bound to extensionId + Cloud Run/GCLB trusted client IP. */
export function getAppCheckCallerDocId(extensionId, req, trustedProxyHops = getTrustedProxyHops()) {
  const ip = getTrustedClientIp(req, trustedProxyHops);
  const hash = createHash('sha256').update(`appcheck:${extensionId}:ip:${ip}`).digest('hex');
  return `appcheck_${hash}`;
}

function getHeader(req, name) {
  const headers = req?.headers || {};
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Origin');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.status(status).send(JSON.stringify(payload));
}

export function createAppCheckTokenHandler({
  createToken,
  rateLimiter,
  appId = DEBAIT_WEB_APP_ID,
  ttlMillis = APP_CHECK_TTL_MS,
  allowedExtensionIds = parseAllowedExtensionIds(),
  trustedProxyHops = getTrustedProxyHops(),
  now = () => Date.now(),
  logger = console,
}) {
  if (typeof createToken !== 'function') {
    throw new Error('createAppCheckTokenHandler requires a createToken(appId, opts) function');
  }
  if (typeof rateLimiter !== 'function') {
    throw new Error('createAppCheckTokenHandler requires a rateLimiter(callerDocId) function');
  }

  return async function handleIssueAppCheckToken(req, res) {
    const parsedOrigin = parseExtensionOrigin(getHeader(req, 'origin'));
    if (!parsedOrigin) {
      return sendJson(res, 403, { error: 'Forbidden: Chrome extension origin required.' });
    }
    if (allowedExtensionIds && !allowedExtensionIds.has(parsedOrigin.extensionId)) {
      return sendJson(res, 403, { error: 'Forbidden: Extension ID is not permitted.' });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': parsedOrigin.origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Debait-Client',
      'Access-Control-Max-Age': '3600',
    };

    const method = String(req?.method || '').toUpperCase();
    if (method === 'OPTIONS') {
      for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);
      res.setHeader('Vary', 'Origin');
      return res.status(204).send('');
    }
    if (method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed. Use POST.' }, { ...corsHeaders, Allow: 'POST, OPTIONS' });
    }

    const clientHeader = String(getHeader(req, 'x-debait-client') || '').trim().toLowerCase();
    if (clientHeader !== 'extension') {
      return sendJson(res, 403, { error: 'Forbidden: Missing extension client header.' }, corsHeaders);
    }

    const body = req?.body && typeof req.body === 'object' ? req.body : {};
    if (body.appId !== undefined && body.appId !== appId) {
      return sendJson(res, 400, { error: 'Invalid Firebase appId.' }, corsHeaders);
    }

    const callerDocId = getAppCheckCallerDocId(parsedOrigin.extensionId, req, trustedProxyHops);
    const limit = await rateLimiter(callerDocId);
    if (!limit.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil((limit.retryAfterMs || 60000) / 1000));
      logger?.warn?.('issueAppCheckToken rate limit exceeded', {
        scope: limit.scope,
        retryAfterSec,
      });
      return sendJson(
        res,
        429,
        { error: 'Too many token requests. Wait and try again.', retryAfterMs: limit.retryAfterMs },
        { ...corsHeaders, 'Retry-After': String(retryAfterSec) },
      );
    }

    try {
      const issued = await createToken(appId, { ttlMillis });
      const token = issued?.token;
      const issuedTtl = Number.isFinite(issued?.ttlMillis) && issued.ttlMillis > 0 ? issued.ttlMillis : ttlMillis;
      if (typeof token !== 'string' || !token.trim()) {
        throw new Error('Admin App Check returned an empty token');
      }
      const expireTimeMillis = now() + issuedTtl;
      return sendJson(res, 200, { token, expireTimeMillis }, corsHeaders);
    } catch (err) {
      logger?.error?.('issueAppCheckToken mint failure', { message: err?.message || String(err) });
      return sendJson(res, 500, { error: 'Could not issue App Check token.' }, corsHeaders);
    }
  };
}
