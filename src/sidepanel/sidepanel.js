import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/newsreader';
import { getRecentStats, dayKey } from '../shared/storage.js';

import { KINDS, summarizeWeek, recommendation, statisticsMode } from './statistics.js';
const $ = (s) => document.querySelector(s);
const DAY = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });

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

  const first = new Date(`${days[0].date}T12:00:00`);
  const last = new Date(`${days[6].date}T12:00:00`);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  $('#period').textContent = `${fmt(first)} – ${fmt(last)}`;
  document.body.classList.toggle('empty', !sample && sum.total === 0);
  $('#total').textContent = sum.total.toLocaleString();
  $('#baitPct').textContent = pct(bait) ?? '—';
  $('#baitPct').nextElementSibling.hidden = pct(bait) === null;
  $('#debaited').textContent = sum.debaited.toLocaleString();

  for (const k of KINDS) {
    const row = $(`#kinds [data-k='${k}']`);
    row.querySelector('b').textContent = pct(sum[k]) === null ? '—' : `${pct(sum[k])}%`;
    requestAnimationFrame(() => { row.querySelector('s').style.width = `${pct(sum[k]) ?? 0}%`; });
  }

  // bait by day
  const withData = rates.map((r, i) => [r, i]).filter(([r]) => r !== null);
  const calmest = withData.length ? withData.sort((a, b) => a[0] - b[0])[0][1] : -1;
  $('#days').innerHTML = days.map((d, i) => `
    <div class="day ${i === calmest ? 'calmest' : ''}">
      <span class="pct">${rates[i] === null ? '–' : Math.round(rates[i] * 100) + '%'}</span>
      <div class="col" data-h="${rates[i] === null ? 0 : Math.max(4, rates[i] * 100)}"></div>
      <small>${DAY(d.date)}</small>
    </div>`).join('');
  requestAnimationFrame(() => {
    document.querySelectorAll('.day .col').forEach((c, i) => setTimeout(() => { c.style.height = `${c.dataset.h * 0.75}%`; }, i * 60));
  });
  $('#calmest').innerHTML = calmest >= 0
    ? `Calmest day: <b>${new Date(`${days[calmest].date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}</b>`
    : 'No days with complete category data yet.';

  // sources
  const top = Object.entries(sum.sources).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('#sources').innerHTML = top.length
    ? top.map(([h, n]) => `<li><span>${h}</span><b>${n}</b></li>`).join('')
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
    const total = [212, 188, 247, 176, 151, 203, 229][6 - i]; // fixed, so the demo looks the same every time
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
