import { VOICE_ENABLED } from '../../shared/release.js';
import { focusPopover } from './focus.js';
import { summarizeWeek } from '../../sidepanel/statistics.js';
// The column: double-click (or right-click) the orb.
// It opens out of the orb and folds back into it when closed.
import { MSG } from '../../engine/contract.js';
import { getSettings, setSettings, getRecentStats } from '../../shared/storage.js';
import { reducedMotion } from './page.js';
import { ICON, SOURCE } from './icons.js';
import { setHTML } from './html.js';

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

const SWITCHES = [
  { key: 'showTags', title: 'Show tags' },
  { key: 'autoDebait', title: 'Debait automatically', hint: 'Rewrite bait as it appears' },
  { key: 'localOnly', title: 'Local only', hint: 'Keep every headline on this device' },
  { key: 'showOrb', title: 'Show the orb' },
];
if (VOICE_ENABLED) {
  SWITCHES.splice(2, 0, { key: 'voice', title: 'Voice assistant', hint: 'Live voice call with Gemini' });
}

const LEGEND = [['rage', 'Rage'], ['fear', 'Fear'], ['envy', 'Envy'], ['clean', 'Clean']];

/**
 * @param layer       shadow-root container for the panel
 * @param getPage     () => {bait, debaited, scanned}
 * @param onToggle    () => void   (Debait / restore the page)
 * @param orbCenter   () => {x, y}
 * @param onOpenChange (open) => void
 */
export function createSettingsPanel(layer, { getPage, onToggle, orbCenter, onOpenChange, onSize }) {
  let el = null;
  let closing = false;
  let restoreFocus = () => {};
  let opening = false;
  let openRevision = 0;
  let engineRevision = 0;
  let todayRevision = 0;
  const host = location.hostname.replace(/^www\./, '');

  function clipFrames(open) {
    // a circle that grows out of the orb (in the panel's own coordinates)
    const r = el.getBoundingClientRect();
    const c = orbCenter();
    const ox = c.x - r.left;
    const oy = c.y - r.top;
    const far = Math.max(
      Math.hypot(ox, oy), Math.hypot(ox - r.width, oy),
      Math.hypot(ox, oy - r.height), Math.hypot(ox - r.width, oy - r.height),
    );
    const small = `circle(28px at ${ox}px ${oy}px)`;
    const big = `circle(${far + 24}px at ${ox}px ${oy}px)`;
    return open ? [{ clipPath: small }, { clipPath: big }] : [{ clipPath: big, opacity: 1 }, { clipPath: small, opacity: 0 }];
  }

  async function open() {
    if (el || opening) return;
    opening = true;
    const revision = ++openRevision;
    let settings;
    try { settings = await getSettings(); } finally { if (revision === openRevision) opening = false; }
    if (revision !== openRevision) return;
    el = document.createElement('aside');
    el.className = 'panel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Debait');

    setHTML(el, `
      <header class="p-head">
        <div>
          <h2 class="p-title">Debait</h2>
          <p class="p-engine" data-src="none"><i></i><span>Checking the AI…</span></p>
        </div>
        <button class="p-x" data-act="close" aria-label="Close">${ICON.close}</button>
      </header>

      <p class="p-engine-note" role="status" aria-live="polite" hidden></p>

      <section class="p-card">
        <h4 class="h">This page<span>${host}</span></h4>
        <div class="p-big"><b data-v="bait">0</b><span><em data-v="baitWord">bait headlines</em><span data-v="pageLine">Looking for headlines</span></span></div>
        <button class="btn primary wide" data-act="toggle">Debait this page</button>
      </section>

      <section class="p-card">
        <h4 class="h">Today<span data-v="todayLine">No headlines yet</span></h4>
        <div class="p-today"><b><span data-v="todayPct">0</span><small>%</small></b><span>of headlines were bait</span></div>
        <div class="bar">${LEGEND.map(([k]) => `<span data-k="${k}"></span>`).join('')}</div>
        <div class="p-legend">${LEGEND.map(([k, name]) => `<span><i class="sq" data-k="${k}"></i>${name} <b data-v="${k}">0</b></span>`).join('')}</div>
      </section>

      <h4 class="h p-out">Settings</h4>
      <div class="group">
        <label class="row">
          <span>Run on ${host}</span>
          <input type="checkbox" data-site ${settings.disabledSites.includes(host) ? '' : 'checked'} />
          <span class="sw"></span>
        </label>
        ${SWITCHES.map((s) => `
          <label class="row">
            <span>${s.title}${s.hint ? `<small>${s.hint}</small>` : ''}</span>
            <input type="checkbox" data-setting="${s.key}" ${settings[s.key] ? 'checked' : ''} />
            <span class="sw"></span>
          </label>`).join('')}
        <label class="p-size" for="debait-orb-size">
          <span>Orb size<small data-v="orbSize">${Math.round((settings.orbSize || 1) * 100)}%</small></span>
          <input id="debait-orb-size" type="range" min="0.75" max="1.6" step="0.05" value="${settings.orbSize || 1}" data-size aria-label="Orb size" />
        </label>
      </div>

      <div class="group">
        <button class="row" data-act="facts">Weekly Mind Facts ${ICON.chev}</button>
      </div>
      <p class="p-note" role="status" aria-live="polite" hidden></p>`);

    layer.appendChild(el);
    restoreFocus = focusPopover(el);

    // sit beside the orb (not under it); fall back to the screen edge if there's no room
    const c = orbCenter();
    const ORB_HALF = 28;
    const GAP = 16;
    const W = el.offsetWidth;
    if (c.x >= innerWidth / 2) {
      let right = innerWidth - (c.x - ORB_HALF) + GAP;
      if (innerWidth - right - W < 12) right = 12;
      el.style.right = `${right}px`;
    } else {
      let left = c.x + ORB_HALF + GAP;
      if (left + W > innerWidth - 12) left = 12;
      el.style.left = `${left}px`;
      el.style.right = 'auto';
    }

    onOpenChange?.(true);
    refresh();
    loadToday().catch(() => { if (el) el.querySelector('[data-v="todayLine"]').textContent = 'Stats unavailable'; });
    loadEngine();

    if (!reducedMotion()) {
      el.animate(clipFrames(true), { duration: 600, easing: OUT });
      el.querySelectorAll('.p-head, .p-card, .p-out, .group').forEach((p, i) => {
        p.animate(
          [{ opacity: 0, transform: 'translateY(8px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
          { duration: 460, delay: 70 + i * 40, easing: OUT, fill: 'backwards' },
        );
      });
    }

    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', (event) => {
      if (event.target.dataset?.size === undefined) return;
      const value = Number(event.target.value);
      const label = el?.querySelector('[data-v="orbSize"]');
      if (label) label.textContent = `${Math.round(value * 100)}%`;
      onSize?.(value);
    });
    setTimeout(() => {
      if (!el || closing) return;
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  }

  async function close() {
    openRevision++; opening = false;
    if (!el || closing) return;
    closing = true;
    engineRevision++; todayRevision++;
    restoreFocus();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    if (!reducedMotion()) {
      await el.animate(clipFrames(false), { duration: 340, easing: 'cubic-bezier(0.7, 0, 0.84, 0)', fill: 'forwards' }).finished.catch(() => {});
    }
    el.remove();
    el = null;
    closing = false;
    onOpenChange?.(false);
  }

  function onOutside(e) {
    const path = e.composedPath();
    if (path.includes(el) || path.some((n) => n.classList?.contains('orb-wrap'))) return;
    close();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  async function onClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    if (act === 'toggle') {
      const button = e.target.closest('[data-act]'); button.disabled = true;
      try { await onToggle(); } finally { refresh(); }
    }
    if (act === 'facts') {
      const res = await chrome.runtime.sendMessage({ type: 'debait/openSidePanel' }).catch(() => null);
      if (!res?.ok && el) {
        const note = el.querySelector('.p-note');
        note.hidden = false;
        note.textContent = 'Click the Debait icon in the toolbar, then Weekly Mind Facts.';
      }
    }
  }

  async function onChange(e) {
    if (e.target.dataset?.size !== undefined) {
      const size = Number(e.target.value);
      if (Number.isFinite(size)) await setSettings({ orbSize: Math.max(0.75, Math.min(1.6, size)) });
      return;
    }
    if (e.target.dataset?.site !== undefined) {
      const cur = await getSettings();
      const off = new Set(cur.disabledSites);
      if (e.target.checked) off.delete(host); else off.add(host);
      await setSettings({ disabledSites: [...off] });
      return;
    }
    const key = e.target.dataset?.setting;
    if (!key) return;
    try { await setSettings({ [key]: e.target.checked }); }
    catch {
      e.target.checked = !e.target.checked;
      const note = el?.querySelector('.p-note');
      if (note) { note.hidden = false; note.textContent = 'The setting could not be saved. Please try again.'; }
      return;
    }
    await loadEngine();
    if (key === 'showOrb' && !e.target.checked) close();
  }

  /** Updates the "This page" numbers and the main button. */
  function refresh() {
    if (!el) return;
    const { bait, debaited, scanned, rewritable = bait, pending = 0, busy = false } = getPage();
    el.querySelector('[data-v="bait"]').textContent = bait;
    el.querySelector('[data-v="baitWord"]').textContent = `bait headline${bait === 1 ? '' : 's'}`;
    el.querySelector('[data-v="pageLine"]').textContent = scanned
      ? `of ${scanned} read${debaited ? `, ${debaited} debaited` : ''}`
      : 'Looking for headlines';
    const btn = el.querySelector('[data-act="toggle"]');
    const restore = rewritable === 0 && debaited > 0;
    btn.classList.toggle('primary', !restore);
    btn.textContent = restore
      ? 'Restore originals'
      : pending ? 'Debait this page' : rewritable ? `Debait ${rewritable} headline${rewritable === 1 ? '' : 's'}` : 'Nothing to debait here';
    btn.disabled = busy || (!restore && !pending && !rewritable);
  }

  async function loadToday() {
    const revision = ++todayRevision;
    const summary = summarizeWeek(await getRecentStats(1));
    const t = summary.sum;
    if (!el || revision !== todayRevision) return;
    const bait = t.rage + t.fear + t.envy;
    const pct = summary.percentage(bait);
    const pctEl = el.querySelector('[data-v="todayPct"]');
    pctEl.textContent = pct ?? '—';
    pctEl.nextElementSibling.hidden = pct === null;
    el.querySelector('[data-v="todayLine"]').textContent = !summary.complete ? 'Incomplete data' : t.total
      ? `${t.total.toLocaleString()} headline${t.total === 1 ? '' : 's'}`
      : 'No headlines yet';
    for (const [k] of LEGEND) {
      el.querySelector(`[data-v="${k}"]`).textContent = summary.complete ? t[k] : '—';
      const bar = el.querySelector(`.bar [data-k="${k}"]`);
      requestAnimationFrame(() => { bar.style.width = `${summary.percentage(t[k]) ?? 0}%`; });
    }
  }

  async function loadEngine() {
    const revision = ++engineRevision;
    const res = await chrome.runtime.sendMessage({ type: MSG.STATUS }).catch(() => null);
    if (!el || revision !== engineRevision) return;
    const s = res?.ok ? res.status || { source: 'none', ready: false } : { source: 'none', ready: false, message: 'AI status could not be verified.' };
    const chip = el.querySelector('.p-engine');
    chip.dataset.src = s.source;
    chip.querySelector('span').textContent = SOURCE[s.source] || s.source;
    chip.title = s.message || '';
    const engineNote = el.querySelector('.p-engine-note');
    const hasError = !res?.ok || !s.ready || s.source === 'none';
    const errText = hasError ? (s.message || 'AI status could not be verified.') : '';
    engineNote.textContent = errText;
    engineNote.hidden = !errText;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !el) return;
    if (changes.settings) {
      getSettings().then((settings) => {
        if (el) for (const input of el.querySelectorAll('[data-setting]')) input.checked = !!settings[input.dataset.setting];
      }).catch(() => {});
      loadEngine();
    }
    if (changes.stats) loadToday().catch(() => {});
  });

  return {
    open,
    close,
    toggle: () => (el ? close() : open()),
    refresh,
    isOpen: () => !!el,
  };
}
