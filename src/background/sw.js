// Service worker: routes messages, keeps the score cache and the daily stats.
import { MSG, CACHE_VERSION, isCacheEntryValid } from '../engine/contract.js';
import { isPrivateHost } from '../content/sites/index.js';
import { getSettings, dayKey, emptyDay, SYNC_PREFIX, SYNC_DAYS, syncableDay } from '../shared/storage.js';

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
// The build this running copy came from (baked in at build time).
const RUNNING_BUILD = typeof __DEBAIT_BUILD__ !== 'undefined' ? __DEBAIT_BUILD__ : null;
async function checkBuild() {
  if (!UNPACKED || !RUNNING_BUILD) return;
  try {
    const disk = await (await fetch(chrome.runtime.getURL('build.json'), { cache: 'no-store' })).json();
    if (disk.id && disk.id !== RUNNING_BUILD) chrome.runtime.reload(); // newer files on disk: load them
  } catch { /* no stamp yet */ }
}
checkBuild();
chrome.alarms?.create('debait-build-check', { periodInMinutes: 0.5 });
chrome.alarms?.onAlarm.addListener((a) => { if (a.name === 'debait-build-check') checkBuild(); });

// ---------- put Debait into tabs that were already open (after install, update or reload) ----------
async function injectOpenTabs() {
  try {
    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js || [];
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const t of tabs) {
      if (!t.id || !t.url) continue;
      let u;
      try { u = new URL(t.url); } catch { continue; }
      const host = u.hostname.toLowerCase();
      if (isPrivateHost(host)) continue;
      if (host === 'www.icloud.com' && /^\/mail\b/i.test(u.pathname)) continue;
      if (host === 'localhost' || host === '127.0.0.1') continue;
      chrome.scripting.executeScript({ target: { tabId: t.id }, files }).catch(() => {});
    }
  } catch { /* ignore startup query failures */ }
}
chrome.runtime.onInstalled.addListener(() => { injectOpenTabs(); });
// Ensure tabs stay live after unpacked chrome.runtime.reload() even when onInstalled doesn't re-fire.
chrome.storage.session?.get('debaitTabsInjected').then((res) => {
  if (!res?.debaitTabsInjected) {
    chrome.storage.session.set({ debaitTabsInjected: true }).catch(() => {});
    injectOpenTabs();
  }
}).catch(() => {});
const CACHE_MAX = 3000;

// ---------- offscreen engine host ----------
// One check-and-create at a time: parallel requests used to race, both saw "no document"
// and both tried to create one; Chrome allows one, so the others failed.
let ensuring = null;
function ensureOffscreen() {
  ensuring ||= (async () => {
    const url = chrome.runtime.getURL(OFFSCREEN_URL);
    const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (existing.length) return;
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['DOM_PARSER', 'USER_MEDIA', 'AUDIO_PLAYBACK'],
        justification: 'Runs the on-device AI (Prompt API) and Firebase AI Logic to score headlines, and the live voice call (microphone and spoken replies).',
      });
    } catch (err) {
      if (!/single offscreen/i.test(err.message)) throw err; // already there: fine
    }
  })().finally(() => { ensuring = null; });
  return ensuring;
}

// The App Check debug token for this install (register it in Firebase once).
let tokenOnce = null;
function debugToken() {
  tokenOnce ||= chrome.storage.local.get('appCheckDebugToken').then(async ({ appCheckDebugToken }) => {
    if (appCheckDebugToken) return appCheckDebugToken;
    const token = crypto.randomUUID();
    await chrome.storage.local.set({ appCheckDebugToken: token });
    return token;
  });
  return tokenOnce;
}

// What the engine learned about the Firebase projects (which one answers, which one rejects us),
// remembered across restarts so a fresh start goes straight to the one that works (see offscreen.js).
let engineMemory;
const memoryLoaded = chrome.storage.local.get('engineMemory').then(({ engineMemory: m }) => { engineMemory = m; });
function rememberEngine(res) {
  if (!res?.memory) return;
  if (JSON.stringify(res.memory) === JSON.stringify(engineMemory)) return;
  engineMemory = res.memory;
  chrome.storage.local.set({ engineMemory }).catch(() => {});
}

async function sendToOffscreen(payload) {
  await ensureOffscreen();
  const msg = { target: 'offscreen', ...payload };
  let res = await chrome.runtime.sendMessage(msg).catch(() => undefined);
  if (res === undefined) {
    // a brand-new offscreen page may still be loading its code: give it a moment, once
    await new Promise((r) => setTimeout(r, 400));
    res = await chrome.runtime.sendMessage(msg).catch(() => undefined);
  }
  return res;
}

async function toEngine(payload) {
  await memoryLoaded;
  const res = await sendToOffscreen({ debugToken: await debugToken(), memory: engineMemory, ...payload });
  rememberEngine(res);
  if (!res?.ok) throw new Error(res?.error || 'engine error');
  return res;
}

// ---------- cache (never score the same headline twice) ----------
let cache = null; // Map<text, result>
// CACHE_VERSION is shared from contract.js (bump to evict old cached entries).
async function loadCache() {
  if (cache) return cache;
  const { scoreCache = [], cacheVersion } = await chrome.storage.local.get(['scoreCache', 'cacheVersion']);
  if (cacheVersion !== CACHE_VERSION) {
    cache = new Map();
    await chrome.storage.local.set({ scoreCache: [], cacheVersion: CACHE_VERSION });
    return cache;
  }
  cache = new Map(scoreCache);
  return cache;
}
let saveTimer = null;
function saveCacheSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const entries = [...cache.entries()].slice(-CACHE_MAX);
    chrome.storage.local.set({ scoreCache: entries }).catch(() => {});
  }, 1000);
}

// ---------- daily stats for Weekly Mind Facts ----------
// Real numbers only: a headline counts once per day, and only when Gemini (on-device or cloud)
// analysed it. Backup-engine guesses are never counted.
let statsQueue = Promise.resolve();
const shortHash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

// one-time reset: older versions counted backup-engine results too
statsQueue = statsQueue.then(async () => {
  try {
    const { statsVersion } = await chrome.storage.local.get('statsVersion');
    if (statsVersion !== 2) await chrome.storage.local.set({ stats: {}, statsVersion: 2 });
  } catch { /* ignore storage errors */ }
});

// Copy the last two weeks of totals to Chrome sync (see shared/storage.js). Batched, because
// Chrome allows only a limited number of sync writes per minute.
let syncTimer = null;
function backupStats() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      let { deviceId, stats = {} } = await chrome.storage.local.get(['deviceId', 'stats']);
      if (!deviceId) { deviceId = crypto.randomUUID().slice(0, 8); await chrome.storage.local.set({ deviceId }); }
      const days = Object.keys(stats).sort().slice(-SYNC_DAYS);
      if (!days.length) return;
      // tidy up: copies from old installs with nothing in the last two weeks are dropped, so
      // reinstalls never fill Chrome's small sync space (about 100 KB)
      const all = await chrome.storage.sync.get(null);
      const cutoff = dayKey(new Date(Date.now() - SYNC_DAYS * 864e5));
      const stale = Object.entries(all).filter(([k, v]) => k.startsWith(SYNC_PREFIX) && k !== SYNC_PREFIX + deviceId
        && !Object.keys(v || {}).some((d) => d >= cutoff)).map(([k]) => k);
      if (stale.length) await chrome.storage.sync.remove(stale);
      await chrome.storage.sync.set({ [SYNC_PREFIX + deviceId]: Object.fromEntries(days.map((k) => [k, syncableDay(stats[k])])) });
    } catch (err) {
      console.debug('[Debait] sync backup skipped:', err.message);
    }
  }, 15000);
}
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.stats) backupStats(); });

function recordStats(results, host, texts) {
  statsQueue = statsQueue.then(async () => {
    try {
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
    } catch (err) {
      console.debug('[Debait] stats write skipped:', err?.message || err);
    }
  });
  return statsQueue;
}
// a headline counts once a day, however many times it is debaited and restored
function recordDebaited(texts, count) {
  statsQueue = statsQueue.then(async () => {
    try {
      const { stats = {} } = await chrome.storage.local.get('stats');
      const key = dayKey();
      const day = { ...emptyDay(), ...(stats[key] || {}) };
      if (texts.length) {
        const done = new Set(day.debaitedSeen || []);
        for (const t of texts) {
          const id = shortHash(t);
          if (!done.has(id)) { done.add(id); day.debaited += 1; }
        }
        day.debaitedSeen = [...done].slice(-4000);
      } else {
        day.debaited += count;
      }
      stats[key] = day;
      await chrome.storage.local.set({ stats });
    } catch (err) {
      console.debug('[Debait] debaited stats write skipped:', err?.message || err);
    }
  });
}

async function scoreTexts(texts, host) {
  const c = await loadCache();
  const { localOnly } = await getSettings();
  // Local Only cache isolation: never serve a prior cloud-cached entry when Local Only is enabled.
  const cachedFor = (t) => {
    const entry = c.get(t);
    return isCacheEntryValid(entry, localOnly) ? entry : null;
  };
  const missing = [...new Set(texts.filter((t) => !cachedFor(t)))];
  let freshResults = null;
  if (missing.length) {
    const { results } = await toEngine({ type: MSG.SCORE, texts: missing, localOnly });
    const fresh = new Map();
    missing.forEach((t, i) => {
      const r = results[i];
      // Verify Local Only never accepts or caches a cloud/mock result
      if (localOnly && r?.source !== 'on-device') {
        throw new Error('LOCAL_ONLY_SOURCE_MISMATCH: expected on-device result while Local only is on');
      }
      fresh.set(t, r);
      if (r && (r.source === 'on-device' || r.source === 'cloud')) {
        // Never overwrite a verified on-device cache entry with a cloud entry
        const existing = c.get(t);
        if (!existing || existing.source !== 'on-device' || r.source === 'on-device') c.set(t, r);
      }
    });
    freshResults = fresh;
    saveCacheSoon();
  }
  const out = texts.map((t) => freshResults?.get(t) || cachedFor(t));
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
async function broadcastCallState(state, message = '', extra = {}) {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).catch(() => []);
  for (const t of tabs) {
    if (t.id) chrome.tabs.sendMessage(t.id, { type: 'debait/call-state', state, message, ...extra }).catch(() => {});
  }
}
const swOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
async function checkCallAllowed() {
  const s = await getSettings();
  if (!swOnline()) {
    await broadcastCallState('error', 'Talk to Debait needs an internet connection.');
    if (s.voice) await chrome.storage.local.set({ settings: { ...s, voice: false } });
    return false;
  }
  if (s.localOnly) {
    await broadcastCallState('error', 'Turn off Local only to use Talk to Debait.');
    if (s.voice) await chrome.storage.local.set({ settings: { ...s, voice: false } });
    return false;
  }
  return true;
}
async function openMicTab() {
  const url = chrome.runtime.getURL('src/voice/index.html');
  const existing = await chrome.tabs.query({ url }).catch(() => []);
  if (existing[0]?.id) {
    chrome.tabs.update(existing[0].id, { active: true }).catch(() => {});
    return;
  }
  chrome.tabs.create({ url });
}
let skipNextStartFlow = false;
async function startCallFlow() {
  if (!(await checkCallAllowed())) return;
  const mic = await sendToOffscreen({ type: 'debait/mic-state' });
  if (mic?.state !== 'granted') {
    // ask for the microphone once, in a small extension tab; it starts the call when allowed
    await openMicTab();
    return;
  }
  await memoryLoaded;
  await sendToOffscreen({ type: 'debait/call-start', debugToken: await debugToken(), memory: engineMemory });
}
async function endCallFlow() {
  const has = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (has.length) await chrome.runtime.sendMessage({ target: 'offscreen', type: 'debait/call-end' }).catch(() => {});
  else await broadcastCallState('ended');
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const was = changes.settings.oldValue?.voice;
  const now = changes.settings.newValue?.voice;
  if (now && !was) {
    if (skipNextStartFlow) skipNextStartFlow = false;
    else startCallFlow().catch(() => {});
  }
  if (!now && was) endCallFlow().catch(() => {});
  const wasLocal = changes.settings.oldValue?.localOnly;
  const nowLocal = changes.settings.newValue?.localOnly;
  if (nowLocal && !wasLocal) {
    // Switching Local only ON immediately cancels any in-flight cloud requests.
    chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((has) => {
      if (has.length) chrome.runtime.sendMessage({ target: 'offscreen', type: MSG.CANCEL_CLOUD }).catch(() => {});
    }).catch(() => {});
  }
  if (nowLocal && now) {
    // turning Local only on during an active cloud voice call ends the call cleanly
    chrome.storage.local.set({ settings: { ...changes.settings.newValue, voice: false } }).catch(() => {});
  }
});

// ---------- message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false; // not for us
  checkBuild();
  if (msg?.type === 'debait/error') { logError(msg.where, msg.message); sendResponse({ ok: true }); return false; }
  // summary words from the engine, on their way to the tab that asked
  if (msg?.type === 'debait/summary-chunk') { if (msg.tabId) chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {}); return false; }

  (async () => {
    try {
      if (msg.type === MSG.SCORE) {
        const host = sender.tab?.url ? new URL(sender.tab.url).hostname.replace(/^www\./, '') : '';
        sendResponse({ ok: true, ...(await scoreTexts(msg.texts, host)) });
      } else if (msg.type === MSG.STATUS) {
        const { localOnly } = await getSettings();
        const res = await toEngine({ type: MSG.STATUS, localOnly });
        sendResponse({ ...res, debugToken: await debugToken() });
      } else if (msg.type === MSG.INIT) {
        sendResponse(await toEngine({ type: MSG.INIT }));
      } else if (msg.type === MSG.SUMMARY) {
        const { localOnly } = await getSettings();
        sendResponse(await toEngine({ type: MSG.SUMMARY, page: msg.page, localOnly, stream: !!msg.stream, tabId: sender.tab?.id }));
      } else if (msg.type === 'debait/tool') {
        // Gemini wants to act on the page: run it in the active tab
        const res = await toActiveTab({ type: 'debait/tool', name: msg.name, args: msg.args });
        sendResponse(res || { result: { error: 'Debait is not running on this page. Ask the user to refresh it.' } });
      } else if (msg.type === 'debait/call-state') {
        await broadcastCallState(msg.state, msg.message, typeof msg.muted === 'boolean' ? { muted: msg.muted } : {});
        if (msg.state === 'error') {
          const s = await getSettings();
          if (s.voice) await chrome.storage.local.set({ settings: { ...s, voice: false } });
        }
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/call-mute-toggle') {
        const has = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        const res = has.length
          ? await chrome.runtime.sendMessage({ target: 'offscreen', type: 'debait/call-mute-toggle', muted: msg.muted }).catch(() => null)
          : null;
        sendResponse({ ok: true, muted: !!res?.muted });
      } else if (msg.type === 'debait/call-status') {
        const has = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
        const st = has.length
          ? await chrome.runtime.sendMessage({ target: 'offscreen', type: 'debait/call-status' }).catch(() => null)
          : null;
        const inCall = !!st?.inCall;
        if (!inCall) {
          const s = await getSettings();
          if (s.voice) await chrome.storage.local.set({ settings: { ...s, voice: false } });
        }
        sendResponse({ ok: true, inCall, muted: !!st?.muted });
      } else if (msg.type === 'debait/mic-granted') {
        if (await checkCallAllowed()) {
          const s = await getSettings();
          if (!s.voice) {
            skipNextStartFlow = true;
            await chrome.storage.local.set({ settings: { ...s, voice: true } });
          }
          await memoryLoaded;
          await sendToOffscreen({ type: 'debait/call-start', debugToken: await debugToken(), memory: engineMemory });
        }
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/mic-denied') {
        const s = await getSettings();
        if (s.voice) await chrome.storage.local.set({ settings: { ...s, voice: false } });
        await broadcastCallState('ended');
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/debaited') {
        recordDebaited(Array.isArray(msg.texts) ? msg.texts : [], msg.count || 0);
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/record-hits') {
        // Content script resolved cached headlines in 0 ms: still count them in daily stats.
        const host = sender.tab?.url ? new URL(sender.tab.url).hostname.replace(/^www\./, '') : '';
        const items = Array.isArray(msg.items) ? msg.items : [];
        if (items.length) recordStats(items.map((x) => x.result), host, items.map((x) => x.text));
        sendResponse({ ok: true });
      } else if (msg.type === 'debait/openSidePanel') {
        if (!sender.tab?.id) throw new Error('no active tab');
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
