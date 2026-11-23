// Routing/lifecycle only: no classification policy, credentials or generated results.
export const HYBRID_BUDGETS = { device: 10000, localOnly: 150000, cloud: 25000, overall: 45000, localOverall: 240000, slowCooldown: 600000 };
export const cancelledInference = () => Object.assign(new Error('Analysis was cancelled. No new result was produced.'), { name: 'DebaitAiError', code: 'debait/cancelled' });
export const deviceTimeout = () => Object.assign(new Error('LOCAL_ONLY: Gemini Nano did not finish within its local processing budget. No cloud inference was used.'), { name: 'DebaitAiError', code: 'debait/local-timeout' });
export function checkSignal(signal) { if (signal?.aborted) throw cancelledInference(); }
export async function bounded(operation, { signal, timeoutMs, timeoutError = () => Object.assign(new Error('Gemini timed out. No analysis was produced.'), { name: 'DebaitAiError', code: 'debait/timeout' }) }) {
  checkSignal(signal);
  const controller = new AbortController(); let timer, reject;
  const stopped = new Promise((_, fail) => { reject = fail; });
  const abort = () => { controller.abort(); reject(cancelledInference()); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  timer = setTimeout(() => { controller.abort(); reject(timeoutError()); }, timeoutMs);
  try { checkSignal(signal); return await Promise.race([Promise.resolve().then(() => { checkSignal(controller.signal); return operation(controller.signal); }), stopped]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
}
// A cancelled SDK call retains its slot until the underlying promise actually settles.
// If Chrome ignores cancellation, do not accumulate another local prompt behind it.
export function createDeviceQueue(maxWaiting = 4) {
  let busy = false; const waiting = [];
  const advance = () => { busy = false; const next = waiting.shift(); if (next) next(); };
  return async (operation, signal) => {
    checkSignal(signal);
    if (busy) {
      if (waiting.length >= maxWaiting) throw Object.assign(new Error('Gemini Nano is busy. Wait for existing local analysis to finish.'), { name: 'DebaitAiError', code: 'debait/device-busy' });
      await new Promise((resolve, reject) => {
        const start = () => { signal?.removeEventListener('abort', abort); busy = true; resolve(); };
        const abort = () => { const i = waiting.indexOf(start); if (i >= 0) waiting.splice(i, 1); reject(cancelledInference()); };
        waiting.push(start); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      });
    } else busy = true;
    try { checkSignal(signal); return await operation(); }
    finally { advance(); }
  };
}
