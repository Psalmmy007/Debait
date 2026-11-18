// Small helpers around chrome.storage.local, shared by every part of the extension.

export const DEFAULT_SETTINGS = {
  showOrb: true,      // the floating Debait ball
  orbSize: 1,         // user-adjustable floating orb scale (75%–160%)
  showTags: true,     // Rage / Fear / Envy / Clean pills
  autoDebait: false,  // rewrite bait as soon as it's scored
  localOnly: false,   // never use the cloud
  voice: false,       // talk to Debait
  disabledSites: [],  // hosts where Debait stays off
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function onSettingsChange(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      cb({ ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) });
    }
  });
}

/** Local date key like "2026-11-14". */
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function emptyDay() {
  return { total: 0, rage: 0, fear: 0, envy: 0, clean: 0, debaited: 0, sources: {} };
}

/** Returns the last `n` days of stats, oldest first: [{date, ...counts}]. */
export async function getRecentStats(n = 7) {
  const { stats = {} } = await chrome.storage.local.get('stats');
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    out.push({ date: key, ...emptyDay(), ...(stats[key] || {}) });
  }
  return out;
}
