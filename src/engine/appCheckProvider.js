// Production App Check custom-token client adapter for Debait.
// Requests short-lived App Check tokens from the server-side Firebase Admin issuer
// (issueAppCheckToken on debait-d6d5d). Never embeds secrets or debug tokens and never
// persists issued tokens to storage.
import { appCheckSetupError } from './authPolicy.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_REFRESH_BUFFER_MS = 2 * 60 * 1000; // refresh 2 min before expiry

function parseRetryAfterMs(headerValue) {
  if (!headerValue) return undefined;
  const seconds = Number.parseInt(String(headerValue).trim(), 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return undefined;
}

export function createProductionAppCheckProvider({
  endpoint,
  appId,
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  refreshBufferMs = DEFAULT_REFRESH_BUFFER_MS,
  now = () => Date.now(),
} = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(endpoint || ''));
  } catch {
    parsedUrl = null;
  }
  if (!parsedUrl || parsedUrl.protocol !== 'https:') {
    return null;
  }

  let cached = null;
  let inflight = null;

  async function requestFreshToken() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('App Check token request timed out')), timeoutMs);
    let response;
    try {
      response = await fetchImpl(parsedUrl.href, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debait-Client': 'extension',
        },
        body: JSON.stringify({ appId }),
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError' || /timed? ?out/i.test(String(error?.message || ''))) {
        throw Object.assign(new Error('App Check token issuer timed out.'), { code: 'debait/timeout' });
      }
      throw Object.assign(new Error('Could not reach the production App Check token service.'), { code: 'debait/network' });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      throw appCheckSetupError(
        'Production App Check token service (issueAppCheckToken) is not deployed on debait-d6d5d yet. Local Only remains available on supported hardware.',
      );
    }
    if (response.status === 403 || response.status === 401) {
      throw appCheckSetupError(
        'Production App Check token service rejected this extension installation. Check allowed extension origins and App Check enforcement.',
      );
    }
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfterMs(response.headers?.get?.('retry-after'));
      throw Object.assign(
        new Error('App Check token requests are temporarily rate limited. Try again shortly.'),
        { code: 'debait/quota', retryAfterMs },
      );
    }
    if (!response.ok) {
      throw appCheckSetupError(
        'Production App Check token service returned an error. Cloud AI was not contacted.',
      );
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw appCheckSetupError('The trusted App Check provider returned an unreadable response.');
    }
    if (
      typeof data?.token !== 'string'
      || !data.token.trim()
      || !Number.isFinite(data?.expireTimeMillis)
      || data.expireTimeMillis <= now()
    ) {
      throw appCheckSetupError('The trusted App Check provider returned an invalid or expired token.');
    }

    const issued = { token: data.token, expireTimeMillis: data.expireTimeMillis };
    cached = issued;
    return issued;
  }

  return {
    endpoint: parsedUrl.href,
    async getToken() {
      if (cached && cached.expireTimeMillis - refreshBufferMs > now()) {
        return cached;
      }
      if (!inflight) {
        inflight = requestFreshToken().finally(() => { inflight = null; });
      }
      return inflight;
    },
    clearCache() {
      cached = null;
    },
  };
}
