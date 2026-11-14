// Settings panel: double-click (or right-click) the orb.
// It opens out of the orb and folds back into it when closed.
import { MSG } from '../../engine/contract.js';
import { getSettings, setSettings, getRecentStats } from '../../shared/storage.js';
import { reducedMotion } from './page.js';
import { ICON, SOURCE } from './icons.js';

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

const SWITCHES = [
  { key: 'showTags', title: 'Show tags', hint: 'Labels and highlights on headlines' },
  { key: 'autoDebait', title: 'Debait automatically', hint: 'Rewrite bait the moment it appears' },
  { key: 'localOnly', title: 'Local only', hint: 'Never send headlines to the cloud' },
  { key: 'showOrb', title: 'Show the orb', hint: 'Bring it back from the toolbar popup' },
];

const LEGEND = [
  ['rage', 'Rage', '#fff'],
  ['fear', 'Fear', '#a1a1aa'],
  ['envy', 'Envy', '#5f5f68'],
  ['clean', 'Clean', 'repeating-linear-gradient(-45deg, rgba(255,255,255,.45) 0 2px, transparent 2px 4px)'],
];

/**
 * @param layer       shadow-root container for the panel
 * @param getPage     () => {bait, debaited, scanned}
 * @param onToggle    () => void   (Debait / restore the page)
 * @param orbCenter   () => {x, y}
 * @param onOpenChange (open) => void
 */
export function createSettingsPanel(layer, { getPage, onToggle, orbCenter, onOpenChange }) {
  let el = null;
  let closing = false;

  const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

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
    if (el) return;
    const settings = await getSettings();
    el = document.createElement('aside');
    el.className = 'panel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Debait settings');

    el.innerHTML = `
      <div class="p-head">
        <div class="p-brand"><span class="p-logo"></span><div><b>Debait</b><small>Nutrition facts for your feed</small></div></div>
        <button class="icon-btn" data-act="close" aria-label="Close settings">${ICON.close}</button>
      </div>

      <div class="p-meta">
        <span class="chip" data-src="none"><i></i><span>Checking AI…</span></span>
        <span class="p-site">${location.hostname.replace(/^www\./, '')}</span>
      </div>

      <section class="p-sec">
        <h4>This page</h4>
        <div class="p-split">
          <div class="p-num"><b data-v="bait">0</b><span>bait</span></div>
          <div class="p-num"><b data-v="debaited">0</b><span>debaited</span></div>
          <div class="p-num dim"><b data-v="scanned">0</b><span>read</span></div>
        </div>
        <button class="btn primary p-main" data-act="toggle">Debait this page</button>
      </section>

      <section class="p-sec">
        <h4>Today</h4>
        <div class="p-today"><b><span data-v="todayPct">0</span><small>%</small></b><span data-v="todayLine">of headlines were bait</span></div>
        <div class="p-bar">${LEGEND.map(([k]) => `<span data-k="${k}"></span>`).join('')}</div>
        <div class="p-legend">${LEGEND.map(([k, name, bg]) => `<span><i style="background:${bg}"></i>${name} <b data-v="${k}">0</b></span>`).join('')}</div>
      </section>

      <section class="p-sec">
        <h4>Settings</h4>
        ${SWITCHES.map((s) => `
          <label class="p-row">
            <span>${s.title}<small>${s.hint}</small></span>
            <input type="checkbox" data-setting="${s.key}" ${settings[s.key] ? 'checked' : ''} />
            <span class="sw"></span>
          </label>`).join('')}
      </section>

      <button class="p-link" data-act="facts">Weekly Mind Facts ${ICON.arrow}</button>
      <p class="p-note" hidden></p>
      <p class="p-foot"><kbd>2×</kbd> click the orb <span aria-hidden="true">·</span> <kbd>Esc</kbd> to close</p>`;

    layer.appendChild(el);

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
    loadToday();
    loadEngine();

    if (!reducedMotion()) {
      el.animate(clipFrames(true), { duration: 700, easing: OUT });
      const parts = el.querySelectorAll('.p-head, .p-meta, .p-sec h4, .p-split, .p-main, .p-today, .p-bar, .p-legend, .p-row, .p-link, .p-foot');
      parts.forEach((p, i) => {
        p.animate(
          [{ opacity: 0, transform: 'translateY(8px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
          { duration: 520, delay: 60 + i * 28, easing: OUT, fill: 'backwards' },
        );
      });
    }

    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    setTimeout(() => {
      document.addEventListener('pointerdown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
  }

  async function close() {
    if (!el || closing) return;
    closing = true;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    if (!reducedMotion()) {
      await el.animate(clipFrames(false), { duration: 380, easing: 'cubic-bezier(0.7, 0, 0.84, 0)', fill: 'forwards' }).finished.catch(() => {});
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
      onToggle();
      setTimeout(refresh, 50);
    }
    if (act === 'facts') {
      const res = await chrome.runtime.sendMessage({ type: 'debait/openSidePanel' }).catch(() => null);
      if (!res?.ok && el) {
        const note = el.querySelector('.p-note');
        note.hidden = false;
        note.textContent = 'Click the Debait icon in the toolbar, then "Open Weekly Mind Facts".';
      }
    }
  }

  async function onChange(e) {
    const key = e.target.dataset?.setting;
    if (!key) return;
    await setSettings({ [key]: e.target.checked });
    if (key === 'showOrb' && !e.target.checked) close();
  }

  /** Updates the "This page" numbers and the main button. */
  function refresh() {
    if (!el) return;
    const { bait, debaited, scanned } = getPage();
    el.querySelector('[data-v="bait"]').textContent = bait;
    el.querySelector('[data-v="debaited"]').textContent = debaited;
    el.querySelector('[data-v="scanned"]').textContent = scanned;
    const btn = el.querySelector('.p-main');
    const restore = bait === 0 && debaited > 0;
    btn.classList.toggle('primary', !restore);
    btn.innerHTML = restore
      ? 'Restore originals'
      : bait > 0 ? `Debait ${bait} headline${bait === 1 ? '' : 's'} ${ICON.arrow}` : 'Nothing to debait here';
    btn.disabled = !restore && bait === 0;
  }

  async function loadToday() {
    const [t] = await getRecentStats(1);
    if (!el) return;
    const bait = t.rage + t.fear + t.envy;
    el.querySelector('[data-v="todayPct"]').textContent = pct(bait, t.total);
    el.querySelector('[data-v="todayLine"]').textContent = t.total
      ? `of ${t.total.toLocaleString()} headlines were bait`
      : 'No headlines read yet today';
    for (const k of ['rage', 'fear', 'envy', 'clean']) {
      el.querySelector(`[data-v="${k}"]`).textContent = t[k];
      const bar = el.querySelector(`.p-bar [data-k="${k}"]`);
      requestAnimationFrame(() => { bar.style.width = `${pct(t[k], t.total)}%`; });
    }
  }

  async function loadEngine() {
    const res = await chrome.runtime.sendMessage({ type: MSG.STATUS }).catch(() => null);
    if (!el) return;
    const s = res?.status || { source: 'none' };
    const chip = el.querySelector('.chip');
    chip.dataset.src = s.source;
    chip.querySelector('span').textContent = SOURCE[s.source] || s.source;
    chip.title = s.message || '';
  }

  return {
    open,
    close,
    toggle: () => (el ? close() : open()),
    refresh,
    isOpen: () => !!el,
  };
}
