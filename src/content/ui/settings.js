// The column: double-click (or right-click) the orb.
// It opens out of the orb and folds back into it when closed.
import { MSG } from '../../engine/contract.js';
import { getSettings, setSettings, getRecentStats } from '../../shared/storage.js';
import { reducedMotion } from './page.js';
import { ICON, SOURCE } from './icons.js';
import { setHTML } from './html.js';
import { send } from '../ext.js';

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

const SWITCHES = [
  { key: 'showTags', title: 'Show tags' },
  { key: 'autoDebait', title: 'Debait automatically', hint: 'Rewrite bait as it appears' },
  { key: 'voice', title: 'Talk to Debait', hint: 'Live voice call with Gemini' },
  { key: 'localOnly', title: 'Local only', hint: 'Keep every headline on this device' },
  { key: 'showOrb', title: 'Show the orb' },
];

const LEGEND = [['rage', 'Rage'], ['fear', 'Fear'], ['envy', 'Envy'], ['clean', 'Clean']];

/**
 * @param layer       shadow-root container for the panel
 * @param getPage     () => {bait, debaited, scanned}
 * @param onToggle    () => void   (Debait / restore the page)
 * @param orbCenter   () => {x, y}
 * @param onOpenChange (open) => void
 */
export function createSettingsPanel(layer, { getPage, onToggle, orbCenter, onOpenChange, onSize, onSummarize }) {
  let el = null;
  let closing = false;
  const host = location.hostname.replace(/^www\./, '');

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
    el.setAttribute('aria-label', 'Debait');

    setHTML(el, `
      <div class="p-head">
        <span class="p-word">Debait</span>
        <button class="p-x" data-act="close" aria-label="Close">${ICON.close}</button>
      </div>
      <p class="p-engine" data-src="none"><i></i><span>Checking the AI…</span></p>
      <div class="rule thick"></div>

      <section class="p-sec">
        <div class="p-h"><h4 class="micro">This page</h4><span>${host}</span></div>
        <div class="p-big"><b data-v="bait">0</b><span><em data-v="baitWord">bait headlines</em><span data-v="pageLine">Looking for headlines</span></span></div>
        <button class="btn primary p-main" data-act="toggle">Debait this page</button>
      </section>

      <section class="p-sec p-sum">
        <div class="p-h"><h4 class="micro">In short</h4></div>
        <p class="p-sum-text" hidden></p>
        <button class="btn p-main" data-act="summary">Summarize this page</button>
      </section>

      <section class="p-sec">
        <div class="p-h"><h4 class="micro">Today</h4><span data-v="todayLine">No headlines yet</span></div>
        <div class="p-today-n"><b><span data-v="todayPct">0</span><small>%</small></b><span>of headlines were bait</span></div>
        <div class="p-bar">${LEGEND.map(([k]) => `<span data-k="${k}"></span>`).join('')}</div>
        <div class="p-legend">${LEGEND.map(([k, name]) => `<span><i data-k="${k}"></i>${name} <b data-v="${k}">0</b></span>`).join('')}</div>
      </section>

      <section class="p-sec p-set">
        <div class="p-h"><h4 class="micro">Settings</h4></div>
        <label class="p-row">
          <span>Run on ${host}</span>
          <input type="checkbox" data-site ${settings.disabledSites.includes(host) ? '' : 'checked'} />
          <span class="sw"></span>
        </label>
        ${SWITCHES.map((s) => `
          <label class="p-row">
            <span>${s.title}${s.hint ? `<small>${s.hint}</small>` : ''}</span>
            <input type="checkbox" data-setting="${s.key}" ${settings[s.key] ? 'checked' : ''} />
            <span class="sw"></span>
          </label>`).join('')}
        <label class="p-size">
          <span>Orb size<small data-v="orbSize">${Math.round((settings.orbSize || 1) * 100)}%</small></span>
          <input type="range" min="0.75" max="1.6" step="0.05" value="${settings.orbSize || 1}" data-size aria-label="Orb size" />
        </label>
      </section>

      <button class="p-link" data-act="facts">Weekly Mind Facts ${ICON.arrow}</button>
      <p class="p-note" hidden></p>`);

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
      el.animate(clipFrames(true), { duration: 560, easing: OUT });
      const parts = el.querySelectorAll('.p-head, .p-engine, .p-sec, .p-link');
      parts.forEach((p, i) => {
        p.animate(
          [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
          { duration: 420, delay: 80 + i * 35, easing: OUT, fill: 'backwards' },
        );
      });
    }

    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onSizeInput);
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
      onToggle();
      setTimeout(refresh, 50);
    }
    if (act === 'summary') summarize();
    if (act === 'facts') {
      const res = await send({ type: 'debait/openSidePanel' });
      if (!res?.ok && el) {
        const note = el.querySelector('.p-note');
        note.hidden = false;
        note.textContent = 'Click the Debait icon in the toolbar, then "Weekly Mind Facts".';
      }
    }
  }

  function onSizeInput(e) {
    if (e.target.dataset?.size === undefined) return;
    el.querySelector('[data-v="orbSize"]').textContent = `${Math.round(e.target.value * 100)}%`;
    onSize?.(Number(e.target.value));
  }

  async function onChange(e) {
    if (e.target.dataset?.size !== undefined) {
      await setSettings({ orbSize: Number(e.target.value) });
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
    await setSettings({ [key]: e.target.checked });
    if (key === 'showOrb' && !e.target.checked) close();
  }

  async function summarize() {
    const sec = el?.querySelector('.p-sum');
    if (!sec || sec.classList.contains('loading')) return;
    const out = sec.querySelector('.p-sum-text');
    const btn = sec.querySelector('[data-act="summary"]');
    sec.classList.add('loading');
    out.hidden = false;
    out.textContent = 'Reading the whole page…';
    btn.disabled = true;
    btn.textContent = 'Summarizing…';
    try {
      const { summary, source } = await onSummarize();
      if (!el) return;
      out.textContent = summary;
      out.classList.add('done');
      sec.dataset.src = source;
      btn.hidden = true;
      const by = document.createElement('span');
      by.textContent = { 'on-device': 'Gemini Nano', cloud: 'Gemini', mock: 'Quick summary' }[source] || '';
      sec.querySelector('.p-h').append(by);
      if (!reducedMotion()) out.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: OUT });
    } catch (err) {
      out.textContent = /LOCAL_ONLY/.test(err.message) ? 'Local only is on, but Gemini Nano is not ready on this computer.' : 'Could not summarize this page. Try again in a moment.';
      btn.disabled = false;
      btn.textContent = 'Try again';
    } finally {
      sec.classList.remove('loading');
    }
  }

  /** Updates the "This page" numbers and the main button. */
  function refresh() {
    if (!el) return;
    const { bait, debaited, scanned } = getPage();
    el.querySelector('[data-v="bait"]').textContent = bait;
    el.querySelector('[data-v="baitWord"]').textContent = `bait headline${bait === 1 ? '' : 's'}`;
    el.querySelector('[data-v="pageLine"]').textContent = scanned
      ? `of ${scanned} read${debaited ? `, ${debaited} debaited` : ''}`
      : 'Looking for headlines';
    const btn = el.querySelector('[data-act="toggle"]');
    const restore = bait === 0 && debaited > 0;
    btn.classList.toggle('primary', !restore);
    setHTML(btn, restore
      ? 'Restore originals'
      : bait > 0 ? `Debait ${bait} headline${bait === 1 ? '' : 's'} ${ICON.arrow}` : 'Nothing to debait here');
    btn.disabled = !restore && bait === 0;
  }

  async function loadToday() {
    const [t] = await getRecentStats(1);
    if (!el) return;
    const bait = t.rage + t.fear + t.envy;
    el.querySelector('[data-v="todayPct"]').textContent = pct(bait, t.total);
    el.querySelector('[data-v="todayLine"]').textContent = t.total
      ? `${t.total.toLocaleString()} headline${t.total === 1 ? '' : 's'}`
      : 'No headlines yet';
    for (const [k] of LEGEND) {
      el.querySelector(`[data-v="${k}"]`).textContent = t[k];
      const bar = el.querySelector(`.p-bar [data-k="${k}"]`);
      requestAnimationFrame(() => { bar.style.width = `${pct(t[k], t.total)}%`; });
    }
  }

  async function loadEngine() {
    const res = await send({ type: MSG.STATUS });
    if (!el) return;
    const s = res?.status || { source: 'none' };
    const chip = el.querySelector('.p-engine');
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
