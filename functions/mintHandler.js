// Core handler for mintLiveVoiceToken (dependency-injected so unit tests run with mocked @google/genai).
export const ALLOWED_LIVE_MODELS = [
  'gemini-2.5-flash-native-audio-latest',
  'gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-native-audio-preview-09-2025',
];
export const LIVE_VOICE = 'Leda';
export const EPHEMERAL_API_VERSION = 'v1beta';
export const SESSION_TTL_MS = 30 * 60 * 1000;      // 30 min max live call duration
export const HANDSHAKE_WINDOW_MS = 60 * 1000;      // 60 s window to open the WebSocket
export const RATE_LIMIT_MAX = 5;                   // max 5 tokens per minute per caller
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_TRACKED_CALLERS = 5000;

export function getCallerKey(request) {
  const appId = request?.app?.appId || 'no-app';
  const uid = request?.auth?.uid;
  if (uid) return `${appId}:uid:${uid}`;
  const fwd = request?.rawRequest?.headers?.['x-forwarded-for'];
  const rawIp = typeof fwd === 'string' && fwd.trim()
    ? fwd.split(',')[0].trim()
    : request?.rawRequest?.ip || 'unknown';
  return `${appId}:ip:${rawIp}`;
}

export function createRateLimiter({
  maxRequests = RATE_LIMIT_MAX,
  windowMs = RATE_LIMIT_WINDOW_MS,
  now = () => Date.now(),
} = {}) {
  const buckets = new Map();
  return function checkLimit(key) {
    const t = now();
    const cutoff = t - windowMs;
    const prev = buckets.get(key) || [];
    const recent = prev.filter((ts) => ts > cutoff);
    if (recent.length >= maxRequests) {
      buckets.set(key, recent);
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(1000, recent[0] + windowMs - t) };
    }
    recent.push(t);
    buckets.set(key, recent);
    // Keep warm-container memory bounded even under spoofed/rotating caller keys.
    if (buckets.size > MAX_TRACKED_CALLERS) {
      for (const [k, list] of buckets) {
        if (!list.some((ts) => ts > cutoff)) buckets.delete(k);
        if (buckets.size <= MAX_TRACKED_CALLERS) break;
      }
      if (buckets.size > MAX_TRACKED_CALLERS) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) buckets.delete(oldestKey);
      }
    }
    return { allowed: true, remaining: maxRequests - recent.length, retryAfterMs: 0 };
  };
}

/**
 * Builds the callable request handler for mintLiveVoiceToken.
 * Platform-level `enforceAppCheck: true` runs before this handler; we also defend in depth
 * on `request.app`, validate input, enforce per-caller sliding-window rate limits, and lock
 * the minted ephemeral token to allowlisted Live models, AUDIO modality, and LIVE_VOICE = 'Leda'.
 */
export function createMintHandler({
  getApiKey,
  createClient,
  HttpsErrorCtor,
  logger = { error: () => {} },
  now = () => Date.now(),
  rateLimiter = createRateLimiter({ now }),
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

    const callerKey = getCallerKey(request);
    const limit = rateLimiter(callerKey);
    if (!limit.allowed) {
      throw new HttpsErrorCtor(
        'resource-exhausted',
        'Too many voice session token requests. Please wait a minute and try again.',
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
