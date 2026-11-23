import { bounded, cancelledInference, checkSignal } from '../engine/hybrid.js';
const cancelPending = () => Object.assign(new Error('Cancellation could not be confirmed. Results are discarded; reload the extension before retrying if it remains unresponsive.'), { code: 'debait/evaluation-cancel-pending' });
// AbortSignal never crosses Chrome serialization. It guards preparation locally;
// a separate, acknowledged ID-only message revokes the offscreen request.
export function createInferenceTransport({ prepare, send, contexts, cancelTimeoutMs = 3000 }) {
  return {
    async infer(payload, signal) {
      checkSignal(signal); let abort;
      const stopped = new Promise((_, reject) => { abort = () => reject(cancelledInference()); });
      signal?.addEventListener('abort', abort, { once: true });
      const operation = (async () => {
        checkSignal(signal);
        const prepared = await prepare(payload, signal); checkSignal(signal);
        return send({ target: 'offscreen', ...prepared });
      })();
      try { return await Promise.race([operation, stopped]); }
      finally { signal?.removeEventListener('abort', abort); }
    },
    async cancel(requestId) {
      return bounded(async () => {
        if (!(await contexts()).length) return { ok: true, pendingRequest: false };
        const reply = await send({ target: 'offscreen', type: 'debait/cancel-inference', requestId });
        if (reply?.ok !== true) throw cancelPending();
        return reply;
      }, { timeoutMs: cancelTimeoutMs, timeoutError: cancelPending });
    },
  };
}
