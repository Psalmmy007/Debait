import '@fontsource-variable/inter/opsz.css';
import { getRecentStats, emptyDay } from '../shared/storage.js';
import { ICON } from '../content/ui/icons.js';

const $ = (s) => document.querySelector(s);
const KINDS = ['rage', 'fear', 'envy', 'clean'];
const at = (key) => new Date(`${key}T12:00:00`);
const DAY = (key) => at(key).toLocaleDateString('en-US', { weekday: 'narrow' });
const LABEL_H = 25; // day letters under the bars

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = ICON[el.dataset.icon];

// Only real numbers: every count here comes from headlines Gemini actually checked while you browsed.
async function render() {
  const days = await getRecentStats(7);
  const sum = { ...emptyDay() };
  for (const d of days) {
    for (const k of ['total', 'debaited', ...KINDS]) sum[k] += d[k];
    for (const [h, n] of Object.entries(d.sources)) sum.sources[h] = (sum.sources[h] || 0) + n;
  }
  const bait = sum.rage + sum.fear + sum.envy;
  const pct = (n) => (sum.total ? Math.round((n / sum.total) * 100) : 0);

  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  $('#period').textContent = `${fmt(at(days[0].date))} – ${fmt(at(days[6].date))}`;
  document.body.classList.toggle('empty', sum.total === 0);
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
  const avg = sum.total ? bait / sum.total : 0; // the week's real share, the same number as the big %
  // a calmest day only means something once there are two days to compare
  const calmest = known.length >= 2 ? rates.indexOf(Math.min(...known)) : -1;
  const only = known.length === 1 ? rates.findIndex((r) => r !== null) : -1;
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
  const weekday = (i) => at(days[i].date).toLocaleDateString('en-US', { weekday: 'long' });
  $('#calmest').innerHTML = calmest >= 0
    ? `Calmest day: <b>${weekday(calmest)}</b>, ${Math.round(rates[calmest] * 100)}% bait. Average ${Math.round(avg * 100)}%.`
    : only >= 0
      ? `Only <b>${weekday(only)}</b> so far: ${Math.round(rates[only] * 100)}% bait. Your calmest day shows up as the week fills in.`
      : 'No days with real data yet.';

  // sources
  const top = Object.entries(sum.sources).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('#sources').innerHTML = top.length
    ? top.map(([h, n], i) => `<li><span class="rank">${i + 1}</span><span class="dom">${h}</span><b>${n}</b></li>`).join('')
    : '<li class="empty">Nothing yet</li>';

  // one suggestion, worded from the real numbers so it never claims more than they show
  const kindName = { rage: 'anger', fear: 'fear', envy: 'envy' };
  const topKind = ['rage', 'fear', 'envy'].sort((a, b) => sum[b] - sum[a])[0];
  const worst = top.slice(0, 3);
  const worstShare = bait ? Math.round((worst.reduce((n, [, c]) => n + c, 0) / bait) * 100) : 0;
  const list = (hosts) => (hosts.length > 1 ? `${hosts.slice(0, -1).join(', ')} and ${hosts[hosts.length - 1]}` : hosts[0]);
  $('#tip').innerHTML = !sum.total
    ? '<b>Suggestion</b>Browse as usual. Debait counts only headlines that Gemini actually checked, so your week fills in as you read.'
    : !bait
      ? '<b>Suggestion</b>No bait in what you read this week. Keep it up.'
      : worst.length >= 2
        ? `<b>Suggestion</b>${list(worst.map(([h]) => h))} served ${worstShare}% of your bait this week. Muting ${worst.length === 2 ? 'both' : 'them'} would calm your feed the most.`
        : `<b>Suggestion</b>Most of your bait this week played on ${kindName[topKind]}. Try “Debait automatically” for a calmer week.`;
}

chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.stats) render(); });
render();
