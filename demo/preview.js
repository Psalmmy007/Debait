// Preview mode: fakes the Chrome extension APIs so the Debait UI runs on this page
// without installing the extension. Only for designing the UI. Open /?preview
import { mockEngine } from '../src/engine/mockEngine.js';
import { MSG, normalizeResult } from '../src/engine/contract.js';

const store = JSON.parse(localStorage.getItem('debait-preview') || '{}');
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
      return { ok: true };
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
