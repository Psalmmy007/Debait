// Independent of Firebase so errors and timeouts can be tested without a project.
import { normalizeResult } from './contract.js';

export function createEngine({ firebaseEngine, mockEngine, demo = false, timeoutMs = 30000 }) {
  let lastError = null;
  async function timed(operation) {
    let timer;
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Gemini timed out. No analysis was produced.')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async scoreHeadlines(texts, opts) {
      try {
        if (demo && !opts.localOnly) return await mockEngine.scoreHeadlines(texts, opts);
        if (opts.localOnly) {
          const status = await timed(() => firebaseEngine.getStatus({ localOnly: true }));
          if (status.source !== 'on-device') throw new Error(`LOCAL_ONLY: ${status.message}`);
        }
        const results = await timed(() => firebaseEngine.scoreHeadlines(texts, opts));
        if (!Array.isArray(results) || results.length !== texts.length || results.some(r =>
          !['on-device', 'cloud'].includes(r?.source) || (opts.localOnly && r.source !== 'on-device'))) {
          throw new Error('Gemini returned an invalid inference source or incomplete results.');
        }
        lastError = null;
        return results.map((result, i) => normalizeResult(result, texts[i]));
      } catch (error) {
        lastError = error;
        throw error;
      }
    },
    async getStatus(opts) {
      if (demo && !opts.localOnly) return mockEngine.getStatus(opts);
      if (lastError) return {
        ready: false, source: 'none', localOnly: opts.localOnly,
        needsAppCheck: /app check|401|403/i.test(lastError.message),
        message: `Analysis unavailable: ${lastError.message}`,
      };
      return timed(() => firebaseEngine.getStatus(opts));
    },
    initDeviceModel: () => timed(() => firebaseEngine.initDeviceModel()),
  };
}
