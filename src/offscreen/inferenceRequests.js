import { cancelledInference } from '../engine/hybrid.js';
const failure = () => Object.assign(new Error('The inference request could not be safely identified. Start a new evaluation.'), { code: 'debait/request-invalid' });
// IDs only, never headlines/results. Retain tombstones for late/reordered messages.
export function createInferenceRequests({ now = Date.now, retentionMs = 300000, limit = 256 } = {}) {
  const requests = new Map();
  const valid = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);
  function reserve(id) {
    if (!valid(id)) throw failure();
    for (const [key, value] of requests) if (!value.active && value.expires <= now()) requests.delete(key);
    if (!requests.has(id) && requests.size >= limit) throw failure(); // fail closed; never evict an unexpired cancellation
  }
  return {
    cancel(id) {
      reserve(id);
      const entry = requests.get(id) || { controller: new AbortController(), active: false };
      entry.controller.abort(); entry.expires = now() + retentionMs; requests.set(id, entry);
      return { ok: true, pendingRequest: entry.active };
    },
    async run(id, operation) {
      reserve(id);
      if (requests.has(id)) {
        if (requests.get(id).controller.signal.aborted) throw cancelledInference();
        throw failure(); // duplicate active/completed dispatch must not execute again
      }
      const entry = { controller: new AbortController(), active: true, expires: Infinity };
      requests.set(id, entry);
      try { return await operation(entry.controller.signal); }
      finally { entry.active = false; entry.expires = now() + retentionMs; }
    },
  };
}
