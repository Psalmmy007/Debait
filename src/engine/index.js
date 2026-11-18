// The active engine: real Gemini (Firebase AI Logic). Headlines show "Reading" for the second or
// two Gemini takes; the quick backup estimate is only used while Gemini is really unreachable,
// and those guesses are never counted in Weekly Mind Facts.
import { mockEngine } from './mockEngine.js';
import { firebaseEngine } from './firebaseEngine.js';

export const USE_MOCK = false;

const FIRST_TIMEOUT = 25000;   // the first answer also connects (App Check, picking the project)
const GEMINI_TIMEOUT = 20000;  // a working Gemini answers well within this (slow requests are re-sent after 4 s)
const RETRY_AFTER = 2 * 60 * 1000;     // after an App Check / permission rejection
const RETRY_SOON = 20 * 1000;          // after a passing server error (busy, network)
const retryDelay = (err) => (/app check|401|403|permission|api key/i.test(String(err?.message || err)) ? RETRY_AFTER : RETRY_SOON);

let gemini = 'unknown';        // unknown | ok | failing
let lastError = null;
let retryAt = 0;

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('Gemini took too long')), ms))]);

/** @type {import('./contract.js').Engine} */
export const engine = USE_MOCK ? mockEngine : {
  async scoreHeadlines(texts, opts) {
    if (opts.localOnly) {
      // on-device only: no backup guesses, but never hang if Gemini Nano isn't ready
      const st = await firebaseEngine.getStatus({ localOnly: true });
      if (st.source !== 'on-device') throw new Error(`LOCAL_ONLY: ${st.message}`);
      return withTimeout(firebaseEngine.scoreHeadlines(texts, opts), 30000);
    }
    // Gemini just failed: don't make every page wait on it; quick estimates until the retry time
    if (gemini === 'failing' && Date.now() < retryAt) return mockEngine.scoreHeadlines(texts, opts);
    try {
      const res = await withTimeout(firebaseEngine.scoreHeadlines(texts, opts), gemini === 'ok' ? GEMINI_TIMEOUT : FIRST_TIMEOUT);
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
    try {
      return await withTimeout(firebaseEngine.summarize(page, opts), 25000);
    } catch (err) {
      if (opts.localOnly) throw new Error(`LOCAL_ONLY: ${err.message}`);
      return mockEngine.summarize(page, opts);
    }
  },
};
