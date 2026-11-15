import { aiError, describeAiError } from '../engine/errors.js';

export function createLiveConnector({ getAi, getLiveGenerativeModel, models, parameters }) {
  return async (debugToken, assertAllowed) => {
    // Authentication may take time; recheck privacy after it completes.
    let ai;
    try { ai = await getAi(debugToken); } catch (error) { throw aiError(error); }
    await assertAllowed();
    let lastError;
    for (const model of models) {
      await assertAllowed();
      try {
        return await getLiveGenerativeModel(ai, { ...parameters, model }).connect();
      } catch (error) {
        // A different model cannot fix authentication, permissions, quota or connectivity.
        if (describeAiError(error).code !== 'debait/model') throw aiError(error);
        lastError = error;
      }
    }
    throw aiError(lastError || new Error('No Live model configured'));
  };
}
