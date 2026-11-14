// Settings panel: double-click (or right-click) the orb.
// It pours out of the orb like liquid and drains back into it when closed.
import { MSG } from '../../engine/contract.js';
import { getSettings, setSettings, getRecentStats } from '../../shared/storage.js';
import { SPRING, SOFT, reducedMotion } from './page.js';

const SRC_LABEL = { 'on-device': 'On-device AI', cloud: 'Cloud AI', mock: 'Mock engine', none: 'AI not ready' };

const SWITCHES = [
  { key: 'showTags', title: 'Show tags', hint: 'Rage, Fear, Envy, Clean pills and highlights' },
  { key: 'autoDebait', title: 'Debait automatically', hint: 'Rewrite bait the moment it appears' },
  { key: 'localOnly', title: 'Local only', hint: 'Never send headlines to the cloud' },
  { key: 'showOrb', title: 'Show the Debait ball', hint: 'Bring it back from the toolbar popup' },
];

const CLOSE_ICON = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 2l10 10M12 2L2 12"/></svg>';

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
    // circle grows from the orb's position (in the panel's own coordinates)
    const r = el.getBoundingClientRect();
    const c = orbCenter();
    const ox = c.x - r.left;
    const oy = c.y - r.top;
    const far = Math.max(
      Math.hypot(ox, oy), Math.hypot(ox - r.width, oy),
      Math.hypot(ox, oy - r.height), Math.hypot(ox - r.width, oy - r.height),
    );
    const small = `circle(22px at ${ox}px ${oy}px)`;
    const big = `circle(${far + 20}px at ${ox}px ${oy}px)`;
    return open ? [{ clipPath: small, opacity: 0.4 }, { clipPath: big, opacity: 1 }] : [{ clipPath: big, opacity: 1 }, { clipPath: small, opacity: 0 }];
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
        <div class="p-brand"><span class="mini-orb"></span><b>Debait</b></div>
        <button class="p-close" data-act="close" aria-label="Close settings">${CLOSE_ICON}</button>
      </div>

      <div class="p-meta">
        <span class="chip" data-src="none"><i></i><span>Checking AI…</span></span>
        <span class="p-site">on ${location.hostname.replace(/^www\./, '')}</span>
      </div>

      <div class="p-card">
        <div class="p-kicker">This page</div>
        <div class="p-stats">
          <div class="p-stat hot"><b data-v="bait">0</b><span>bait headlines</span></div>
          <div class="p-stat cool"><b data-v="debaited">0</b><span>debaited</span></div>
        </div>
        <button class="p-main" data-act="toggle">Debait this page</button>
      </div>

      <div class="p-card">
        <div class="p-kicker">Today</div>
        <div class="p-stats">
          <div class="p-stat hot"><b><span data-v="todayPct">0</span><small>%</small></b><span>of headlines were bait</span></div>
          <div class="p-stat"><b data-v="todayTotal">0</b><span>headlines read</span></div>
        </div>
        <div class="p-bar"><span data-k="rage"></span><span data-k="fear"></span><span data-k="envy"></span><span data-k="clean"></span></div>
        <div class="p-legend">
          <span><i style="background:#ff4d2e"></i>Rage <b data-v="rage">0</b></span>
          <span><i style="background:#ff7a1a"></i>Fear <b data-v="fear">0</b></span>
          <span><i style="background:#e8366d"></i>Envy <b data-v="envy">0</b></span>
          <span><i style="background:#2f5bff"></i>Clean <b data-v="clean">0</b></span>
        </div>
      </div>

      <div class="p-group">
        <h4>Settings</h4>
        ${SWITCHES.map((s) => `
          <label class="p-row">
            <span>${s.title}<small>${s.hint}</small></span>
            <input type="checkbox" data-setting="${s.key}" ${settings[s.key] ? 'checked' : ''} />
            <span class="sw"></span>
          </label>`).join('')}
      </div>

      <button class="p-link" data-act="facts">Weekly Mind Facts <span>→</span></button>
      <p class="p-note" hidden></p>
      <p class="p-foot">Double-click the ball anytime · <kbd>Esc</kbd> to close</p>`;

    layer.appendChild(el);

    // sit beside the orb (not under it); fall back to the screen edge if there's no room
    const c = orbCenter();
    const ORB_HALF = 30;
    const GAP = 14;
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

    // pour out of the orb
    if (!reducedMotion()) {
      el.animate(clipFrames(true), { duration: 820, easing: SOFT });
      const parts = el.querySelectorAll('.p-head, .p-meta, .p-card, .p-group h4, .p-row, .p-link, .p-foot');
      parts.forEach((p, i) => {
        p.animate(
          [{ opacity: 0, transform: 'translateY(10px) scale(0.98)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
          { duration: 640, delay: 90 + i * 38, easing: SPRING, fill: 'backwards' },
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
      await el.animate(clipFrames(false), { duration: 420, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }).finished.catch(() => {});
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
      if (!res?.ok) {
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
    const { bait, debaited } = getPage();
    el.querySelector('[data-v="bait"]').textContent = bait;
    el.querySelector('[data-v="debaited"]').textContent = debaited;
    const btn = el.querySelector('.p-main');
    const restore = bait === 0 && debaited > 0;
    btn.classList.toggle('restore', restore);
    btn.textContent = restore ? 'Restore originals' : bait > 0 ? `Debait ${bait} headline${bait === 1 ? '' : 's'}` : 'Nothing to debait here';
    btn.disabled = !restore && bait === 0;
    btn.style.opacity = btn.disabled ? '0.5' : '';
  }

  async function loadToday() {
    const [t] = await getRecentStats(1);
    if (!el) return;
    const bait = t.rage + t.fear + t.envy;
    el.querySelector('[data-v="todayPct"]').textContent = pct(bait, t.total);
    el.querySelector('[data-v="todayTotal"]').textContent = t.total.toLocaleString();
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
    chip.querySelector('span').textContent = SRC_LABEL[s.source] || s.source;
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
