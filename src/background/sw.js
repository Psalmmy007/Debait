// Service worker: routes messages, keeps the score cache and the daily stats.
import { MSG } from '../engine/contract.js';
import { getSettings, dayKey, emptyDay } from '../shared/storage.js';

const OFFSCREEN_URL = 'src/offscreen/index.html';
const CACHE_MAX = 3000;

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
        reasons: ['DOM_PARSER'],
        justification: 'Runs the on-device AI model (Prompt API) and Firebase AI Logic to score headlines.',
      })
      .finally(() => { creating = null; });
  }
  await creating;
}

// The App Check debug token for this install (register it in Firebase once).
async function debugToken() {
  const { appCheckDebugToken } = await chrome.storage.local.get('appCheckDebugToken');
  if (appCheckDebugToken) return appCheckDebugToken;
  const token = crypto.randomUUID();
  await chrome.storage.local.set({ appCheckDebugToken: token });
  return token;
}

async function toEngine(payload) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', debugToken: await debugToken(), ...payload });
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
let statsQueue = Promise.resolve();
function recordStats(results, host) {
  statsQueue = statsQueue.then(async () => {
    const { stats = {} } = await chrome.storage.local.get('stats');
    const key = dayKey();
    const day = { ...emptyDay(), ...(stats[key] || {}) };
    for (const r of results) {
      day.total += 1;
      day[r.kind] += 1;
      if (r.kind !== 'clean' && host) day.sources[host] = (day.sources[host] || 0) + 1;
    }
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
  const c = await loadCache();
  const missing = [...new Set(texts.filter((t) => !c.has(t)))];
  if (missing.length) {
    const { localOnly } = await getSettings();
    const { results } = await toEngine({ type: MSG.SCORE, texts: missing, localOnly });
    const fresh = new Map();
    missing.forEach((t, i) => {
      fresh.set(t, results[i]);
      if (results[i].source !== 'mock') c.set(t, results[i]); // never cache backup-engine guesses
    });
    var freshResults = fresh;
    saveCacheSoon();
  }
  const out = texts.map((t) => c.get(t) || freshResults?.get(t));
  recordStats(out, host);
  return { results: out, cacheHits: texts.length - missing.length };
}

// ---------- message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false; // not for us

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
