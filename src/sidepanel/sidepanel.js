import '@fontsource-variable/inter/opsz.css';
import { getRecentStats, dayKey, emptyDay } from '../shared/storage.js';
import { ICON } from '../content/ui/icons.js';

const $ = (s) => document.querySelector(s);
const KINDS = ['rage', 'fear', 'envy', 'clean'];
const at = (key) => new Date(`${key}T12:00:00`);
const DAY = (key) => at(key).toLocaleDateString('en-US', { weekday: 'narrow' });
const LABEL_H = 25; // day letters under the bars

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = ICON[el.dataset.icon];

let showingSample = false;

async function render() {
  const days = showingSample ? sampleWeek() : await getRecentStats(7);
  document.body.classList.toggle('sample', showingSample);
  const sum = { ...emptyDay() };
  for (const d of days) {
    for (const k of ['total', 'debaited', ...KINDS]) sum[k] += d[k];
    for (const [h, n] of Object.entries(d.sources)) sum.sources[h] = (sum.sources[h] || 0) + n;
  }
  const bait = sum.rage + sum.fear + sum.envy;
  const pct = (n) => (sum.total ? Math.round((n / sum.total) * 100) : 0);

  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  $('#period').textContent = `${fmt(at(days[0].date))} – ${fmt(at(days[6].date))}`;
  document.body.classList.toggle('empty', !showingSample && sum.total === 0);
  $('#baitPct').textContent = pct(bait);
  $('#checkedLine').textContent = `${sum.total.toLocaleString()} headline${sum.total === 1 ? '' : 's'} checked`;
  $('#total').textContent = sum.total.toLocaleString();
  $('#debaited').textContent = sum.debaited.toLocaleString();

  for (const k of KINDS) {
    $(`#kinds [data-k='${k}'] b`).textContent = `${pct(sum[k])}%`;
    const seg = $(`#stack [data-k='${k}']`);
    requestAnimationFrame(() => { seg.style.width = `${pct(sum[k])}%`; });
  }

  // the week: each bar is that day's share of bait, scaled to the busiest day
  const rates = days.map((d) => (d.total ? (d.rage + d.fear + d.envy) / d.total : null));
  const known = rates.filter((r) => r !== null);
  const max = Math.max(0.01, ...known);
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  const calmest = known.length ? rates.indexOf(Math.min(...known)) : -1;
  $('#days').innerHTML = days.map((d, i) => `
    <div class="day ${i === calmest ? 'calmest' : ''} ${rates[i] === null ? 'none' : ''}" title="${rates[i] === null ? 'No headlines' : `${Math.round(rates[i] * 100)}% bait`}">
      <div class="col" data-h="${rates[i] === null ? 0 : Math.max(4, (rates[i] / max) * 100)}"></div>
      <small>${DAY(d.date)}</small>
    </div>`).join('');
  const chartH = $('.chart').clientHeight - LABEL_H;
  requestAnimationFrame(() => {
    document.querySelectorAll('.day .col').forEach((c, i) => setTimeout(() => { c.style.height = `${(c.dataset.h / 100) * chartH}px`; }, i * 50));
    const avgEl = $('#avg');
    avgEl.hidden = !known.length;
    avgEl.style.bottom = `${LABEL_H + (avg / max) * chartH}px`;
  });
  $('#calmest').innerHTML = calmest >= 0
    ? `Calmest day: <b>${at(days[calmest].date).toLocaleDateString('en-US', { weekday: 'long' })}</b>, ${Math.round(rates[calmest] * 100)}% bait. Average ${Math.round(avg * 100)}%.`
    : 'No days with real data yet.';

  // sources
  const top = Object.entries(sum.sources).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('#sources').innerHTML = top.length
    ? top.map(([h, n], i) => `<li><span class="rank">${i + 1}</span><span class="dom">${h}</span><b>${n}</b></li>`).join('')
    : '<li class="empty">Nothing yet</li>';

  // one suggestion
  const worst = top.slice(0, 3).map(([h]) => h);
  const topKind = ['rage', 'fear', 'envy'].sort((a, b) => sum[b] - sum[a])[0];
  $('#tip').innerHTML = !sum.total
    ? '<b>Suggestion</b>Browse as usual. Debait counts only headlines that Gemini actually checked, so your week fills in once Gemini is on.'
    : worst.length >= 2
      ? `<b>Suggestion</b>Mute these ${worst.length} sources: ${worst.join(', ')}. They served most of your ${topKind}.`
      : `<b>Suggestion</b>Your feed leans ${topKind}. Try “Debait automatically” for a calmer week.`;
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
