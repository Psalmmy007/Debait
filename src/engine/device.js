export const DEVICE_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};
export async function deviceAvailability(model = globalThis.LanguageModel) {
  try {
    if (!model) return 'unavailable';
    return await model.availability(DEVICE_OPTIONS);
  } catch { return 'unavailable'; }
}
