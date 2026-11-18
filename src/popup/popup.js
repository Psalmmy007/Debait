import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import { MSG } from '../engine/contract.js';
import { getSettings, setSettings, getRecentStats } from '../shared/storage.js';

const $ = (s) => document.querySelector(s);
const SRC_LABEL = { 'on-device': 'On-device', cloud: 'Cloud', mock: 'Quick estimate', none: 'Not ready' };

async function renderToday() {
  const [today] = (await getRecentStats(1));
  const bait = today.rage + today.fear + today.envy;
  const pct = today.total ? Math.round((bait / today.total) * 100) : 0;
  countUp($('#pct'), pct);
  $('#sub').textContent = today.total
    ? `of ${today.total} headline${today.total === 1 ? '' : 's'} today were bait`
    : 'No headlines read yet today';
  for (const k of ['rage', 'fear', 'envy', 'clean']) {
    $(`#bar [data-k='${k}']`).style.width = today.total ? `${(today[k] / today.total) * 100}%` : '0';
    $(`#legend [data-k='${k}'] b`).textContent = today[k];
  }
}

async function renderEngine() {
  const chip = $('#engine');
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG.STATUS });
    const s = res?.status || { source: 'none', ready: false };
    chip.dataset.src = s.source;
    chip.querySelector('span').textContent = SRC_LABEL[s.source] || s.source;
    chip.title = s.message || '';
    $('#turnOn').hidden = s.ready;
    if (s.needsAppCheck && res.debugToken) {
      $('#setup').hidden = false;
      $('#token').textContent = res.debugToken;
    }
  } catch {
    chip.dataset.src = 'none';
    chip.querySelector('span').textContent = 'Not ready';
  }
}

async function renderSwitches() {
  const settings = await getSettings();
  for (const input of document.querySelectorAll('[data-setting]')) {
    input.checked = !!settings[input.dataset.setting];
    input.addEventListener('change', () => setSettings({ [input.dataset.setting]: input.checked }).then(renderEngine));
  }
}

$('#debaitPage').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'debait/togglePage' });
    window.close();
  } catch {
    const url = tab?.url || '';
    $('#debaitPage').textContent = /^(chrome|edge|about|chrome-extension):|chromewebstore|chrome\.google\.com\/webstore/.test(url)
      ? 'Chrome does not allow extensions on this page'
      : 'Refresh this page to start Debait here';
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
    btn.textContent = 'Gemini Nano is ready';
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
  const start = performance.now();
  const tick = (t) => {
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

(async () => {
  const { debaitErrors = [] } = await chrome.storage.local.get('debaitErrors');
  const recent = debaitErrors.filter((e) => Date.now() - Date.parse(e.at) < 30 * 60 * 1000);
  if (!recent.length) return;
  $('#problems').hidden = false;
  $('#problemList').textContent = recent.slice(0, 3).map((e) => `${e.where}: ${e.message.split('\n')[0]}`).join(' · ');
  $('#copyProblems').addEventListener('click', async () => {
    await navigator.clipboard.writeText(recent.map((e) => `[${e.at}] ${e.where}\n${e.message}`).join('\n\n'));
    $('#copyProblems').textContent = 'Copied';
  });
})();

renderToday();
renderEngine();
renderSwitches();
