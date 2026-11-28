import '@fontsource-variable/inter';
import { getRecentStats, dayKey } from '../shared/storage.js';
import { ICON } from '../content/ui/icons.js';
import { KINDS, summarizeWeek, recommendation, statisticsMode } from './statistics.js';

const $ = (s) => document.querySelector(s);
const at = (key) => new Date(`${key}T12:00:00`);
const DAY = (key) => at(key).toLocaleDateString('en-US', { weekday: 'narrow' });
const LABEL_H = 25; // day letters under the bars
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = ICON[el.dataset.icon];

let showingSample = false;
let renderRevision = 0;
const realFoot = $('.foot').textContent;

async function render() {
  const revision = ++renderRevision;
  const sample = showingSample;
  const days = sample ? sampleWeek() : await getRecentStats(7);
  // A delayed real-data read must not overwrite a newer sample/real selection.
  if (revision !== renderRevision || sample !== showingSample) return;
  document.body.classList.toggle('sample', sample);
  const summary = summarizeWeek(days);
  const { sum, bait, rates, percentage: pct } = summary;
  const mode = statisticsMode(sample);
  $('#realChip').textContent = mode.badge;
  $('.foot').textContent = sample ? mode.sampleFoot : realFoot;

  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  $('#period').textContent = `${fmt(at(days[0].date))} – ${fmt(at(days[6].date))}`;
  document.body.classList.toggle('empty', !sample && sum.total === 0);
  $('#checkedLine').textContent = `${sum.total.toLocaleString()} headline${sum.total === 1 ? '' : 's'} checked`;
  $('#total').textContent = sum.total.toLocaleString();
  $('#baitPct').textContent = pct(bait) ?? '—';
  $('#baitPct').nextElementSibling.hidden = pct(bait) === null;
  $('#debaited').textContent = sum.debaited.toLocaleString();

  for (const k of KINDS) {
    const row = $(`#kinds [data-k='${k}']`);
    row.querySelector('b').textContent = pct(sum[k]) === null ? '—' : `${pct(sum[k])}%`;
    const seg = $(`#stack [data-k='${k}']`);
    requestAnimationFrame(() => { seg.style.width = `${pct(sum[k]) ?? 0}%`; });
  }

  // the week: each bar is that day's share of bait, scaled to the busiest day
  const known = rates.filter((r) => r !== null);
  const max = Math.max(0.01, ...known);
  const avg = summary.complete && sum.total ? bait / sum.total : 0;
  const calmest = known.length >= 2 ? rates.indexOf(Math.min(...known)) : -1;
  const only = known.length === 1 ? rates.findIndex((r) => r !== null) : -1;
  $('#days').innerHTML = days.map((d, i) => `
    <div class="day ${i === calmest ? 'calmest' : ''} ${rates[i] === null ? 'none' : ''}" title="${rates[i] === null ? 'No headlines' : `${Math.round(rates[i] * 100)}% bait`}">
      <div class="col" data-h="${rates[i] === null ? 0 : Math.max(4, (rates[i] / max) * 100)}"></div>
      <small>${DAY(d.date)}</small>
    </div>`).join('');
  const chartH = ($('.chart').clientHeight || 140) - LABEL_H;
  requestAnimationFrame(() => {
    document.querySelectorAll('.day .col').forEach((c, i) => setTimeout(() => { c.style.height = `${(c.dataset.h / 100) * chartH}px`; }, i * 50));
    const avgEl = $('#avg');
    avgEl.hidden = !known.length;
    avgEl.style.bottom = `${LABEL_H + (avg / max) * chartH}px`;
  });
  const weekday = (i) => at(days[i].date).toLocaleDateString('en-US', { weekday: 'long' });
  $('#calmest').innerHTML = calmest >= 0
    ? `Calmest day: <b>${weekday(calmest)}</b>, ${Math.round(rates[calmest] * 100)}% bait. Average ${Math.round(avg * 100)}%.`
    : only >= 0
      ? `Only <b>${weekday(only)}</b> so far: ${Math.round(rates[only] * 100)}% bait. Your calmest day shows up as the week fills in.`
      : 'No days with complete category data yet.';

  // sources
  const top = Object.entries(sum.sources).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('#sources').innerHTML = top.length
    ? top.map(([h, n], i) => `<li><span class="rank">${i + 1}</span><span class="dom">${esc(h)}</span><b>${n}</b></li>`).join('')
    : '<li class="empty">Nothing yet</li>';

  // Recommendations describe validated category counts, not unsupported claims
  // about a site's contribution to a particular emotion.
  const title = document.createElement('b');
  title.textContent = 'Suggestion';
  $('#tip').replaceChildren(title, document.createTextNode(recommendation(summary, sample)));
}

// A made-up week for previews and the demo video. It is only drawn on screen and never saved,
// so it can't mix with your real numbers.
function sampleWeek() {
  const out = [];
  const shape = [0.46, 0.41, 0.52, 0.33, 0.24, 0.38, 0.44];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const total = [212, 188, 247, 176, 151, 203, 229][6 - i];
    const bait = Math.round(total * shape[6 - i]);
    const rage = Math.round(bait * 0.48), fear = Math.round(bait * 0.32), envy = bait - rage - fear;
    out.push({
      date: dayKey(d), total, rage, fear, envy, clean: total - bait, debaited: Math.round(bait * 0.6),
      sources: { 'x.com': Math.round(bait * 0.45), 'youtube.com': Math.round(bait * 0.3), 'dailyoutrage.news': Math.round(bait * 0.15), 'bbc.com': Math.round(bait * 0.1) },
    });
  }
  return out;
}
$('#seed').addEventListener('click', () => {
  showingSample = !showingSample;
  $('#seed').textContent = showingSample ? 'Back to my real week' : 'Show a sample week';
  render();
});

chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.stats) render(); });
render();
