// Preview mode: fakes the Chrome extension APIs so the Debait UI runs on this page
// without installing the extension. Only for designing the UI. Open /?preview
import { mockEngine } from '../src/engine/mockEngine.js';
import { MSG, normalizeResult } from '../src/engine/contract.js';

const store = JSON.parse(localStorage.getItem('debait-preview') || '{}');
// The preview has no toolbar popup to bring the orb back, so it always starts visible.
if (store.settings) store.settings.showOrb = true;
const listeners = [];

globalThis.chrome = {
  runtime: {
    getURL: (p) => `/${p}`,
    onMessage: { addListener() {} },
    async sendMessage(msg) {
      if (msg.type === MSG.SCORE) {
        const raw = await mockEngine.scoreHeadlines(msg.texts, {});
        return { ok: true, cacheHits: 0, results: msg.texts.map((t, i) => normalizeResult(raw[i], t)) };
      }
      if (msg.type === MSG.SUMMARY) return { ok: true, ...(await mockEngine.summarize(msg.page)) };
      if (msg.type === MSG.STATUS) return { ok: true, status: { ready: true, source: 'mock', message: 'Mock engine (preview)' } };
      return { ok: false };
    },
  },
  storage: {
    local: {
      async get(key) { return key in store ? { [key]: store[key] } : {}; },
      async set(obj) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
        localStorage.setItem('debait-preview', JSON.stringify(store));
        listeners.forEach((l) => l(changes, 'local'));
      },
    },
    onChanged: { addListener: (l) => listeners.push(l) },
  },
};

await import('../src/content/main.js');
