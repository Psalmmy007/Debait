// Service worker: routes messages, keeps the score cache and the daily stats.
import { MSG, normalizeResult } from '../engine/contract.js';
import { getSettings, dayKey, emptyDay } from '../shared/storage.js';
import { DEMO_MODE } from '../engine/mode.js';
import { debugAppCheckAllowed, installationType } from '../engine/authPolicy.js';
import { createDebugTokenStore, readDebugToken, writeDebugToken } from '../engine/debugTokenStore.js';

const OFFSCREEN_URL = 'src/offscreen/index.html';

// ---------- problems log (shown in the popup) ----------
async function logError(where, message) {
  const { debaitErrors = [] } = await chrome.storage.local.get('debaitErrors');
  debaitErrors.unshift({ at: new Date().toISOString(), where, message: String(message).slice(0, 600) });
  await chrome.storage.local.set({ debaitErrors: debaitErrors.slice(0, 15) });
}
self.addEventListener('error', (e) => { logError('background', e.message || e.error); });
self.addEventListener('unhandledrejection', (e) => { logError('background', e.reason?.stack || e.reason); });

// ---------- developer convenience: reload when a new build lands in dist/ ----------
const UNPACKED = !('update_url' in chrome.runtime.getManifest());
let buildStamp = null;
async function checkBuild() {
  if (!UNPACKED) return;
  try {
    const s = await (await fetch(chrome.runtime.getURL('build.json'), { cache: 'no-store' })).text();
    if (buildStamp && s !== buildStamp) chrome.runtime.reload();
    buildStamp = s;
  } catch { /* no stamp yet */ }
}
checkBuild();
chrome.alarms?.create('debait-build-check', { periodInMinutes: 0.5 });
chrome.alarms?.onAlarm.addListener((a) => { if (a.name === 'debait-build-check') checkBuild(); });

// ---------- put Debait into tabs that were already open (after install, update or reload) ----------
chrome.runtime.onInstalled.addListener(async () => {
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js || [];
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files }).catch(() => {});
});
const CACHE_MAX = 3000;
let privacyRevision = 0;
let localOnlyActive = false;

async function voiceAllowed() {
  const settings = await getSettings();
  return !localOnlyActive && !settings.localOnly && settings.voice;
}
async function requireVoiceAllowed() {
  if (!await voiceAllowed()) throw new Error('LOCAL_ONLY: Cloud voice is disabled. Turn off Local Only before starting voice.');
}

// ---------- offscreen engine host ----------
let creating = null;
async function ensureOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url],
  });
  if (existing.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['DOM_PARSER', 'USER_MEDIA', 'AUDIO_PLAYBACK'],
        justification: 'Runs the on-device AI (Prompt API) and Firebase AI Logic to score headlines, and the live voice call (microphone and spoken replies).',
      })
      .finally(() => { creating = null; });
  }
  await creating;
}

// Only unpacked, explicit debug builds create a development credential.
const developmentToken = createDebugTokenStore({
  read: () => readDebugToken(indexedDB),
  write: token => writeDebugToken(indexedDB, token),
  local: chrome.storage.local,
  randomUUID: () => crypto.randomUUID(),
});
async function debugToken() {
  if (!debugAppCheckAllowed(import.meta.env, chrome.runtime.getManifest(), await installationType())) {
    await chrome.storage.local.remove('appCheckDebugToken');
    return undefined;
  }
  return developmentToken();
}

async function toEngine(payload) {
  await ensureOffscreen();
  const token = await debugToken();
  if (payload.type === MSG.SCORE) {
    const settings = await getSettings();
    payload = { ...payload, localOnly: localOnlyActive || settings.localOnly || payload.localOnly };
  }
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', debugToken: token, ...payload });
  if (!res?.ok) throw new Error(res?.error || 'engine error');
  return res;
}

// ---------- cache (never score the same headline twice) ----------
let cache = null; // Map<text, result>
async function loadCache() {
  if (cache) return cache;
  const { scoreCache = [] } = await chrome.storage.local.get('scoreCache');
  cache = new Map(scoreCache);
  return cache;
}
let saveTimer = null;
function saveCacheSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const entries = [...cache.entries()].slice(-CACHE_MAX);
    chrome.storage.local.set({ scoreCache: entries });
  }, 1000);
}

// ---------- daily stats for Weekly Mind Facts ----------
// Real numbers only: a headline counts once per day, and only when Gemini (on-device or cloud)
// analysed it. Backup-engine guesses are never counted.
let statsQueue = Promise.resolve();
const shortHash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

// one-time reset: older versions counted backup-engine results too
statsQueue = statsQueue.then(async () => {
  const { statsVersion } = await chrome.storage.local.get('statsVersion');
  if (statsVersion !== 2) await chrome.storage.local.set({ stats: {}, statsVersion: 2 });
});

function recordStats(results, host, texts) {
  statsQueue = statsQueue.then(async () => {
    const { stats = {} } = await chrome.storage.local.get('stats');
    const key = dayKey();
    const day = { ...emptyDay(), ...(stats[key] || {}) };
    const seen = new Set(day.seen || []);
    results.forEach((r, i) => {
      if (!r || r.source === 'mock') return;          // not real analysis
      const id = shortHash(texts[i]);
      if (seen.has(id)) return;                        // already counted today
      seen.add(id);
      day.total += 1;
      day[r.kind] += 1;
      if (r.kind !== 'clean' && host) day.sources[host] = (day.sources[host] || 0) + 1;
    });
    day.seen = [...seen].slice(-4000);
    stats[key] = day;
    // keep ~5 weeks
    for (const k of Object.keys(stats).sort().slice(0, -35)) delete stats[k];
    await chrome.storage.local.set({ stats });
  });
  return statsQueue;
}
function recordDebaited(count) {
  statsQueue = statsQueue.then(async () => {
    const { stats = {} } = await chrome.storage.local.get('stats');
    const key = dayKey();
    const day = { ...emptyDay(), ...(stats[key] || {}) };
    day.debaited += count;
    stats[key] = day;
    await chrome.storage.local.set({ stats });
  });
}

async function scoreTexts(texts, host) {
  const revision = privacyRevision;
  const c = await loadCache();
  const { localOnly } = await getSettings();
  const usable = (r, text) => {
    if (!r || !['on-device', 'cloud'].includes(r.source) || (localOnly && r.source !== 'on-device')) return false;
    try { normalizeResult(r, text); return true; } catch { return false; }
  };
  const missing = [...new Set(texts.filter(t => !usable(c.get(t), t)))];
  const fresh = new Map();
  if (missing.length) {
    const { results } = await toEngine({ type: MSG.SCORE, texts: missing, localOnly });
    if (!Array.isArray(results) || results.length !== missing.length) throw new Error('AI returned incomplete results');
    missing.forEach((t, i) => fresh.set(t, normalizeResult(results[i], t)));
  }
  const latest = await getSettings();
  if (revision !== privacyRevision || latest.localOnly !== localOnly) {
    throw new Error('LOCAL_ONLY: Privacy settings changed during analysis. Please retry.');
  }
  const out = texts.map(t => fresh.get(t) || c.get(t));
  if (!DEMO_MODE && out.some(r => r.source === 'mock')) throw new Error('Mock results are disabled outside explicit demo mode.');
  if ((localOnly || localOnlyActive) && out.some(r => r.source !== 'on-device')) {
    throw new Error('LOCAL_ONLY: Cloud or demo results cannot be used in Local Only mode.');
  }
  for (const [t, result] of fresh) if (result.source !== 'mock') c.set(t, result);
  if (fresh.size) saveCacheSoon();
  recordStats(out, host, texts);
  return { results: out, cacheHits: texts.length - missing.length };
}

// ---------- call mode (live voice with Gemini) ----------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}
async function toActiveTab(msg) {
  const tab = await activeTab();
  if (!tab?.id) return null;
  return chrome.tabs.sendMessage(tab.id, msg).catch(() => null);
}
async function startCallFlow() {
  await requireVoiceAllowed();
  await ensureOffscreen();
  await requireVoiceAllowed();
  const mic = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'debait/mic-state' }).catch(() => null);
  if (mic?.state !== 'granted') {
    // ask for the microphone once, in a small extension tab; it starts the call when allowed
    await requireVoiceAllowed();
    chrome.tabs.create({ url: chrome.runtime.getURL('src/voice/index.html') });
    return;
  }
  const token = await debugToken();
  await requireVoiceAllowed();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'debait/call-start', debugToken: token });
  if (!res?.ok) throw new Error(res?.error || 'Voice could not start');
}
async function endCallFlow(closeDocument = false) {
  // A pending offscreen creation must not outlive the Local Only shutdown.
  if (creating) await creating;
  const has = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!has.length) return;
  const stopping = chrome.runtime.sendMessage({ target: 'offscreen', type: 'debait/call-end' }).catch(() => {});
  if (closeDocument) {
    // Destroy the execution context too: even a pending SDK connect/audio promise
    // cannot keep a socket or microphone alive after this boundary.
    await chrome.offscreen.closeDocument();
  } else {
    await stopping;
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = changes.settings.oldValue;
  const after = changes.settings.newValue;
  if (before?.localOnly !== after?.localOnly) privacyRevision++;
  localOnlyActive = !!after?.localOnly;
  if (localOnlyActive) {
    // Stop live and pending sessions even if the voice switch was already false.
    if (!before?.localOnly || after?.voice) endCallFlow(true).catch(reportVoiceError);
    if (after.voice) disableVoice().catch(reportVoiceError);
    return;
  }
  const was = changes.settings.oldValue?.voice;
  const now = changes.settings.newValue?.voice;
  if (now && !was) startCallFlow().catch(reportVoiceError);
  if (!now && was) endCallFlow().catch(reportVoiceError);
});

async function disableVoice() {
  const settings = await getSettings();
  if (settings.voice) await chrome.storage.local.set({ settings: { ...settings, voice: false } });
}
function reportVoiceError(error) {
  toActiveTab({ type: 'debait/call-state', state: 'error', message: error.message }).catch(() => {});
  disableVoice().catch(() => {});
}

// ---------- message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false; // not for us
  checkBuild();
  if (msg?.type === 'debait/error') { logError(msg.where, msg.message); sendResponse({ ok: true }); return false; }

  (async () => {
    try {
      if (msg.type === 'debait/installation-type') {
        const offscreen = sender.id === chrome.runtime.id && !sender.tab &&
          sender.url === chrome.runtime.getURL(OFFSCREEN_URL);
        if (!offscreen) throw new Error('Installation metadata is only available to the extension offscreen document.');
        sendResponse({ ok: true, installType: await installationType() });
      } else if (msg.type === MSG.SCORE) {
        const host = sender.tab?.url ? new URL(sender.tab.url).hostname.replace(/^www\./, '') : '';
        sendResponse({ ok: true, ...(await scoreTexts(msg.texts, host)) });
      } else if (msg.type === MSG.STATUS) {
        const { localOnly } = await getSettings();
        const res = await toEngine({ type: MSG.STATUS, localOnly });
        // Debug credentials are only disclosed to the extension popup, never content scripts.
        const popup = !sender.tab && sender.url === chrome.runtime.getURL('src/popup/index.html');
        sendResponse({ ...res, ...(popup ? { debugToken: await debugToken() } : {}) });
      } else if (msg.type === MSG.INIT) {
        sendResponse(await toEngine({ type: MSG.INIT }));
      } else if (msg.type === 'debait/voice-allowed') {
        sendResponse({ ok: true, allowed: await voiceAllowed() });
      } else if (msg.type === 'debait/tool') {
        await requireVoiceAllowed();
        // Gemini wants to act on the page: run it in the active tab
        const res = await toActiveTab({ type: 'debait/tool', name: msg.name, args: msg.args });
        sendResponse(res || { result: { error: 'Debait is not running on this page. Ask the user to refresh it.' } });
      } else if (msg.type === 'debait/call-state') {
        toActiveTab({ type: 'debait/call-state', state: msg.state, message: msg.message });
        if (msg.state === 'error') {
          const s = await getSettings();
          if (s.voice) await chrome.storage.local.set({ settings: { ...s, voice: false } });
        }
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/mic-granted') {
        await startCallFlow();
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/mic-denied') {
        const s = await getSettings();
        await chrome.storage.local.set({ settings: { ...s, voice: false } });
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/debaited') {
        recordDebaited(msg.count || 0);
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/openSidePanel') {
        await chrome.sidePanel.open({ tabId: sender.tab.id });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});
