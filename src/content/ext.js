// Safe calls from the page to the rest of Debait.
// After Debait is reloaded or updated, a page that still runs the old copy loses its link to the
// extension, and every chrome.* call throws "Extension context invalidated". Chrome lists each of
// those on the Errors page, so these helpers answer null quietly instead.

// The design preview (demo page with ?preview) runs this code with a stand-in for Chrome that has
// no extension id on purpose, so there it always counts as alive.
const PREVIEW = 'debaitPreview' in document.documentElement.dataset;
export const extensionAlive = () => { if (PREVIEW) return true; try { return !!chrome.runtime?.id; } catch { return false; } };

/** Sends a message to Debait; resolves to null if Debait can't be reached. */
export function send(msg) {
  if (!extensionAlive()) return Promise.resolve(null);
  try { return chrome.runtime.sendMessage(msg).catch(() => null); } catch { return Promise.resolve(null); }
}

/** Reads keys from Debait's storage; resolves to {} if Debait can't be reached. */
export function load(keys) {
  if (!extensionAlive()) return Promise.resolve({});
  try { return chrome.storage.local.get(keys).catch(() => ({})); } catch { return Promise.resolve({}); }
}

/** Saves values to Debait's storage; does nothing if Debait can't be reached. */
export function save(values) {
  if (!extensionAlive()) return Promise.resolve();
  try { return chrome.storage.local.set(values).catch(() => {}); } catch { return Promise.resolve(); }
}
