import { normalizeResult } from '../engine/contract.js';

export const EVALUATION_PAGE = 'dev/evaluation/index.html';
const fail = (code, message) => Object.assign(new Error(message), { code });
export function evaluationError(error) {
  const messages = {
    'debait/evaluation-forbidden': 'Evaluation is only available from the unpacked development extension page.',
    'debait/evaluation-busy': 'Another evaluation batch is still finishing. Please wait before starting again.',
    'debait/evaluation-interrupted': 'The extension or evaluation session changed. Start a new run; unfinished rows were not analyzed.',
    'debait/evaluation-cancelled': 'Evaluation cancelled. No result was recorded for this batch.',
    'debait/evaluation-privacy': 'Privacy settings changed. Start a new run using the current Local Only setting.',
    'debait/evaluation-input': 'Use 1–8 nonempty headlines of at most 320 characters.',
    'debait/quota-pacing': 'Waiting for the shared local request slot.',
    'debait/quota': 'Gemini rate limit: waiting for the shared cooldown.',
    'debait/quota-daily': 'The local daily request budget is exhausted. Continue with a new run another day.',
    'debait/invalid-classification': 'AI returned unsupported classification evidence. No result was recorded.',
    'debait/app-check': 'App Check authentication failed. Check the existing development registration.',
    'debait/app-check-setup': 'App Check is not configured for this development installation.',
    'debait/auth': 'Firebase authentication failed. No result was recorded.',
    'debait/access': 'Firebase denied access. No result was recorded.',
    'debait/network': 'Firebase could not be reached. No result was recorded.',
    'debait/inference': 'Gemini could not complete the request. Check authentication and model availability; Local Only never uses cloud inference.',
    'debait/device-config': 'Chrome could not load the device model configuration. Check the existing Gemini Nano setup; no cloud fallback is permitted in Local Only.',
    'debait/local-timeout': 'Gemini Nano exceeded its local processing budget. No cloud inference was used.',
    'debait/cancelled': 'Analysis was cancelled. No result was recorded.',
    'debait/device-busy': 'Gemini Nano is busy with an existing local request. Try again later.',
    'debait/device-unavailable': 'Gemini Nano is unavailable or needs a user-initiated download. Local Only did not use cloud inference.',
    'debait/model': 'The configured Gemini model is unavailable.',
  };
  const code = Object.hasOwn(messages, error?.code) ? error.code : 'debait/evaluation-failed';
  return { ok: false, code, error: messages[code] || 'Analysis failed. No result was recorded.',
    ...(Number.isFinite(error?.retryAt) ? { retryAt: error.retryAt, autoRetry: error.autoRetry === true } : {}) };
}

// No datasets, results, credentials or browser history are written here. Only the
// existing shared quota gate persists its normal scalar scheduling state.
export function createEvaluationService({ authorize, settings, revision, gate, infer, metadata, uuid = () => crypto.randomUUID() }) {
  let session;
  const check = async current => {
    if (current !== session) throw fail('debait/evaluation-interrupted');
    if (current.cancelled) throw fail('debait/evaluation-cancelled');
    if (revision() !== current.revision || (await settings()).localOnly !== current.localOnly) throw fail('debait/evaluation-privacy');
  };
  return {
    async handle(msg, sender) {
      await authorize(sender);
      const owner = sender.documentId;
      if (msg.type === 'debait/evaluation-begin') {
        if (session?.busy) throw fail('debait/evaluation-busy');
        const policy = await settings();
        if (session?.busy) throw fail('debait/evaluation-busy');
        session = { id: uuid(), owner, cancelled: false, busy: false, localOnly: policy.localOnly, revision: revision() };
        return { ok: true, runId: session.id, localOnly: session.localOnly,
          startedAt: new Date().toISOString(), ...metadata };
      }
      const current = session;
      if (!current || current.id !== msg.runId || current.owner !== owner) throw fail('debait/evaluation-interrupted');
      if (msg.type === 'debait/evaluation-cancel' || msg.type === 'debait/evaluation-end') {
        current.cancelled = true;
        return { ok: true, pendingRequest: current.busy };
      }
      if (msg.type !== 'debait/evaluation-score') throw fail('debait/evaluation-input');
      if (current.busy) throw fail('debait/evaluation-busy');
      if (!Array.isArray(msg.texts) || !msg.texts.length || msg.texts.length > 8 ||
          msg.texts.some(t => typeof t !== 'string' || !t.trim() || t.length > 320)) throw fail('debait/evaluation-input');
      current.busy = true;
      try {
        await check(current);
        const execute = async () => {
          // Check again immediately before dispatch, after any asynchronous scheduling.
          await check(current);
          const response = await infer({ texts: msg.texts, localOnly: current.localOnly });
          await check(current);
          if (!Array.isArray(response.results) || response.results.length !== msg.texts.length) throw fail('debait/evaluation-failed');
          const results = response.results.map((r, i) => normalizeResult(r, msg.texts[i]));
          if (results.some(r => !['cloud', 'on-device'].includes(r.source) || (current.localOnly && r.source !== 'on-device'))) {
            throw fail('debait/evaluation-failed');
          }
          // Whitelist scalar provenance; no provider payloads or credentials.
          const input = response.evaluationMetadata || {};
          const safe = {};
          for (const key of ['configuredModel', 'sdkVersion']) {
            safe[key] = typeof input[key] === 'string' && /^[a-zA-Z0-9._/-]{1,100}$/.test(input[key]) ? input[key] : 'unknown';
          }
          return { ok: true, results, evaluationMetadata: { ...safe, resolvedModelVersion: 'unknown' } };
        };
        return current.localOnly ? await execute() : await gate.run(execute);
      } finally { current.busy = false; }
    },
  };
}
