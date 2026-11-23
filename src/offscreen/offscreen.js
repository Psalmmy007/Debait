import { createInferenceRequests } from './inferenceRequests.js';
import { assistanceReason } from '../engine/errors.js';
// Hosts the engine. The service worker forwards requests here.
import { engine } from '../engine/index.js';
import { MSG, normalizeResult } from '../engine/contract.js';
// Voice is deliberately excluded from this release's offscreen bundle.
const endCall = async () => {};
const inCall = () => false;
const inferenceRequests = createInferenceRequests();
const requireWorker = sender => { if (sender.id !== chrome.runtime.id || sender.tab) throw new Error('Only extension background contexts may control inference.'); };
const scoped = (msg, sender, operation) => {
  if (!Object.hasOwn(msg, 'requestId')) return operation(undefined);
  requireWorker(sender); return inferenceRequests.run(msg.requestId, operation);
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;

  (async () => {
    try {
      if (msg.type === 'debait/cancel-inference') {
        requireWorker(_sender);
        if (Object.hasOwn(msg, 'requestId')) sendResponse(inferenceRequests.cancel(msg.requestId));
        else { engine.cancelAll(); sendResponse({ ok: true }); }
      } else if (msg.type === 'debait/engine-ready') {
        sendResponse({ ok: true, ready: true });
      } else if (msg.type === MSG.SCORE) {
        const raw = await scoped(msg, _sender, signal => engine.scoreHeadlines(msg.texts, { localOnly: msg.localOnly, debugToken: msg.debugToken, evaluation: msg.evaluation === true, signal }));
        const results = msg.texts.map((t, i) => normalizeResult(raw?.[i], t));
        sendResponse({ ok: true, results, ...(msg.evaluation ? { evaluationMetadata: raw.evaluationMetadata } : {}) });
      } else if (msg.type === MSG.ASSIST) {
        const result = await scoped(msg, _sender, signal => engine.assistHeadline(msg.text, { task: msg.task, kind: msg.kind, localOnly: msg.localOnly, debugToken: msg.debugToken, signal }));
        sendResponse({ ok: true, result });
      } else if (msg.type === MSG.STATUS) {
        sendResponse({ ok: true, status: await engine.getStatus({ localOnly: msg.localOnly }) });
      } else if (msg.type === 'debait/call-start') {
        sendResponse({ ok: false, error: 'Voice is unavailable in this release candidate.' });
      } else if (msg.type === 'debait/call-end') {
        await endCall();
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/call-status') {
        sendResponse({ ok: true, inCall: inCall() });
      } else if (msg.type === 'debait/mic-state') {
        const p = await navigator.permissions.query({ name: 'microphone' }).catch(() => null);
        sendResponse({ ok: true, state: p?.state || 'prompt' });
      } else if (msg.type === MSG.INIT) {
        sendResponse({ ok: true, status: await engine.initDeviceModel() });
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err), code: err.code, reason: assistanceReason(err), retryAfterMs: err.retryAfterMs });
    }
  })();
  return true; // keep the channel open for the async reply
});
