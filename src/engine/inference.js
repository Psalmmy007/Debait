import { normalizeResult } from './contract.js';
import { aiError } from './errors.js';

// The same adapter is used by the extension and tested with controlled SDK responses.
export function createHeadlineEngine({ getAi, getDeviceAi, getGenerativeModel, InferenceMode,
  cloudModel, cloudSchema, deviceSchema, lang, prompt, deviceAvailability, createDevice }) {
  let lastSource = null;
  return {
    async scoreHeadlines(texts, { localOnly, debugToken }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      try {
        const ai = localOnly ? getDeviceAi() : await getAi(debugToken);
        if (controller.signal.aborted) throw new Error('Gemini request timed out before inference');
        const model = getGenerativeModel(ai, {
          mode: localOnly ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.PREFER_ON_DEVICE,
          inCloudParams: {
            model: cloudModel,
            generationConfig: { responseMimeType: 'application/json', responseSchema: cloudSchema, temperature: 0.2, maxOutputTokens: 2048 },
          },
          onDeviceParams: {
            createOptions: { expectedInputs: lang, expectedOutputs: lang },
            promptOptions: { responseConstraint: deviceSchema },
          },
        });
        const { response } = await model.generateContent(prompt(texts), { signal: controller.signal, timeout: 25000 });
        if (controller.signal.aborted) throw new Error('Gemini request timed out');
        const source = { on_device: 'on-device', in_cloud: 'cloud' }[response.inferenceSource];
        if (!source || (localOnly && source !== 'on-device')) throw new Error('Invalid inference source');
        const data = JSON.parse(response.text().trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
        const list = Array.isArray(data) ? data : data?.results;
        if (!Array.isArray(list) || list.length !== texts.length) throw new Error('Incomplete model response');
        const results = list.map((item, i) => normalizeResult({ ...item, source }, texts[i]));
        lastSource = source;
        return results;
      } catch (error) {
        lastSource = null;
        throw aiError(error);
      } finally { clearTimeout(timer); }
    },
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
          : 'No successful Gemini analysis yet. Cloud authentication and model access are not verified.',
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
