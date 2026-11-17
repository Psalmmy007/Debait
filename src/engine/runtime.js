// Independent of Firebase so errors and timeouts can be tested without a project.
import { normalizeAssistance } from './assistance.js';
import { normalizeResult } from './contract.js';

export function createEngine({ firebaseEngine, mockEngine, demo = false, timeoutMs = 30000 }) {
  let lastError = null;
  let failureLocalOnly;
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
          if (!status.deviceAvailable && status.source !== 'on-device') throw new Error(`LOCAL_ONLY: ${status.message}`);
        }
        const results = await timed(() => firebaseEngine.scoreHeadlines(texts, opts));
        if (!Array.isArray(results) || results.length !== texts.length || results.some(r =>
          !['on-device', 'cloud'].includes(r?.source) || (opts.localOnly && r.source !== 'on-device'))) {
          throw new Error('Gemini returned an invalid inference source or incomplete results.');
        }
        lastError = null;
        const normalized = results.map((result, i) => normalizeResult(result, texts[i]));
        if (opts.evaluation) normalized.evaluationMetadata = results.evaluationMetadata;
        return normalized;
      } catch (error) {
        lastError = error;
        failureLocalOnly = opts.localOnly;
        throw error;
      }
    },
    async assistHeadline(text, opts) {
      try {
        if (opts.localOnly) {
          const status = await timed(() => firebaseEngine.getStatus({ localOnly: true }));
          if (!status.deviceAvailable && status.source !== 'on-device') throw new Error(`LOCAL_ONLY: ${status.message}`);
        }
        const result = await timed(() => firebaseEngine.assistHeadline(text, opts));
        if (opts.localOnly && result?.source !== 'on-device') throw new Error('LOCAL_ONLY: Cloud assistance cannot be used.');
        const checked = normalizeAssistance(result, text, opts.task, opts.kind);
        lastError = null;
        return checked;
      } catch (error) { lastError = error; failureLocalOnly = opts.localOnly; throw error; }
    },
    async getStatus(opts) {
      if (demo && !opts.localOnly) return mockEngine.getStatus(opts);
      const status = await timed(() => firebaseEngine.getStatus(opts));
      if (lastError && failureLocalOnly === opts.localOnly) return {
        ...status, ready: false, source: 'none', localOnly: opts.localOnly,
        needsAppCheck: lastError.needsAppCheck ?? /app check/i.test(lastError.message),
        message: `Analysis unavailable: ${lastError.message}`,
      };
      return status;
    },
    initDeviceModel: () => timed(() => firebaseEngine.initDeviceModel()),
  };
}
