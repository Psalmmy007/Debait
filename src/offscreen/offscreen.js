// Hosts the engine. The service worker forwards requests here.
import { engine } from '../engine/index.js';
import { MSG, normalizeResult } from '../engine/contract.js';
import { startCall, endCall, inCall, toggleMute, isMuted } from './call.js';
import { setPreferredProject, preferredProject, projectSkips, applySkips } from '../engine/firebaseEngine.js';

// Start from what the service worker remembers: the Firebase project that answered last, and any
// project that rejected us (App Check). A fresh start then doesn't wait on a project that will fail.
let primed = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  if (!primed && msg.memory) {
    if (Number.isInteger(msg.memory.prefer)) setPreferredProject(msg.memory.prefer);
    applySkips(msg.memory.skips);
    primed = true;
  }
  const reply = (o) => sendResponse({ ...o, memory: { prefer: preferredProject(), skips: projectSkips() } });

  (async () => {
    try {
      if (msg.type === MSG.SCORE) {
        const raw = await engine.scoreHeadlines(msg.texts, { localOnly: msg.localOnly, debugToken: msg.debugToken });
        const results = msg.texts.map((t, i) => normalizeResult(raw?.[i], t));
        reply({ ok: true, results });
      } else if (msg.type === MSG.STATUS) {
        reply({ ok: true, status: await engine.getStatus({ localOnly: msg.localOnly }) });
      } else if (msg.type === 'debait/call-start') {
        startCall(msg.debugToken);
        reply({ ok: true });
      } else if (msg.type === 'debait/call-end') {
        await endCall();
        reply({ ok: true });
      } else if (msg.type === 'debait/call-status') {
        reply({ ok: true, inCall: inCall(), muted: isMuted() });
      } else if (msg.type === 'debait/call-mute-toggle') {
        reply({ ok: true, muted: toggleMute() });
      } else if (msg.type === 'debait/mic-state') {
        const p = await navigator.permissions.query({ name: 'microphone' }).catch(() => null);
        reply({ ok: true, state: p?.state || 'prompt' });
      } else if (msg.type === MSG.SUMMARY) {
        // stream the words to the tab that asked, through the service worker
        const onText = msg.stream && msg.tabId
          ? (text) => chrome.runtime.sendMessage({ type: 'debait/summary-chunk', tabId: msg.tabId, text }).catch(() => {})
          : undefined;
        reply({ ok: true, ...(await engine.summarize(msg.page, { localOnly: msg.localOnly, debugToken: msg.debugToken, onText })) });
      } else if (msg.type === MSG.INIT) {
        reply({ ok: true, status: await engine.initDeviceModel() });
      } else {
        reply({ ok: false, error: 'unknown message' });
      }
    } catch (err) {
      reply({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // keep the channel open for the async reply
});
