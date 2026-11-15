// The active engine: real Gemini (Firebase AI Logic), falling back to the mock if it fails,
// so Debait keeps working while App Check or the network isn't ready.
import { mockEngine } from './mockEngine.js';
import { firebaseEngine } from './firebaseEngine.js';

export const USE_MOCK = false;

let lastError = null;

/** @type {import('./contract.js').Engine} */
export const engine = USE_MOCK ? mockEngine : {
  async scoreHeadlines(texts, opts) {
    try {
      const out = await firebaseEngine.scoreHeadlines(texts, opts);
      lastError = null;
      return out;
    } catch (err) {
      lastError = err;
      console.warn('[Debait] Gemini failed, using the mock engine:', err.message);
      if (opts.localOnly) throw err; // never fake results when the user asked for on-device only
      return mockEngine.scoreHeadlines(texts, opts);
    }
  },
  async getStatus(opts) {
    const s = await firebaseEngine.getStatus(opts);
    if (lastError && s.source === 'cloud') {
      const appCheck = /app check/i.test(lastError.message);
      return { ...s, source: 'mock', needsAppCheck: appCheck, message: appCheck ? 'Gemini is waiting for App Check approval' : `Gemini unavailable (${lastError.message})` };
    }
    return s;
  },
  initDeviceModel: () => firebaseEngine.initDeviceModel(),
};
