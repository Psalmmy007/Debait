// Small helpers around chrome.storage.local, shared by every part of the extension.

export const DEFAULT_SETTINGS = {
  showOrb: true,      // the floating Debait ball
  showTags: true,     // Rage / Fear / Envy / Clean pills
  autoDebait: false,  // rewrite bait as soon as it's scored
  localOnly: false,   // never use the cloud
  voice: false,       // talk to Debait
  orbSize: 1,         // orb scale, 0.75 – 1.6
  disabledSites: [],  // hosts where Debait stays off
};

// A page still running an old copy of Debait (after an update) can't reach storage: answer quietly.
export async function getSettings() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  try { await chrome.storage.local.set({ settings: next }); } catch { /* extension reloaded */ }
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

// ---------- Mind Facts backup through Chrome sync ----------
// Each install keeps its own daily counts in chrome.storage.local and copies the last two weeks of
// totals (numbers and site names only, never headlines) to chrome.storage.sync under its own key.
// Chrome syncs that with the Google account you're signed in to in Chrome, so the week comes back
// after a reinstall and adds up across your computers. No Debait account needed.
export const SYNC_PREFIX = 'mf:';
export const SYNC_DAYS = 14;
const COUNTS = ['total', 'rage', 'fear', 'envy', 'clean', 'debaited'];

/** The part of a day that is synced: counts and the top bait sites. */
export function syncableDay(day) {
  const out = {};
  for (const k of COUNTS) out[k] = day[k] || 0;
  out.sources = Object.fromEntries(Object.entries(day.sources || {}).sort((a, b) => b[1] - a[1]).slice(0, 8));
  return out;
}

/** Daily totals from this person's other installs (other computers, or before a reinstall). */
async function otherInstalls() {
  try {
    const [{ deviceId }, all] = await Promise.all([chrome.storage.local.get('deviceId'), chrome.storage.sync.get(null)]);
    return Object.entries(all || {}).filter(([k]) => k.startsWith(SYNC_PREFIX) && k !== SYNC_PREFIX + deviceId).map(([, v]) => v || {});
  } catch {
    return []; // sync unavailable (preview, or the extension was reloaded)
  }
}

/** Returns the last `n` days of stats, oldest first: [{date, ...counts}]. */
export async function getRecentStats(n = 7) {
  let stats = {};
  try { ({ stats = {} } = await chrome.storage.local.get('stats')); } catch { /* extension reloaded */ }
  const others = await otherInstalls();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const day = { date: key, ...emptyDay(), ...(stats[key] || {}) };
    day.sources = { ...day.sources };
    for (const o of others) {
      const x = o[key];
      if (!x) continue;
      for (const k of COUNTS) day[k] += x[k] || 0;
      for (const [h, c] of Object.entries(x.sources || {})) day.sources[h] = (day.sources[h] || 0) + c;
    }
    out.push(day);
  }
  return out;
}
