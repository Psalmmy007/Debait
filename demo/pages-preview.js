// Lets the popup and side panel render on the demo server (no extension needed), for design checks.
const store = { stats: {} };
globalThis.chrome = {
  runtime: { sendMessage: async () => ({ ok: true, status: { ready: true, source: 'mock' } }) },
  storage: {
    local: {
      async get(k) { return k in store ? { [k]: store[k] } : {}; },
      async set(o) { Object.assign(store, o); listeners.forEach((l) => l(Object.fromEntries(Object.keys(o).map((k) => [k, { newValue: o[k] }])), 'local')); },
    },
    onChanged: { addListener: (l) => listeners.push(l) },
  },
  tabs: { query: async () => [{ id: 1 }], sendMessage: async () => {} },
  windows: { getCurrent: async () => ({ id: 1 }) },
  sidePanel: { open: async () => {} },
};
const listeners = [];
