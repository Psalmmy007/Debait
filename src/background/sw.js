import { createInferenceTransport } from './inferenceTransport.js';
import { checkSignal } from '../engine/hybrid.js';
import { VOICE_ENABLED } from '../shared/release.js';
import { createProblemLogger, problemEntry } from '../shared/problems.js';
import { quotaError } from '../shared/quota.js';
import { assistanceReason } from '../engine/errors.js';
// Service worker: routes messages, keeps the score cache and the daily stats.
import { normalizeAssistance } from '../engine/assistance.js';
import { quotaConfig } from '../shared/quotaConfig.js';
import { createRequestGate } from './requestGate.js';
import { createEvaluationService, evaluationError, EVALUATION_PAGE } from './evaluation.js';
import { MSG, normalizeResult } from '../engine/contract.js';
import { getSettings, dayKey, emptyDay } from '../shared/storage.js';
import { DEMO_MODE } from '../engine/mode.js';
import { QUALITY_POLICY_VERSION } from '../engine/qualityPolicy.js';
import { debugAppCheckAllowed, installationType } from '../engine/authPolicy.js';
import { waitForEngineReady } from '../offscreen/readiness.js';
import { createDebugTokenStore, readDebugToken, writeDebugToken } from '../engine/debugTokenStore.js';

const OFFSCREEN_URL = 'src/offscreen/index.html';

// ---------- problems log (shown in the popup) ----------
const logError = createProblemLogger({
  read: async () => (await chrome.storage.local.get('debaitErrors')).debaitErrors,
  write: debaitErrors => chrome.storage.local.set({ debaitErrors }),
});
logError.sanitize().catch(() => {});
self.addEventListener('error', (e) => { logError('background', e.message || e.error).catch(() => {}); });
self.addEventListener('unhandledrejection', (e) => { logError('background', e.reason?.stack || e.reason).catch(() => {}); });

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
const requestGate = createRequestGate({
  ...quotaConfig(import.meta.env),
  read: async () => (await chrome.storage.local.get('aiRequestBudget')).aiRequestBudget,
  write: value => chrome.storage.local.set({ aiRequestBudget: value }),
});
const pendingHeadlines = new Map();
let privacyRevision = 0;
let localOnlyActive = false;

async function voiceAllowed() {
  if (!VOICE_ENABLED) return false;
  const settings = await getSettings();
  return !localOnlyActive && !settings.localOnly && settings.voice;
}
async function requireVoiceAllowed() {
  if (!VOICE_ENABLED) throw new Error('Voice is unavailable in this release candidate.');
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
  if (existing.length) return waitForEngineReady(message => chrome.runtime.sendMessage(message));
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
  await waitForEngineReady(message => chrome.runtime.sendMessage(message));
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

const inferenceTransport = createInferenceTransport({
  prepare: async (payload, signal) => {
    await ensureOffscreen(); checkSignal(signal);
    const token = await debugToken(); checkSignal(signal);
    if (payload.type === MSG.SCORE || payload.type === MSG.ASSIST) {
      const settings = await getSettings(); checkSignal(signal);
      payload = { ...payload, localOnly: localOnlyActive || settings.localOnly || payload.localOnly };
    }
    return { debugToken: token, ...payload };
  },
  send: message => chrome.runtime.sendMessage(message),
  contexts: () => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }),
});
async function toEngine(payload, signal) {
  const res = await inferenceTransport.infer(payload, signal);
  if (!res?.ok) throw Object.assign(new Error(res?.error || 'engine error'), { code: res?.code, reason: assistanceReason(res), retryAfterMs: res?.retryAfterMs });
  return res;
}

// ---------- cache (never score the same headline twice) ----------
let cache = null; // Map<text, result>
let cacheLoading;
async function loadCache() {
  if (cache) return cache;
  return cacheLoading ||= (async () => {
    const { scoreCacheVersion } = await chrome.storage.local.get('scoreCacheVersion');
    const { scoreCache = [] } = await chrome.storage.local.get('scoreCache');
    const current = scoreCacheVersion === QUALITY_POLICY_VERSION;
    if (!current) await chrome.storage.local.set({ scoreCache: [], scoreCacheVersion: QUALITY_POLICY_VERSION });
    cache = new Map(current ? scoreCache : []);
    return cache;
  })().catch(error => { cacheLoading = undefined; throw error; });
}

let saveTimer = null;
function saveCacheSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const entries = [...cache.entries()].slice(-CACHE_MAX);
    chrome.storage.local.set({ scoreCache: entries, scoreCacheVersion: QUALITY_POLICY_VERSION });
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
  const key = text => JSON.stringify([localOnly, revision, text]);
  const owned = missing.filter(text => !pendingHeadlines.has(key(text)));
  if (owned.length) {
    const execute = async () => {
      const { results } = await toEngine({ type: MSG.SCORE, texts: owned, localOnly });
      if (!Array.isArray(results) || results.length !== owned.length) throw new Error('AI returned incomplete results');
      const checked = results.map((result, i) => normalizeResult(result, owned[i]));
      const settings = await getSettings();
      if (revision !== privacyRevision || settings.localOnly !== localOnly) throw new Error('LOCAL_ONLY: Privacy settings changed during analysis. Please retry.');
      if (!DEMO_MODE && checked.some(r => r.source === 'mock')) throw new Error('Mock results are disabled outside explicit demo mode.');
      if ((localOnly || localOnlyActive) && checked.some(r => r.source !== 'on-device')) throw new Error('LOCAL_ONLY: Cloud or demo results cannot be used in Local Only mode.');
      checked.forEach((r, i) => { if (r.source !== 'mock') c.set(owned[i], r); });
      saveCacheSoon();
      return checked;
    };
    const batch = localOnly || DEMO_MODE ? execute() : requestGate.run(execute);
    owned.forEach((text, i) => pendingHeadlines.set(key(text), batch.then(results => results[i])));
    const release = () => owned.forEach(text => pendingHeadlines.delete(key(text)));
    batch.then(release, release);
  }
  const results = await Promise.all(missing.map(text => pendingHeadlines.get(key(text))));
  missing.forEach((text, i) => fresh.set(text, results[i]));
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

// Assistance is deliberately separate from scoreTexts: no browsing cache or stats.
const pendingAssistance = new Map();
async function assistText(text, task, kind) {
  const revision = privacyRevision;
  const { localOnly } = await getSettings();
  const key = JSON.stringify([revision, localOnly, task, task === 'rewrite' ? kind : null, text]);
  if (pendingAssistance.has(key)) return pendingAssistance.get(key);
  const check = async () => {
    if (revision !== privacyRevision || (await getSettings()).localOnly !== localOnly) throw new Error('LOCAL_ONLY: Privacy settings changed. Request assistance again.');
  };
  const execute = async () => {
    await check();
    const response = await toEngine({ type: MSG.ASSIST, text, task, kind, localOnly });
    await check();
    const result = normalizeAssistance(response.result, text, task, kind);
    if (localOnly && result.source !== 'on-device') throw new Error('LOCAL_ONLY: Cloud assistance cannot be used.');
    return result;
  };
  const operation = localOnly ? execute() : requestGate.run(execute);
  pendingAssistance.set(key, operation);
  const release = () => pendingAssistance.delete(key);
  operation.then(release, release);
  return operation;
}

// Developer-only isolated evaluation: same gate, engine and privacy revision,
// without scoreTexts (which deliberately records browsing caches/statistics).
const evaluation = import.meta.env?.MODE === 'development' ? createEvaluationService({
  authorize: async sender => {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL(EVALUATION_PAGE) ||
        typeof sender.documentId !== 'string' || !sender.documentId ||
        'update_url' in chrome.runtime.getManifest() || await installationType() !== 'development') {
      throw Object.assign(new Error('Unauthorized evaluation page'), { code: 'debait/evaluation-forbidden' });
    }
  },
  settings: getSettings, revision: () => privacyRevision, gate: requestGate,
  infer: ({ signal, ...options }) => toEngine({ type: MSG.SCORE, ...options, evaluation: true }, signal),
  cancelInference: requestId => inferenceTransport.cancel(requestId),
  metadata: { policyVersion: QUALITY_POLICY_VERSION,
    gitSha: typeof __DEBAIT_BUILD_SHA__ === 'string' ? __DEBAIT_BUILD_SHA__ : 'unknown',
    gitDirty: typeof __DEBAIT_BUILD_DIRTY__ === 'boolean' ? __DEBAIT_BUILD_DIRTY__ : true },
}) : null;

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
  if (before?.localOnly !== after?.localOnly) {
    privacyRevision++;
    // No page content or credentials in cancellation messages. Do not create a document.
    chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then(contexts => {
      if (contexts.length) return chrome.runtime.sendMessage({ target: 'offscreen', type: 'debait/cancel-inference' });
    }).catch(() => {});
  }
  localOnlyActive = !!after?.localOnly;
  if (localOnlyActive) {
    // Stop live and pending sessions even if the voice switch was already false.
    if (!before?.localOnly || after?.voice) endCallFlow(true).catch(reportVoiceError);
    if (after.voice) disableVoice().catch(reportVoiceError);
    return;
  }
  if (!VOICE_ENABLED) { if (after?.voice) disableVoice().catch(reportVoiceError); return; }
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
  const { message } = problemEntry('voice startup', error);
  logError('voice startup', message).catch(() => {});
  toActiveTab({ type: 'debait/call-state', state: 'error', message }).catch(() => {});
  disableVoice().catch(() => {});
}

// Connection setup (including resume handshakes) uses the shared conservative local gate.
// This is not a reservation of Live streaming token/minute quota; the server still enforces it.
const requireVoiceOffscreen = sender => {
  if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL(OFFSCREEN_URL)) throw new Error('Voice connection controls require the extension offscreen document.');
};

// ---------- message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false; // not for us
  if (String(msg?.type || '').startsWith('debait/evaluation-')) {
    if (!evaluation) { sendResponse({ ok: false, code: 'debait/evaluation-forbidden', error: 'Evaluation is unavailable in this build.' }); return false; }
    evaluation.handle(msg, sender).then(sendResponse, error => sendResponse(evaluationError(error)));
    return true;
  }
  checkBuild();
  if (msg?.type === 'debait/error') { logError(msg.where, msg.message).catch(() => {}); sendResponse({ ok: true }); return false; }

  (async () => {
    try {
      if (msg.type === 'debait/installation-type') {
        const offscreen = sender.id === chrome.runtime.id && !sender.tab &&
          sender.url === chrome.runtime.getURL(OFFSCREEN_URL);
        if (!offscreen) throw new Error('Installation metadata is only available to the extension offscreen document.');
        sendResponse({ ok: true, installType: await installationType(), hasUpdateUrl: 'update_url' in chrome.runtime.getManifest() });
      } else if (msg.type === MSG.ASSIST) {
        if (typeof msg.text !== 'string' || !msg.text.trim() || msg.text.length > 320 ||
            !['rewrite', 'explain'].includes(msg.task) || (msg.task === 'rewrite' && !['rage', 'fear', 'envy'].includes(msg.kind))) throw new Error('Invalid headline assistance request');
        sendResponse({ ok: true, result: await assistText(msg.text, msg.task, msg.kind) });
      } else if (msg.type === MSG.SCORE) {
        if (!Array.isArray(msg.texts) || !msg.texts.length || msg.texts.length > 8 || msg.texts.some(t => typeof t !== 'string' || !t.trim() || t.length > 320)) throw new Error('Invalid headline batch: use 1–8 headlines of at most 320 characters.');
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
      } else if (msg.type === 'debait/voice-connect-slot') {
        requireVoiceOffscreen(sender); await requireVoiceAllowed();
        const { voiceRetryAt = 0 } = await chrome.storage.local.get('voiceRetryAt');
        if (voiceRetryAt > Date.now()) throw quotaError('Gemini Live is cooling down. Start voice later.', voiceRetryAt, false);
        await requestGate.run(requireVoiceAllowed);
        await requireVoiceAllowed(); sendResponse({ ok: true });
      } else if (msg.type === 'debait/voice-rate-limited') {
        requireVoiceOffscreen(sender);
        const delay = Number.isFinite(msg.retryAfterMs) && msg.retryAfterMs >= 0 ? msg.retryAfterMs : 30000;
        const { voiceRetryAt = 0 } = await chrome.storage.local.get('voiceRetryAt');
        await chrome.storage.local.set({ voiceRetryAt: Math.max(voiceRetryAt, Date.now() + Math.max(30000, delay)) });
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/voice-allowed') {
        sendResponse({ ok: true, allowed: await voiceAllowed() });
      } else if (msg.type === 'debait/tool') {
        await requireVoiceAllowed();
        // Gemini wants to act on the page: run it in the active tab
        const res = await toActiveTab({ type: 'debait/tool', name: msg.name, args: msg.args });
        sendResponse(res || { result: { error: 'Debait is not running on this page. Ask the user to refresh it.' } });
      } else if (msg.type === 'debait/call-state') {
        requireVoiceOffscreen(sender);
        if (msg.state === 'error') {
          msg = { ...msg, message: problemEntry('voice session', msg.message).message };
          await logError('voice session', msg.message).catch(() => {});
          await disableVoice();
        }
        toActiveTab({ type: 'debait/call-state', state: msg.state, message: msg.message });
        if (msg.state === 'error') {
          const s = await getSettings();
          if (s.voice) await chrome.storage.local.set({ settings: { ...s, voice: false } });
        }
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/mic-granted') {
        try { await startCallFlow(); } catch (error) { reportVoiceError(error); throw error; }
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/mic-denied') {
        await logError('voice microphone', 'Microphone permission was denied.').catch(() => {});
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
      sendResponse({ ok: false, error: String(err?.message || err), code: err.code, reason: assistanceReason(err), retryAt: err.retryAt, autoRetry: err.autoRetry });
    }
  })();
  return true;
});

if (!VOICE_ENABLED) getSettings().then(async settings => {
  if (settings.voice) await endCallFlow(true); // retire a legacy opt-in/context before clearing it
  await disableVoice();
}).catch(() => {});
