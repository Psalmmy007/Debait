import { bounded, checkSignal, HYBRID_BUDGETS } from './hybrid.js';
// Independent of Firebase so errors and timeouts can be tested without a project.
import { normalizeAssistance } from './assistance.js';
import { normalizeResult } from './contract.js';

export function createEngine({ firebaseEngine, mockEngine, demo = false, timeoutMs }) {
  let lastError = null;
  let failureLocalOnly;
  const active = new Set();
  async function timed(operation, opts = {}, statusOnly = false) {
    const controller = new AbortController(); active.add(controller);
    const abort = () => controller.abort(); opts.signal?.addEventListener('abort', abort, { once: true });
    if (opts.signal?.aborted) abort();
    try {
      return await bounded(signal => operation(signal), { signal: controller.signal,
        timeoutMs: timeoutMs ?? (statusOnly ? 5000 : opts.localOnly ? HYBRID_BUDGETS.localOverall : HYBRID_BUDGETS.overall) });
    } finally { active.delete(controller); opts.signal?.removeEventListener('abort', abort); }
  }
  return {
    cancelAll() { for (const controller of active) controller.abort(); },
    async scoreHeadlines(texts, opts) {
      try {
        if (demo && !opts.localOnly) return await mockEngine.scoreHeadlines(texts, opts);
        const results = await timed(async signal => {
          if (opts.localOnly) {
            const status = await firebaseEngine.getStatus({ localOnly: true }); checkSignal(signal);
            if (!status.deviceAvailable && status.source !== 'on-device') throw new Error(`LOCAL_ONLY: ${status.message}`);
          }
          return firebaseEngine.scoreHeadlines(texts, { ...opts, signal });
        }, opts);
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
        const result = await timed(async signal => {
          if (opts.localOnly) {
            const status = await firebaseEngine.getStatus({ localOnly: true }); checkSignal(signal);
            if (!status.deviceAvailable && status.source !== 'on-device') throw new Error(`LOCAL_ONLY: ${status.message}`);
          }
          return firebaseEngine.assistHeadline(text, { ...opts, signal });
        }, opts);
        if (opts.localOnly && result?.source !== 'on-device') throw new Error('LOCAL_ONLY: Cloud assistance cannot be used.');
        const checked = normalizeAssistance(result, text, opts.task, opts.kind);
        lastError = null;
        return checked;
      } catch (error) { lastError = error; failureLocalOnly = opts.localOnly; throw error; }
    },
    async getStatus(opts) {
      if (demo && !opts.localOnly) return mockEngine.getStatus(opts);
      const status = await timed(() => firebaseEngine.getStatus(opts), opts, true);
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
