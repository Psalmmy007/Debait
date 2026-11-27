// Core handler for mintLiveVoiceToken (dependency-injected so unit tests run with mocked
// @google/genai and a shared transactional store without requiring live Firestore).
import { createHash } from 'node:crypto';

export const ALLOWED_LIVE_MODELS = [
  'gemini-2.5-flash-native-audio-latest',
  'gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-native-audio-preview-09-2025',
];
export const LIVE_VOICE = 'Leda';
export const EPHEMERAL_API_VERSION = 'v1beta';
export const SESSION_TTL_MS = 30 * 60 * 1000;      // 30 min max live call duration
export const HANDSHAKE_WINDOW_MS = 60 * 1000;      // 60 s window to open the WebSocket
export const RATE_LIMIT_COLLECTION = '_rateLimits';
export const GLOBAL_BUCKET_ID = 'global_mint_live_voice';
export const RATE_LIMIT_MAX = 5;                   // max 5 tokens per minute per caller
export const GLOBAL_RATE_LIMIT_MAX = 30;           // global safety cap: max 30 tokens/min total
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;       // 1 = direct Cloud Run GFE; 2 = external GCLB + Cloud Run

/** Reads TRUSTED_PROXY_HOPS from env (defaults to 1 for direct Cloud Run / GFE). */
export function getTrustedProxyHops(env = process.env) {
  const parsed = Number.parseInt(env?.TRUSTED_PROXY_HOPS ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_TRUSTED_PROXY_HOPS;
}

/** True for loopback, RFC1918 private, link-local, or CGNAT internal proxy IPs. */
export function isInternalProxyIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const norm = ip.trim().replace(/^::ffff:/i, '').toLowerCase();
  if (!norm) return false;
  if (norm === '::1' || norm === 'localhost') return true;
  if (/^f[cd][0-9a-f]{0,2}:/i.test(norm) || /^fe[89ab][0-9a-f]:/i.test(norm)) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(norm)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(norm)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(norm)) return true;
  return false;
}

/**
 * Extracts the trusted client IP for Firebase Functions v2 (Cloud Run) without trusting
 * client-spoofable leftmost x-forwarded-for entries:
 * - Direct Cloud Run / Google Front End (TRUSTED_PROXY_HOPS=1): GFE appends the real client IP
 *   as the rightmost external entry (`spoofed, <clientIp>`).
 * - Behind an external Google Cloud Load Balancer (TRUSTED_PROXY_HOPS=2): GCLB appends both the
 *   client IP and the external forwarding-rule VIP (`spoofed, <clientIp>, <gclbVip>`), so the
 *   2nd entry from the right is the real client IP (avoiding grouping all callers under the LB IP).
 * - Trailing internal/loopback/private proxy hops are stripped from the right first so internal
 *   Google/VPC proxy IPs are never mistaken for the caller.
 */
export function getTrustedClientIp(rawRequest, trustedProxyHops = getTrustedProxyHops()) {
  const headers = rawRequest?.headers || {};
  const fwd = headers['x-forwarded-for'] ?? headers['X-Forwarded-For'];
  const headerStr = Array.isArray(fwd) ? fwd.join(',') : typeof fwd === 'string' ? fwd : '';
  const parts = headerStr.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length > 0) {
    let end = parts.length;
    while (end > 1 && isInternalProxyIp(parts[end - 1])) end--;
    const hops = Number.isFinite(trustedProxyHops) && trustedProxyHops >= 1 ? Math.floor(trustedProxyHops) : DEFAULT_TRUSTED_PROXY_HOPS;
    const idx = Math.max(0, end - hops);
    return parts[idx];
  }
  return String(rawRequest?.ip || 'unknown').trim() || 'unknown';
}

/**
 * Builds a deterministic, Firestore-safe SHA-256 caller document ID.
 * Prioritizes authenticated Firebase Auth uid when present; otherwise binds to
 * App Check appId + trusted client IP (accounting for Cloud Run / GCLB proxy hops).
 */
export function getCallerDocId(request, trustedProxyHops = getTrustedProxyHops()) {
  const appId = request?.app?.appId || 'no-app';
  const uid = request?.auth?.uid;
  const rawKey = uid
    ? `${appId}:uid:${uid}`
    : `${appId}:ip:${getTrustedClientIp(request?.rawRequest, trustedProxyHops)}`;
  const hash = createHash('sha256').update(rawKey).digest('hex');
  return `caller_${hash}`;
}

/** Wraps a Firestore instance in the minimal atomic transaction interface used by the limiter. */
export function createFirestoreRateLimitStore(db, collectionName = RATE_LIMIT_COLLECTION) {
  const col = db.collection(collectionName);
  return {
    runTransaction(fn) {
      return db.runTransaction(async (fsTx) => fn({
        async get(docId) {
          const snap = await fsTx.get(col.doc(docId));
          return snap.exists ? snap.data() : null;
        },
        set(docId, data) {
          fsTx.set(col.doc(docId), data);
        },
      }));
    },
  };
}

/**
 * Shared in-memory transactional store for unit tests (simulates Firestore runTransaction
 * serializable isolation across concurrent Promise.all calls and multiple handler instances).
 */
export function createMemoryTransactionStore() {
  const docs = new Map();
  let lock = Promise.resolve();
  return {
    docs,
    runTransaction(fn) {
      const prev = lock;
      let release;
      lock = new Promise((r) => { release = r; });
      return prev.then(async () => {
        const staged = new Map();
        const tx = {
          async get(docId) {
            await Promise.resolve(); // yield microtask so concurrent callers race realistically
            if (staged.has(docId)) return structuredClone(staged.get(docId));
            return docs.has(docId) ? structuredClone(docs.get(docId)) : null;
          },
          set(docId, data) {
            staged.set(docId, structuredClone(data));
          },
        };
        try {
          const result = await fn(tx);
          for (const [k, v] of staged) docs.set(k, v);
          return result;
        } finally {
          release();
        }
      });
    },
  };
}

/**
 * Atomic sliding-window rate limiter enforcing BOTH per-caller (5/min) and global (30/min) caps
 * inside a single transaction so concurrent requests and multiple instances cannot bypass limits.
 */
export function createAtomicRateLimiter(store, {
  callerMax = RATE_LIMIT_MAX,
  globalMax = GLOBAL_RATE_LIMIT_MAX,
  windowMs = RATE_LIMIT_WINDOW_MS,
  now = () => Date.now(),
} = {}) {
  if (!store || typeof store.runTransaction !== 'function') {
    throw new Error('createAtomicRateLimiter requires a transactional store with runTransaction()');
  }
  return async function checkLimit(callerDocId) {
    return store.runTransaction(async (tx) => {
      const t = now();
      const cutoff = t - windowMs;
      const [callerDoc, globalDoc] = await Promise.all([
        tx.get(callerDocId),
        tx.get(GLOBAL_BUCKET_ID),
      ]);

      const callerRecent = Array.isArray(callerDoc?.timestamps)
        ? callerDoc.timestamps.filter((ts) => typeof ts === 'number' && ts > cutoff)
        : [];
      const globalRecent = Array.isArray(globalDoc?.timestamps)
        ? globalDoc.timestamps.filter((ts) => typeof ts === 'number' && ts > cutoff)
        : [];

      if (globalRecent.length >= globalMax) {
        return {
          allowed: false,
          scope: 'global',
          remaining: 0,
          retryAfterMs: Math.max(1000, globalRecent[0] + windowMs - t),
        };
      }
      if (callerRecent.length >= callerMax) {
        return {
          allowed: false,
          scope: 'caller',
          remaining: 0,
          retryAfterMs: Math.max(1000, callerRecent[0] + windowMs - t),
        };
      }

      callerRecent.push(t);
      globalRecent.push(t);
      const expiresAt = new Date(t + windowMs * 2);
      tx.set(callerDocId, { timestamps: callerRecent, updatedAt: t, expiresAt });
      tx.set(GLOBAL_BUCKET_ID, { timestamps: globalRecent, updatedAt: t, expiresAt });

      return {
        allowed: true,
        scope: 'ok',
        remaining: callerMax - callerRecent.length,
        globalRemaining: globalMax - globalRecent.length,
        retryAfterMs: 0,
      };
    });
  };
}

/**
 * Builds the callable request handler for mintLiveVoiceToken.
 * Platform-level `enforceAppCheck: true` runs before this handler; we also defend in depth
 * on `request.app`, validate input, enforce atomic shared per-caller + global rate limits, and
 * lock the minted ephemeral token to allowlisted Live models, AUDIO modality, and LIVE_VOICE = 'Leda'.
 */
export function createMintHandler({
  getApiKey,
  createClient,
  HttpsErrorCtor,
  logger = { error: () => {} },
  now = () => Date.now(),
  trustedProxyHops = getTrustedProxyHops(),
  rateLimitStore = createMemoryTransactionStore(),
  rateLimiter = createAtomicRateLimiter(rateLimitStore, { now }),
}) {
  return async function handleMintLiveVoiceToken(request) {
    if (!request?.app?.appId) {
      throw new HttpsErrorCtor('unauthenticated', 'Valid Firebase App Check token is required.');
    }

    const data = request?.data;
    if (data != null && (typeof data !== 'object' || Array.isArray(data))) {
      throw new HttpsErrorCtor('invalid-argument', 'Request payload must be an object.');
    }

    let model = ALLOWED_LIVE_MODELS[0];
    if (data?.model !== undefined) {
      if (typeof data.model !== 'string' || !ALLOWED_LIVE_MODELS.includes(data.model.trim())) {
        throw new HttpsErrorCtor('invalid-argument', 'Unsupported Live voice model requested.');
      }
      model = data.model.trim();
    }

    const callerDocId = getCallerDocId(request, trustedProxyHops);
    const limit = await rateLimiter(callerDocId);
    if (!limit.allowed) {
      throw new HttpsErrorCtor(
        'resource-exhausted',
        limit.scope === 'global'
          ? 'Voice service is busy right now. Please try again in a minute.'
          : 'Too many voice session token requests. Please wait a minute and try again.',
      );
    }

    const apiKey = getApiKey();
    if (!apiKey || typeof apiKey !== 'string') {
      logger.error('GEMINI_API_KEY secret is not configured for mintLiveVoiceToken.');
      throw new HttpsErrorCtor('failed-precondition', 'Voice token service is missing GEMINI_API_KEY secret.');
    }

    try {
      const ai = createClient({
        apiKey,
        httpOptions: { apiVersion: EPHEMERAL_API_VERSION },
      });

      const ts = now();
      const expireTime = new Date(ts + SESSION_TTL_MS).toISOString();
      const newSessionExpireTime = new Date(ts + HANDSHAKE_WINDOW_MS).toISOString();

      const tokenRes = await ai.authTokens.create({
        config: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
          liveConnectConstraints: {
            model: `models/${model}`,
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: LIVE_VOICE },
                },
              },
            },
          },
        },
      });

      if (!tokenRes?.name || typeof tokenRes.name !== 'string') {
        throw new Error('Gemini authTokens.create returned an empty token');
      }

      return {
        token: tokenRes.name,
        model,
        apiVersion: EPHEMERAL_API_VERSION,
        expiresAt: expireTime,
      };
    } catch (err) {
      if (err instanceof HttpsErrorCtor) throw err;
      logger.error('mintLiveVoiceToken failed', { message: err?.message || String(err), model });
      throw new HttpsErrorCtor('internal', 'Failed to mint ephemeral Gemini Live token.');
    }
  };
}
