// Routing/lifecycle only: no classification policy, credentials or generated results.
export const HYBRID_BUDGETS = { device: 10000, deviceQueue: 10000, localQueue: 90000, localOnly: 150000, cloud: 25000, overall: 45000, localOverall: 240000, slowCooldown: 600000 };
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
// Acquiring a slot and running a prompt have separate deadlines. A lease is
// released by physical SDK settlement, never merely by an outer timeout.
export function createDeviceQueue(maxWaiting = 4) {
  let busy = false; const waiting = [];
  const queueError = () => Object.assign(new Error('Gemini Nano is busy. The bounded wait for a local processing slot ended.'), { name: 'DebaitAiError', code: 'debait/device-busy' });
  const advance = () => { busy = false; const next = waiting.shift(); if (next) next(); };
  const lease = () => { let released = false; return () => { if (!released) { released = true; advance(); } }; };
  const acquire = async (signal, timeoutMs = HYBRID_BUDGETS.localQueue) => {
    checkSignal(signal);
    if (!busy) { busy = true; return lease(); }
    if (waiting.length >= maxWaiting) throw queueError();
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      const remove = error => { const i = waiting.indexOf(start); if (i >= 0) waiting.splice(i, 1); cleanup(); reject(error); };
      const abort = () => remove(cancelledInference());
      const start = () => { cleanup(); busy = true; resolve(lease()); };
      waiting.push(start);
      timer = setTimeout(() => remove(queueError()), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    });
  };
  const run = async (operation, signal) => {
    const release = await acquire(signal);
    try { checkSignal(signal); return await operation(); } finally { release(); }
  };
  run.acquire = acquire;
  return run;
}
