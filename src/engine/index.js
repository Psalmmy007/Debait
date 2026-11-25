// The active engine: real Gemini (Firebase AI Logic).
// Never silently substitute heuristic mock classifications when AI is unavailable or offline.
// Mock mode is used ONLY when USE_MOCK is explicitly enabled for local UI preview.
import { mockEngine } from './mockEngine.js';
import { firebaseEngine, isOnline, deviceQueueDepth, LOCAL_BUDGET, cancelActiveCloudRequests } from './firebaseEngine.js';
import { NO_SUMMARY_TEXT, hasEnoughSummaryText } from './contract.js';

export const USE_MOCK = false;

const FIRST_TIMEOUT = 30000;   // the first answer also connects (App Check)
const GEMINI_TIMEOUT = 25000;  // Nano gets 10 s before the cloud is asked; cloud has an 8 s per-request cap
// Local only / offline: Nano is the only engine and runs one prompt at a time, each with its own
// LOCAL_BUDGET once its turn comes (firebaseEngine.js). So the overall limit covers the requests
// already waiting ahead of this one (plus an optional second rewrite pass when scoring).
const deviceTimeout = (passes = 1) => LOCAL_BUDGET * (deviceQueueDepth() + passes) + 15000;
const SUMMARY_TIMEOUT = 30000;
const RETRY_AFTER = 2 * 60 * 1000;     // after an App Check / permission rejection
const RETRY_SOON = 5 * 1000;           // after a passing server error (busy, network)
const retryDelay = (err) => (/app ?check|401|403|permission|api key/i.test(String(err?.message || err)) ? RETRY_AFTER : RETRY_SOON);

let gemini = 'unknown';        // unknown | ok | failing
let lastError = null;
let retryAt = 0;

// Clear any transient offline/network lockout the moment connectivity returns.
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('online', () => {
    if (gemini === 'failing' && !/app ?check|401|403|permission|api key/i.test(String(lastError?.message || ''))) {
      gemini = 'unknown';
      retryAt = 0;
    }
  });
}

/**
 * Runs run(signal) with a time limit. When the limit passes, the work is really cancelled (an
 * on-device Gemini Nano request keeps the computer busy otherwise), not just stopped waiting on.
 */
function withTimeout(run, ms, message = 'Gemini took too long') {
  const ctrl = new AbortController();
  let timer;
  const limit = new Promise((_, no) => {
    timer = setTimeout(() => {
      const err = new Error(message);
      ctrl.abort(err);
      no(err);
    }, ms);
  });
  const work = Promise.resolve().then(() => run(ctrl.signal));
  work.catch(() => {}); // prevent uncaught rejections if timeout settles first
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}
const isAbort = (err) => err?.name === 'AbortError' || /aborted|LOCAL_ONLY_SWITCH|cancelled/i.test(String(err?.message || ''));
const asLocalError = (err) => (/LOCAL_ONLY/.test(err?.message) ? err : new Error(`LOCAL_ONLY_FAILED: ${err?.message || err}`));
const LOCAL_SLOW_MSG = 'LOCAL_ONLY_SLOW: Gemini Nano did not finish in time on this computer';
const OFFLINE_SLOW_MSG = 'OFFLINE_SLOW: Gemini Nano did not finish in time on this computer';

export function cancelCloudRequests() {
  cancelActiveCloudRequests();
}

/** @type {import('./contract.js').Engine} */
export const engine = USE_MOCK ? mockEngine : {
  async scoreHeadlines(texts, opts = {}) {
    if (opts.localOnly || !isOnline()) {
      // Nano only (Local only, or no network): never use cloud and never fake AI with heuristics
      const local = !!opts.localOnly;
      const st = await firebaseEngine.getStatus({ localOnly: local });
      if (st.source !== 'on-device') {
        if (local) throw new Error(`LOCAL_ONLY: ${st.message}`);
        throw new Error(`OFFLINE_UNAVAILABLE: ${st.message}`);
      }
      try {
        return await withTimeout((signal) => firebaseEngine.scoreHeadlines(texts, { ...opts, signal }), deviceTimeout(2), local ? LOCAL_SLOW_MSG : OFFLINE_SLOW_MSG);
      } catch (err) {
        if (local) throw asLocalError(err);
        throw new Error(`OFFLINE_UNAVAILABLE: ${err?.message || err}`);
      }
    }
    // Gemini just failed: fail honestly until the retry window instead of faking AI results
    if (gemini === 'failing' && Date.now() < retryAt) {
      throw new Error(`AI_UNAVAILABLE: ${lastError?.message || 'Gemini is temporarily unavailable'}`);
    }
    try {
      const res = await withTimeout((signal) => firebaseEngine.scoreHeadlines(texts, { ...opts, signal }), gemini === 'ok' ? GEMINI_TIMEOUT : FIRST_TIMEOUT);
      gemini = 'ok';
      lastError = null;
      return res;
    } catch (err) {
      if (!isAbort(err)) {
        gemini = 'failing';
        lastError = err;
        retryAt = Date.now() + retryDelay(err);
        console.debug('[Debait] Gemini unavailable:', err.message);
      }
      throw new Error(`AI_UNAVAILABLE: ${err?.message || err}`);
    }
  },
  async getStatus(opts = {}) {
    const s = await firebaseEngine.getStatus(opts);
    if (gemini === 'failing' && s.source === 'cloud') {
      const appCheck = /app ?check|401|403/i.test(lastError?.message || '');
      return {
        ...s,
        ready: false,
        source: 'none',
        needsAppCheck: appCheck,
        message: appCheck ? 'Cloud AI blocked until App Check debug token is registered' : `Gemini unavailable (${lastError?.message})`,
      };
    }
    return s;
  },
  initDeviceModel: () => firebaseEngine.initDeviceModel(),
  async summarize(page, opts = {}) {
    if (!hasEnoughSummaryText(page)) return { summary: NO_SUMMARY_TEXT, source: 'none' };
    if (opts.localOnly || !isOnline()) {
      const local = !!opts.localOnly;
      const st = await firebaseEngine.getStatus({ localOnly: local });
      if (st.source !== 'on-device') {
        throw new Error(`${local ? 'LOCAL_ONLY' : 'OFFLINE_UNAVAILABLE'}: ${st.message}`);
      }
    }
    try {
      const nanoOnly = opts.localOnly || !isOnline();
      const out = await withTimeout((signal) => firebaseEngine.summarize(page, { ...opts, signal }), nanoOnly ? deviceTimeout(1) : SUMMARY_TIMEOUT,
        opts.localOnly ? LOCAL_SLOW_MSG : nanoOnly ? OFFLINE_SLOW_MSG : undefined);
      if (out?.source === 'cloud') {
        gemini = 'ok';
        lastError = null;
      }
      return out;
    } catch (err) {
      if (opts.localOnly) throw asLocalError(err);
      throw new Error(`${!isOnline() ? 'OFFLINE_UNAVAILABLE' : 'AI_UNAVAILABLE'}: ${err?.message || err}`);
    }
  },
};
