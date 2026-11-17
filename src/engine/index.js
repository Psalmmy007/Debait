// The active engine: real Gemini (Firebase AI Logic) once it's confirmed working, the fast
// backup engine until then. Pages never wait on a Gemini connection that isn't ready:
// the first request answers instantly from the backup and checks Gemini in the background.
import { mockEngine } from './mockEngine.js';
import { firebaseEngine } from './firebaseEngine.js';

export const USE_MOCK = false;

const GEMINI_TIMEOUT = 15000;  // a working Gemini answers well within this (batches run in parallel)
const PROBE_TIMEOUT = 20000;   // the background check can take longer (first connection, model load)
const RETRY_AFTER = 2 * 60 * 1000;

let gemini = 'unknown';        // unknown | ok | failing
let lastError = null;
let retryAt = 0;
let probing = null;

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('Gemini took too long')), ms))]);

function probe(text, opts) {
  if (probing || (gemini === 'failing' && Date.now() < retryAt)) return;
  probing = withTimeout(firebaseEngine.scoreHeadlines([text], opts), PROBE_TIMEOUT)
    .then(() => { gemini = 'ok'; lastError = null; })
    .catch((err) => {
      gemini = 'failing';
      lastError = err;
      retryAt = Date.now() + RETRY_AFTER;
      console.debug('[Debait] Gemini not available yet, using the backup engine:', err.message);
    })
    .finally(() => { probing = null; });
}

/** @type {import('./contract.js').Engine} */
export const engine = USE_MOCK ? mockEngine : {
  async scoreHeadlines(texts, opts) {
    if (opts.localOnly) {
      // on-device only: no backup guesses, but never hang if Gemini Nano isn't ready
      const st = await firebaseEngine.getStatus({ localOnly: true });
      if (st.source !== 'on-device') throw new Error(`LOCAL_ONLY: ${st.message}`);
      return withTimeout(firebaseEngine.scoreHeadlines(texts, opts), 30000);
    }
    if (gemini !== 'ok') {
      probe(texts[0], opts);
      return mockEngine.scoreHeadlines(texts, opts);
    }
    try {
      return await withTimeout(firebaseEngine.scoreHeadlines(texts, opts), GEMINI_TIMEOUT);
    } catch (err) {
      gemini = 'failing';
      lastError = err;
      retryAt = Date.now() + RETRY_AFTER;
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
