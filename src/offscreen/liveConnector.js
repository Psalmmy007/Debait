import { aiError, describeAiError } from '../engine/errors.js';

// Public SDK APIs only. A resumption handle is used only with the same configured model.
export function createLiveConnector({ getAi, getLiveGenerativeModel, models, parameters, reserve = async () => {},
  rateLimited = async () => {}, timeoutMs = 25000 }) {
  const sessionModels = new WeakMap();
  return async (debugToken, assertAllowed, { handle, previousSession } = {}) => {
    let expired = false, timer;
    const operation = (async () => {
      await assertAllowed();
      const ai = await getAi(debugToken);
      await assertAllowed();
      const choices = handle ? [sessionModels.get(previousSession)].filter(Boolean) : models;
      if (!choices.length) throw new Error('No supported Live model or resumption model configured.');
      for (const model of choices) {
        await assertAllowed();
        if (expired) throw new Error('Live connection timed out.');
        while (true) {
          try { await reserve(); break; }
          catch (error) {
            if (error.code !== 'debait/quota-pacing' || !Number.isFinite(error.retryAt)) throw error;
            await new Promise(resolve => setTimeout(resolve, Math.min(timeoutMs, Math.max(1, error.retryAt - Date.now()))));
            await assertAllowed();
            if (expired) throw Object.assign(new Error('Live connection timed out while waiting for a request slot.'), { code: 'debait/timeout' });
          }
        }
        await assertAllowed();
        if (expired) throw new Error('Live connection timed out.');
        try {
          const session = await getLiveGenerativeModel(ai, { ...parameters, model }).connect(handle ? { handle } : {});
          if (expired) { await session.close(); throw new Error('Live connection timed out.'); }
          sessionModels.set(session, model);
          return session;
        } catch (error) {
          const details = describeAiError(error);
          if (details.code === 'debait/quota') await rateLimited(details.retryAfterMs).catch(() => {});
          const status = Number(error?.customData?.httpErrorCode ?? error?.customData?.status);
          if (handle || status !== 404) throw aiError(error);
          if (model === choices.at(-1)) throw aiError(error);
        }
      }
    })();
    try {
      return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => {
        expired = true; reject(Object.assign(new Error('Live connection timed out. No microphone audio was sent.'), { code: 'debait/timeout' }));
      }, timeoutMs); })]);
    } catch (error) { throw error.code?.startsWith('debait/quota') || /^LOCAL_ONLY/.test(error.message || '') ? error : aiError(error); }
    finally { clearTimeout(timer); }
  };
}
