import { retryDelayMs } from '../shared/quota.js';

// Show actionable categories without copying provider payloads, URLs or tokens to the UI/logs.
export function describeAiError(error) {
  const code = String(error?.code || '');
  const text = `${code} ${error?.message || ''}`;
  const status = error?.customData?.httpErrorCode ?? error?.customData?.status;
  if (code === 'debait/invalid-classification') return {
    code, needsAppCheck: false,
    message: 'AI returned an unsupported classification or missing headline evidence. No analysis was produced. Please retry.',
  };
  if (/execution config/i.test(text)) return {
    code: 'debait/device-config', needsAppCheck: false,
    message: 'Chrome could not load the on-device model execution configuration. Check Chrome and its model setup. Local Only will not use cloud inference.',
  };
  if (code === 'debait/app-check-setup') return { code, needsAppCheck: true, message: error.message };
  if (/app.?check|exchangeDebugToken/i.test(text)) return {
    code: 'debait/app-check', needsAppCheck: true,
    message: 'App Check could not authenticate this installation. For an unpacked debug build, register its debug token in the non-production Firebase app. For production, check the trusted token provider. Enforcement must stay enabled.',
  };
  if (status === 401 || /\b401\b|unauthenticated|unauthorized/i.test(text)) return {
    code: 'debait/auth', needsAppCheck: false,
    message: 'Firebase rejected authentication. Check App Check registration and project access; no analysis was produced.',
  };
  if (status === 403 || /\b403\b|permission.denied|forbidden/i.test(text)) return {
    code: 'debait/access', needsAppCheck: false,
    message: 'Firebase denied access. Check App Check, API restrictions and project permissions. A 403 alone does not identify which setting failed.',
  };
  if (status === 404 || /\b404\b|model.*(not found|unavailable|not supported)|not.found/i.test(text)) return {
    code: 'debait/model', needsAppCheck: false,
    message: 'The configured Gemini model is unavailable for this project or API. Verify the model ID and project access. No mock results were substituted.',
  };
  if (status === 429 || /\b429\b|quota|resource.exhausted/i.test(text)) return {
    code: 'debait/quota', needsAppCheck: false, retryAfterMs: retryDelayMs(error),
    message: 'Gemini usage is temporarily limited. Check the development project quota and retry later.',
  };
  if (/fetch|network|offline/i.test(text)) return {
    code: 'debait/network', needsAppCheck: false,
    message: 'Firebase could not be reached. Check connectivity and retry. No analysis was produced.',
  };
  return { code: 'debait/inference', needsAppCheck: false, message: 'Gemini could not complete the request. No analysis was produced. Retry or inspect the development setup.' };
}
export function aiError(error) {
  if (error?.name === 'DebaitAiError') return error;
  const details = describeAiError(error);
  return Object.assign(new Error(details.message), details, { name: 'DebaitAiError' });
}
