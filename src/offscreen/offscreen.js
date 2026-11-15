// Hosts the engine. The service worker forwards requests here.
import { engine } from '../engine/index.js';
import { MSG, normalizeResult } from '../engine/contract.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;

  (async () => {
    try {
      if (msg.type === MSG.SCORE) {
        const raw = await engine.scoreHeadlines(msg.texts, { localOnly: msg.localOnly, debugToken: msg.debugToken });
        const results = msg.texts.map((t, i) => normalizeResult(raw?.[i], t));
        sendResponse({ ok: true, results });
      } else if (msg.type === MSG.STATUS) {
        sendResponse({ ok: true, status: await engine.getStatus({ localOnly: msg.localOnly }) });
      } else if (msg.type === MSG.INIT) {
        sendResponse({ ok: true, status: await engine.initDeviceModel() });
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // keep the channel open for the async reply
});
