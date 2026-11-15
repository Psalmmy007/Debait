import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/newsreader';
import { getRecentStats, dayKey, emptyDay } from '../shared/storage.js';

const $ = (s) => document.querySelector(s);
const KINDS = ['rage', 'fear', 'envy', 'clean'];
const DAY = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });

async function render() {
  const days = await getRecentStats(7);
  const sum = { ...emptyDay() };
  for (const d of days) {
    for (const k of ['total', 'debaited', ...KINDS]) sum[k] += d[k];
    for (const [h, n] of Object.entries(d.sources)) sum.sources[h] = (sum.sources[h] || 0) + n;
  }
  const bait = sum.rage + sum.fear + sum.envy;
  const pct = (n) => (sum.total ? Math.round((n / sum.total) * 100) : 0);

  const first = new Date(`${days[0].date}T12:00:00`);
  const last = new Date(`${days[6].date}T12:00:00`);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  $('#period').textContent = `Weekly · ${fmt(first)} – ${fmt(last)}`;
  $('#total').textContent = sum.total.toLocaleString();
  $('#baitPct').textContent = pct(bait);
  $('#debaited').textContent = sum.debaited.toLocaleString();

  for (const k of KINDS) {
    const row = $(`#kinds [data-k='${k}']`);
    row.querySelector('b').textContent = `${pct(sum[k])}%`;
    requestAnimationFrame(() => { row.querySelector('s').style.width = `${pct(sum[k])}%`; });
  }

  // bait by day
  const rates = days.map((d) => (d.total ? (d.rage + d.fear + d.envy) / d.total : null));
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
    : 'No data yet. Browse X, YouTube or BBC News with Debait on.';

  // sources
  const top = Object.entries(sum.sources).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('#sources').innerHTML = top.length
    ? top.map(([h, n]) => `<li><span>${h}</span><b>${n}</b></li>`).join('')
    : '<li class="empty">Nothing yet</li>';

  // one suggestion
  const worst = top.slice(0, 3).map(([h]) => h);
  const topKind = ['rage', 'fear', 'envy'].sort((a, b) => sum[b] - sum[a])[0];
  $('#tip').innerHTML = !sum.total
    ? '<b>Suggestion</b>Turn on Debait and browse as usual. Your first label appears here.'
    : worst.length >= 2
      ? `<b>Suggestion</b>Mute these ${worst.length} sources: ${worst.join(', ')}. They served most of your ${topKind}.`
      : `<b>Suggestion</b>Your feed leans ${topKind}. Try “Debait automatically” for a calmer week.`;
}

// Fills the last 7 days with realistic numbers, for the demo video.
$('#seed').addEventListener('click', async () => {
  const stats = {};
  const shape = [0.46, 0.41, 0.52, 0.33, 0.24, 0.38, 0.44];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const total = 140 + Math.round(Math.random() * 120);
    const bait = Math.round(total * shape[6 - i]);
    const rage = Math.round(bait * 0.48), fear = Math.round(bait * 0.32), envy = bait - rage - fear;
    stats[dayKey(d)] = {
      total, rage, fear, envy, clean: total - bait, debaited: Math.round(bait * 0.6),
      sources: { 'x.com': Math.round(bait * 0.45), 'youtube.com': Math.round(bait * 0.3), 'dailyoutrage.news': Math.round(bait * 0.15), 'bbc.com': Math.round(bait * 0.1) },
    };
  }
  await chrome.storage.local.set({ stats });
});

chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.stats) render(); });
render();
