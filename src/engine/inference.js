import { bounded, checkSignal, createDeviceQueue, deviceTimeout, HYBRID_BUDGETS } from './hybrid.js';
import { normalizeResult } from './contract.js';
import { assistancePrompt, normalizeAssistance } from './assistance.js';
import { aiError, invalidAssistance } from './errors.js';

// The same adapter is used by the extension and tested with controlled SDK responses.
export function createHeadlineEngine({ getAi, getDeviceAi, getGenerativeModel, InferenceMode,
  cloudModel, cloudSchema, deviceSchema, lang, prompt, deviceAvailability, createDevice, sdkVersion = 'unknown', assistantCloudSchemas = {}, assistantDeviceSchemas = {}, budgets = HYBRID_BUDGETS, now = Date.now }) {
  let lastSource = null, deviceSlowUntil = 0;
  const deviceQueue = createDeviceQueue();
  async function perform(texts, { localOnly, debugToken, evaluation = false, signal }, task, kind) {
    try {
      const input = task ? assistancePrompt(texts[0], task, kind) : prompt(texts);
      const run = (onDevice, parent) => bounded(async requestSignal => {
        const invoke = async () => {
          checkSignal(requestSignal);
          const ai = onDevice ? getDeviceAi() : await getAi(debugToken);
          checkSignal(requestSignal);
          const model = getGenerativeModel(ai, {
            mode: onDevice ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.ONLY_IN_CLOUD,
            inCloudParams: { model: cloudModel, generationConfig: { responseMimeType: 'application/json',
              responseSchema: task ? assistantCloudSchemas[task] : cloudSchema, temperature: 0.2, maxOutputTokens: 2048 } },
            onDeviceParams: { createOptions: { expectedInputs: lang, expectedOutputs: lang, signal: requestSignal },
              promptOptions: { responseConstraint: task ? assistantDeviceSchemas[task] : deviceSchema, signal: requestSignal } },
          });
          const result = await model.generateContent(input, { signal: requestSignal, timeout: onDevice ? (localOnly ? budgets.localOnly : budgets.device) : budgets.cloud });
          checkSignal(requestSignal); return result;
        };
        return onDevice ? deviceQueue(invoke, requestSignal) : invoke();
      }, { signal: parent, timeoutMs: onDevice ? (localOnly ? budgets.localOnly : budgets.device) : budgets.cloud,
        ...(onDevice ? { timeoutError: deviceTimeout } : {}) });
      checkSignal(signal);
      const available = await bounded(() => deviceAvailability ? deviceAvailability() : 'unavailable', { signal, timeoutMs: 2000 }).catch(error => {
        checkSignal(signal); if (localOnly) throw error; return 'unavailable';
      });
      checkSignal(signal);
      let generated, expected;
      if (localOnly || (available === 'available' && now() >= deviceSlowUntil)) {
        if (available !== 'available') throw Object.assign(new Error('LOCAL_ONLY: Gemini Nano is unavailable or needs a user-initiated download. No cloud inference was used.'), { name: 'DebaitAiError', code: 'debait/device-unavailable' });
        try { generated = await run(true, signal); expected = 'on-device'; }
        catch (error) {
          checkSignal(signal);
          if (localOnly) throw error;
          deviceSlowUntil = now() + budgets.slowCooldown;
        }
      }
      checkSignal(signal);
      if (!generated) { generated = await run(false, signal); expected = 'cloud'; }
      const { response } = generated;
      const source = { on_device: 'on-device', in_cloud: 'cloud' }[response.inferenceSource];
      if (source !== expected) throw new Error('Invalid inference source for the selected execution mode');
      if (!source || (localOnly && source !== 'on-device')) throw new Error('Invalid inference source');
      let data;
      try { data = JSON.parse(response.text().trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); }
      catch (error) { if (task && error instanceof SyntaxError) throw invalidAssistance('format'); throw error; }
      if (task) {
        const result = normalizeAssistance(task === 'rewrite' ? { honest_rewrite: data?.honest_rewrite, source } : { simple_explanation: data?.simple_explanation, definitions: data?.definitions, missing_context: data?.missing_context, source }, texts[0], task, kind);
        lastSource = source;
        return result;
      }
      const list = Array.isArray(data) ? data : data?.results;
      if (!Array.isArray(list) || list.length !== texts.length) throw new Error('Incomplete model response');
      const results = list.map((item, i) => normalizeResult({ kind: item?.kind, score: item?.score, triggers: item?.triggers, honest_rewrite: item?.honest_rewrite, source }, texts[i]));
      lastSource = source;
      if (evaluation) results.evaluationMetadata = { configuredModel: cloudModel || 'unknown', sdkVersion };
      return results;
    } catch (error) { lastSource = null; throw aiError(error); }

  }
  return {
    scoreHeadlines: (texts, options) => perform(texts, options),
    assistHeadline: (text, options) => perform([text], options, options.task, options.kind),
    async getStatus({ localOnly }) {
      const device = await deviceAvailability();
      const verified = lastSource && (!localOnly || lastSource === 'on-device');
      return {
        ready: !!verified, source: verified ? lastSource : 'none', localOnly,
        deviceAvailable: device === 'available',
        canDownloadDevice: device === 'downloadable' || device === 'downloading',
        message: verified ? `Last successful analysis: ${lastSource === 'cloud' ? 'Gemini cloud' : 'Gemini Nano on this device'}.`
          : localOnly ? device === 'available' ? 'Gemini Nano is available; inference has not been verified yet.'
            : device === 'unavailable' ? 'LOCAL_ONLY: This computer cannot run Gemini Nano.'
              : 'LOCAL_ONLY: Download Gemini Nano using Turn on Debait.'
          : 'No successful Gemini analysis verified in this AI session. Previously analyzed headlines may still display from saved results. A new live request is needed to verify current access.',
      };
    },
    async initDeviceModel() {
      const device = await deviceAvailability();
      if (device === 'downloadable' || device === 'downloading') {
        try {
          const session = await createDevice({ expectedInputs: lang, expectedOutputs: lang });
          session.destroy();
        } catch {
          return { ready: false, source: 'none', localOnly: false, canDownloadDevice: true,
            message: 'Gemini Nano could not download. Use Turn on Debait in the popup and check hardware support.' };
        }
      }
      return this.getStatus({ localOnly: false });
    },
  };
}
