import { summarizeWeek } from '../sidepanel/statistics.js';
import { createIngredientsGuide } from '../shared/ingredientsView.js';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import { MSG } from '../engine/contract.js';
import { getSettings, setSettings, getRecentStats, DEFAULT_SETTINGS } from '../shared/storage.js';

const $ = (s) => document.querySelector(s);
$('#guide').append(createIngredientsGuide());
let todayRevision = 0;
let engineRevision = 0;
const SRC_LABEL = { 'on-device': 'On-device', cloud: 'Cloud', mock: 'Mock engine', none: 'Not verified' };

async function renderToday() {
  const revision = ++todayRevision;
  try {
    const days = await getRecentStats(1);
    if (revision !== todayRevision) return;
    const { sum: today, bait, percentage, complete } = summarizeWeek(days);
    countUp($('#pct'), percentage(bait));
    $('#pct').nextElementSibling.hidden = percentage(bait) === null;
    $('#sub').textContent = !complete ? 'Category data is incomplete; no reliable percentage is available'
      : today.total ? `of ${today.total} analyzed headline${today.total === 1 ? '' : 's'} today were flagged`
      : 'No headlines analyzed yet today';
    for (const k of ['rage', 'fear', 'envy', 'clean']) {
      $(`#bar [data-k='${k}']`).style.width = `${percentage(today[k]) ?? 0}%`;
      $(`#legend [data-k='${k}'] b`).textContent = complete ? today[k] : '—';
    }
  } catch { if (revision === todayRevision) { $('#pct').textContent = '—'; $('#pct').nextElementSibling.hidden = true; $('#sub').textContent = 'Reading statistics are temporarily unavailable.'; } }
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
    chip.querySelector('span').textContent = SRC_LABEL[s.source] || s.source;
    chip.title = s.message || '';
    $('#engineNote').textContent = s.message || (s.source === 'none' ? 'No inference source has been verified yet.' : 'Source reported by the current AI engine.');
    $('#turnOn').hidden = !s.canDownloadDevice;
    $('#setup').hidden = !(s.needsAppCheck && res.debugToken);
    $('#token').textContent = '';
    chip.querySelector('span').textContent = s.source === 'none' ? 'Not verified' : SRC_LABEL[s.source] || s.source;
    if (s.needsAppCheck && res.debugToken) {
      $('#setup').hidden = false;
      $('#token').textContent = res.debugToken;
    }
  } catch (error) {
    if (revision !== engineRevision) return;
    $('#engineNote').textContent = error.message;
    $('#setup').hidden = true;
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
      catch { input.checked = !input.checked; $('#engineNote').textContent = 'The setting could not be saved. Please try again.'; }
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
    $('#pageStatus').textContent = 'Analyzing eligible headlines and applying accepted safe alternatives. Some headlines may remain unchanged.';
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'debait/togglePage' });
    if (!result?.ok) { $('#pageStatus').textContent = result?.error || 'The page action could not complete.'; $('#debaitPage').textContent = 'Debait this page'; $('#debaitPage').disabled = false; return; }
    $('#pageStatus').textContent = result.note || `Applied ${result.rewrote || 0} safe rewrite(s).`;
    $('#debaitPage').textContent = result.rewrote ? 'Restore originals' : 'Debait this page';
    $('#debaitPage').disabled = false;
  } catch (error) {
    $('#debaitPage').disabled = false;
    const url = tab?.url || '';
    $('#debaitPage').textContent = 'Debait this page';
    $('#pageStatus').textContent = /^(chrome|edge|about|chrome-extension):|chromewebstore|chrome\.google\.com\/webstore/.test(url)
      ? 'Chrome does not allow extensions on this page'
      : `${error.message || 'The page could not be reached.'} Refresh this page after reloading the extension.`;
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
    btn.textContent = 'Model downloaded; inference not yet verified';
  } catch (err) {
    btn.textContent = err.message.length > 60 ? 'Could not download Gemini Nano' : err.message;
    btn.title = err.message;
  }
  btn.disabled = false;
  renderEngine();
});

$('#openFacts').addEventListener('click', async () => {
  const win = await chrome.windows.getCurrent();
  await chrome.sidePanel.open({ windowId: win.id });
  window.close();
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
  await navigator.clipboard.writeText($('#token').textContent);
  $('#copyToken').textContent = 'Copied';
});

// Run on this site
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // The toolbar popup and the on-page settings panel are alternative surfaces.
  // Close the page panel when the popup opens instead of stacking both controls.
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'debait/close-settings-panel' }).catch(() => {});
  let host = '';
  try { host = new URL(tab.url).hostname.replace(/^www./, ''); } catch { /* chrome:// pages */ }
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
  const { debaitErrors = [] } = await chrome.storage.local.get('debaitErrors');
  const recent = debaitErrors.filter((e) => Date.now() - Date.parse(e.at) < 30 * 60 * 1000);
  $('#problems').hidden = recent.length === 0;
  $('#problemList').textContent = recent.slice(0, 3).map((e) => `${e.where}: ${e.message.split('\\n')[0]}`).join(' · ');
  return recent;
}
$('#copyProblems').addEventListener('click', async () => {
  const recent = await renderProblems();
  await navigator.clipboard.writeText(recent.map((e) => `[${e.at}] ${e.where}\\n${e.message}`).join('\\n\\n'));
  $('#copyProblems').textContent = 'Copied';
});
renderProblems().catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.stats) renderToday();
  if (changes.debaitErrors) renderProblems().catch(() => {});
  if (changes.settings) { for (const input of document.querySelectorAll('[data-setting]')) input.checked = !!({ ...DEFAULT_SETTINGS, ...changes.settings.newValue })[input.dataset.setting]; renderEngine(); }
});
renderToday();
renderEngine();
renderSwitches();
