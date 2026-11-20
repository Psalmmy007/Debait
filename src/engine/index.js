// The active engine: real Gemini (Firebase AI Logic). Headlines show "Reading" for the second or
// two Gemini takes; the quick backup estimate is only used while Gemini is really unreachable,
// and those guesses are never counted in Weekly Mind Facts.
import { mockEngine } from './mockEngine.js';
import { firebaseEngine } from './firebaseEngine.js';

export const USE_MOCK = false;

const FIRST_TIMEOUT = 30000;   // the first answer also connects (App Check, picking the project)
const GEMINI_TIMEOUT = 25000;  // Nano gets 10 s before the cloud is asked; a slow cloud request is re-sent after 4 s
const LOCAL_TIMEOUT = 4 * 60 * 1000; // Local only: Nano can take minutes on slower computers (each request
                                     // also has its own 150 s budget once its turn comes; see firebaseEngine.js)
const SUMMARY_TIMEOUT = 30000;
const RETRY_AFTER = 2 * 60 * 1000;     // after an App Check / permission rejection
const RETRY_SOON = 20 * 1000;          // after a passing server error (busy, network)
const retryDelay = (err) => (/app check|401|403|permission|api key/i.test(String(err?.message || err)) ? RETRY_AFTER : RETRY_SOON);

let gemini = 'unknown';        // unknown | ok | failing
let lastError = null;
let retryAt = 0;

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
  return Promise.race([run(ctrl.signal), limit]).finally(() => clearTimeout(timer));
}
const asLocalError = (err) => (/LOCAL_ONLY/.test(err?.message) ? err : new Error(`LOCAL_ONLY_FAILED: ${err?.message || err}`));

/** @type {import('./contract.js').Engine} */
export const engine = USE_MOCK ? mockEngine : {
  async scoreHeadlines(texts, opts) {
    if (opts.localOnly) {
      // on-device only: no backup guesses, but never hang if Gemini Nano isn't ready
      const st = await firebaseEngine.getStatus({ localOnly: true });
      if (st.source !== 'on-device') throw new Error(`LOCAL_ONLY: ${st.message}`);
      try {
        return await withTimeout((signal) => firebaseEngine.scoreHeadlines(texts, { ...opts, signal }), LOCAL_TIMEOUT, 'LOCAL_ONLY_SLOW: Gemini Nano did not finish in time on this computer');
      } catch (err) {
        throw asLocalError(err);
      }
    }
    // Gemini just failed: don't make every page wait on it; quick estimates until the retry time
    if (gemini === 'failing' && Date.now() < retryAt) return mockEngine.scoreHeadlines(texts, opts);
    try {
      const res = await withTimeout((signal) => firebaseEngine.scoreHeadlines(texts, { ...opts, signal }), gemini === 'ok' ? GEMINI_TIMEOUT : FIRST_TIMEOUT);
      gemini = 'ok';
      lastError = null;
      return res;
    } catch (err) {
      gemini = 'failing';
      lastError = err;
      retryAt = Date.now() + retryDelay(err);
      console.debug('[Debait] Gemini unavailable, using quick estimates for now:', err.message);
      return mockEngine.scoreHeadlines(texts, opts);
    }
  },
  async getStatus(opts) {
    const s = await firebaseEngine.getStatus(opts);
    if (gemini !== 'ok' && s.source === 'cloud') {
      const appCheck = /app check|401|403/i.test(lastError?.message || '');
      return {
        ...s,
        source: 'mock',
        needsAppCheck: appCheck,
        message: appCheck ? 'Gemini is waiting for App Check approval' : gemini === 'unknown' ? 'Connecting to Gemini…' : `Gemini unavailable (${lastError?.message})`,
      };
    }
    return s;
  },
  initDeviceModel: () => firebaseEngine.initDeviceModel(),
  async summarize(page, opts) {
    if (opts.localOnly) {
      const st = await firebaseEngine.getStatus({ localOnly: true });
      if (st.source !== 'on-device') throw new Error(`LOCAL_ONLY: ${st.message}`);
    }
    try {
      return await withTimeout((signal) => firebaseEngine.summarize(page, { ...opts, signal }), opts.localOnly ? LOCAL_TIMEOUT : SUMMARY_TIMEOUT,
        opts.localOnly ? 'LOCAL_ONLY_SLOW: Gemini Nano did not finish in time on this computer' : undefined);
    } catch (err) {
      if (opts.localOnly) throw asLocalError(err);
      return mockEngine.summarize(page, opts);
    }
  },
};
