import { recentProblems } from '../shared/problems.js';
import { summarizeWeek } from '../sidepanel/statistics.js';
import '@fontsource-variable/inter';
import { MSG } from '../engine/contract.js';
import { getSettings, setSettings, getRecentStats, DEFAULT_SETTINGS } from '../shared/storage.js';

const $ = (s) => document.querySelector(s);
let todayRevision = 0;
let engineRevision = 0;
let problemsRevision = 0;
let privateDevelopmentToken = null;
const SRC_LABEL = { 'on-device': 'On-device', cloud: 'Cloud', mock: 'Mock engine', none: 'Not verified' };

function setNote(selector, text) {
  const el = $(selector);
  const msg = typeof text === 'string' ? text.trim() : '';
  el.textContent = msg;
  el.hidden = !msg;
}

async function renderToday() {
  const revision = ++todayRevision;
  try {
    const days = await getRecentStats(1);
    if (revision !== todayRevision) return;
    const { sum: today, bait, percentage, complete } = summarizeWeek(days);
    countUp($('#pct'), percentage(bait));
    $('#pct').nextElementSibling.hidden = percentage(bait) === null;
    $('#sub').textContent = !complete ? 'Incomplete data'
      : today.total ? `${today.total.toLocaleString()} headline${today.total === 1 ? '' : 's'}`
      : 'No headlines yet';
    for (const k of ['rage', 'fear', 'envy', 'clean']) {
      $(`#bar [data-k='${k}']`).style.width = `${percentage(today[k]) ?? 0}%`;
      $(`#legend [data-k='${k}'] b`).textContent = complete ? today[k] : '—';
    }
  } catch {
    if (revision === todayRevision) {
      $('#pct').textContent = '—';
      $('#pct').nextElementSibling.hidden = true;
      $('#sub').textContent = 'Stats unavailable';
    }
  }
}

async function renderEngine() {
  const revision = ++engineRevision;
  const chip = $('#engine');
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG.STATUS });
    if (revision !== engineRevision) return;
    if (!res?.ok) throw new Error('Engine status could not be verified. Check the extension setup and retry.');
    const s = res.status || { source: 'none', ready: false };
    chip.dataset.src = s.source;
    chip.querySelector('span').textContent = s.source === 'none' ? 'Not verified' : SRC_LABEL[s.source] || s.source;
    chip.title = s.message || '';
    const hasError = !s.ready || s.source === 'none';
    setNote('#engineNote', hasError ? (s.message || 'No inference source has been verified yet.') : '');
    $('#turnOn').hidden = !s.canDownloadDevice;
    // Setup must remain discoverable even when inference has not produced a successful result.
    // Never display the private token as ordinary popup text or in screenshots.
    privateDevelopmentToken = typeof res.debugToken === 'string' && res.debugToken.trim() ? res.debugToken : null;
    $('#setup').hidden = !privateDevelopmentToken;
    $('#token').textContent = privateDevelopmentToken ? 'Private development token (hidden)' : '';
  } catch (error) {
    if (revision !== engineRevision) return;
    setNote('#engineNote', error.message);
    $('#setup').hidden = true;
    privateDevelopmentToken = null;
    $('#token').textContent = '';
    $('#turnOn').hidden = true;
    chip.title = error.message;
    chip.dataset.src = 'none';
    chip.querySelector('span').textContent = 'Not verified';
  }
}

async function renderSwitches() {
  const settings = await getSettings();
  for (const input of document.querySelectorAll('[data-setting]')) {
    input.checked = !!settings[input.dataset.setting];
    input.addEventListener('change', async () => {
      input.disabled = true;
      try { await setSettings({ [input.dataset.setting]: input.checked }); await renderEngine(); }
      catch { input.checked = !input.checked; setNote('#engineNote', 'The setting could not be saved. Please try again.'); }
      finally { input.disabled = false; }
    });
  }
}

$('#debaitPage').addEventListener('click', async () => {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    $('#debaitPage').disabled = true;
    $('#debaitPage').textContent = 'Working…';
    setNote('#pageStatus', '');
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'debait/togglePage' });
    if (!result?.ok) {
      setNote('#pageStatus', result?.error || 'The page action could not complete.');
      $('#debaitPage').textContent = 'Debait this page';
      $('#debaitPage').disabled = false;
      return;
    }
    setNote('#pageStatus', result.note || `Applied ${result.rewrote || 0} safe rewrite(s).`);
    $('#debaitPage').textContent = result.rewrote ? 'Restore originals' : 'Debait this page';
    $('#debaitPage').disabled = false;
  } catch (error) {
    $('#debaitPage').disabled = false;
    const url = tab?.url || '';
    $('#debaitPage').textContent = 'Debait this page';
    setNote('#pageStatus', /^(chrome|edge|about|chrome-extension):|chromewebstore|chrome\.google\.com\/webstore/.test(url)
      ? 'Chrome does not allow extensions on this page'
      : `${error.message || 'The page could not be reached.'} Refresh this page after reloading the extension.`);
  }
});

// Must run from a click: Chrome only downloads Gemini Nano after a user gesture.
$('#turnOn').addEventListener('click', async () => {
  const btn = $('#turnOn');
  btn.disabled = true;
  try {
    if (typeof LanguageModel === 'undefined') throw new Error('This Chrome cannot run Gemini Nano (needs Chrome 138+ on a supported computer)');
    const opts = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
    const avail = await LanguageModel.availability(opts);
    if (avail === 'unavailable') throw new Error('This computer cannot run Gemini Nano');
    btn.textContent = 'Downloading Gemini Nano…';
    const session = await LanguageModel.create({
      ...opts,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => { btn.textContent = `Downloading Gemini Nano… ${Math.round(e.loaded * 100)}%`; });
      },
    });
    session.destroy();
    await chrome.runtime.sendMessage({ type: MSG.INIT }).catch(() => {});
    btn.textContent = 'Model downloaded; inference not yet verified';
  } catch (err) {
    btn.textContent = err.message.length > 60 ? 'Could not download Gemini Nano' : err.message;
    btn.title = err.message;
  }
  btn.disabled = false;
  renderEngine();
});

$('#openFacts').addEventListener('click', async () => {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
    window.close();
  } catch {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel/index.html') });
    window.close();
  }
});

function countUp(el, to) {
  const revision = todayRevision;
  if (to === null || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to ?? '—'; return; }
  const start = performance.now();
  const tick = (t) => {
    if (revision !== todayRevision) return;
    const p = Math.min(1, (t - start) / 800);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

$('#copyToken').addEventListener('click', async () => {
  if (!privateDevelopmentToken) {
    $('#copyToken').textContent = 'Unavailable';
    return;
  }
  try {
    await navigator.clipboard.writeText(privateDevelopmentToken);
    $('#copyToken').textContent = 'Copied privately';
  } catch {
    $('#copyToken').textContent = 'Copy blocked';
  }
});

// Run on this site
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // The toolbar popup and the on-page settings panel are alternative surfaces.
  // Close the page panel when the popup opens instead of stacking both controls.
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'debait/close-settings-panel' }).catch(() => {});
  let host = '';
  try { if (tab?.url && /^https?:/.test(tab.url)) host = new URL(tab.url).hostname.replace(/^www./, ''); } catch { /* chrome:// pages */ }
  if (!host) { $('.site').hidden = true; return; }
  $('#host').textContent = host;
  const s = await getSettings();
  $('#siteOn').checked = !s.disabledSites.includes(host);
  $('#siteOn').addEventListener('change', async () => {
    const cur = await getSettings();
    const off = new Set(cur.disabledSites);
    if ($('#siteOn').checked) off.delete(host); else off.add(host);
    await setSettings({ disabledSites: [...off] });
  });
})();

async function renderProblems() {
  const revision = ++problemsRevision;
  const { debaitErrors = [] } = await chrome.storage.local.get('debaitErrors');
  const recent = recentProblems(debaitErrors);
  if (revision === problemsRevision) {
    $('#problems').hidden = recent.length === 0;
    $('#problemList').textContent = recent.slice(0, 3).map((e) => `${e.where}: ${e.message.split('\n')[0]}`).join(' · ');
  }
  return recent;
}
$('#copyProblems').addEventListener('click', async () => {
  try {
    const recent = await renderProblems();
    await navigator.clipboard.writeText(recent.map((e) => `[${e.at}] ${e.where}\n${e.message}`).join('\n\n'));
    $('#copyProblems').textContent = 'Copied';
  } catch { $('#copyProblems').textContent = 'Could not copy; select the visible text'; }
});
renderProblems().catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.stats) renderToday();
  if (changes.debaitErrors) renderProblems().catch(() => {});
  if (changes.settings) {
    for (const input of document.querySelectorAll('[data-setting]')) {
      input.checked = !!({ ...DEFAULT_SETTINGS, ...changes.settings.newValue })[input.dataset.setting];
    }
    renderEngine();
  }
});
renderToday();
renderEngine();
renderSwitches();
