// Production App Check custom-token adapter backed by the MV3 offscreen document's
// hosted ReCaptchaEnterpriseProvider iframe (https://debait-d6d5d.web.app/attest.html).
// Lazily mounts the iframe ONLY when cloud inference requests a token; Local Only never triggers it.
import { createOffscreenAppCheckBridge } from '../offscreen/appCheckBridge.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_REFRESH_BUFFER_MS = 2 * 60 * 1000; // refresh 2 min before expiry

export function createProductionAppCheckProvider({
  attestUrl,
  bridge,
  doc,
  win,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  refreshBufferMs = DEFAULT_REFRESH_BUFFER_MS,
  now = () => Date.now(),
  randomId,
} = {}) {
  const activeBridge = bridge || createOffscreenAppCheckBridge({
    attestUrl,
    doc,
    win,
    timeoutMs,
    now,
    randomId,
  });
  if (!activeBridge) return null;

  let cached = null;
  let inflight = null;

  async function fetchToken() {
    const issued = await activeBridge.requestToken({ forceRefresh: false });
    cached = issued;
    return issued;
  }

  return {
    expectedOrigin: activeBridge.expectedOrigin,
    get mounted() { return Boolean(activeBridge.mounted); },
    async getToken() {
      if (cached && cached.expireTimeMillis - refreshBufferMs > now()) {
        return cached;
      }
      if (!inflight) {
        inflight = fetchToken().finally(() => { inflight = null; });
      }
      return inflight;
    },
    clearCache() {
      cached = null;
    },
    dispose() {
      cached = null;
      inflight = null;
      activeBridge.dispose?.();
    },
  };
}
