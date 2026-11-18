import { focusPopover } from './focus.js';
import { createIngredientsGuide } from '../../shared/ingredientsView.js';
import { summarizeWeek } from '../../sidepanel/statistics.js';
// Settings panel: double-click (or right-click) the orb.
// It opens out of the orb and folds back into it when closed.
import { MSG } from '../../engine/contract.js';
import { getSettings, setSettings, getRecentStats } from '../../shared/storage.js';
import { reducedMotion } from './page.js';
import { ICON, SOURCE } from './icons.js';
import { setHTML } from './html.js';

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

const SWITCHES = [
  { key: 'voice', title: 'Talk to Debait', hint: 'A live voice call with Gemini. Ask anything about this page.' },
  { key: 'showTags', title: 'Show tags', hint: 'Labels and highlights on headlines' },
  { key: 'autoDebait', title: 'Debait automatically', hint: 'Apply only safe alternatives on enabled sites' },
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
  let restoreFocus = () => {};
  let opening = false;
  let engineRevision = 0;
  let todayRevision = 0;

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
    let settings;
    try { settings = await getSettings(); } finally { opening = false; }
    el = document.createElement('aside');
    el.className = 'panel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Debait settings');

    setHTML(el, `
      <div class="p-head">
        <div class="p-brand"><span class="p-logo"></span><div><b>Debait</b><small>Nutrition facts for your feed</small></div></div>
        <button class="icon-btn" data-act="close" aria-label="Close settings">${ICON.close}</button>
      </div>

      <div class="p-meta">
        <span class="chip" data-src="none"><i></i><span>Checking AI…</span></span>
        <span class="p-site">${location.hostname.replace(/^www\./, '')}</span>
      </div>

      <p class="p-engine-note" role="status" aria-live="polite"></p>

      <section class="p-hero">
        <span class="p-eyebrow">Today’s Feed</span>
        <div class="p-today"><b><span data-v="todayPct">0</span><small>%</small></b></div>
        <span class="p-today-line" data-v="todayLine">of analyzed headlines were flagged</span>
        <div class="p-bar">${LEGEND.map(([k]) => `<span data-k="${k}"></span>`).join('')}</div>
        <div class="p-legend">${LEGEND.map(([k, name]) => `<span><i data-k="${k}"></i>${name} <b data-v="${k}">0</b></span>`).join('')}</div>
      </section>

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
        <h4>Settings</h4>
          <label class="p-row">
            <span>Run on this site<small>${location.hostname.replace(/^www\./, '')}</small></span>
            <input type="checkbox" data-site ${settings.disabledSites.includes(location.hostname.replace(/^www\./, '')) ? '' : 'checked'} />
            <span class="sw"></span>
          </label>
        ${SWITCHES.map((s) => `
          <label class="p-row">
            <span>${s.title}<small>${s.hint}</small></span>
            <input type="checkbox" data-setting="${s.key}" ${settings[s.key] ? 'checked' : ''} />
            <span class="sw"></span>
          </label>`).join('')}
      </section>

      <button class="p-link" data-act="facts">Weekly Mind Facts ${ICON.arrow}</button>
      <p class="p-note" role="status" aria-live="polite" hidden></p>
      <p class="p-foot"><kbd>2×</kbd> click the orb <span aria-hidden="true">·</span> <kbd>Esc</kbd> to close</p>`);

    el.insertBefore(createIngredientsGuide(), el.querySelector('.p-foot'));
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
    loadToday().catch(() => { if (el) el.querySelector('[data-v="todayLine"]').textContent = 'Reading statistics are temporarily unavailable.'; });
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
    engineRevision++; todayRevision++;
    restoreFocus();
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
      const button = e.target.closest('[data-act]'); button.disabled = true;
      try { await onToggle(); } finally { refresh(); }
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
    if (e.target.dataset?.site !== undefined) {
      const host = location.hostname.replace(/^www\./, '');
      const cur = await getSettings();
      const off = new Set(cur.disabledSites);
      if (e.target.checked) off.delete(host); else off.add(host);
      await setSettings({ disabledSites: [...off] });
      return;
    }
    const key = e.target.dataset?.setting;
    if (!key) return;
    try { await setSettings({ [key]: e.target.checked }); }
    catch { e.target.checked = !e.target.checked; const note = el?.querySelector('.p-note'); if (note) { note.hidden = false; note.textContent = 'The setting could not be saved. Please try again.'; } return; }
    await loadEngine();
    if (key === 'showOrb' && !e.target.checked) close();
  }

  /** Updates the "This page" numbers and the main button. */
  function refresh() {
    if (!el) return;
    const { bait, debaited, scanned, rewritable = bait, pending = 0, busy = false, notice = '', automatic = false } = getPage();
    el.querySelector('[data-v="bait"]').textContent = bait;
    el.querySelector('[data-v="debaited"]').textContent = debaited;
    el.querySelector('[data-v="scanned"]').textContent = scanned;
    const btn = el.querySelector('.p-main');
    const restore = rewritable === 0 && debaited > 0;
    btn.classList.toggle('primary', !restore);
    setHTML(btn, restore
      ? 'Restore originals'
      : pending ? 'Analyze and Debait this page' : rewritable ? `Apply ${rewritable} safe rewrite${rewritable === 1 ? '' : 's'} ${ICON.arrow}` : bait ? 'No safe page rewrites available' : 'No flagged headlines to rewrite');
    btn.disabled = busy || (!restore && !pending && !rewritable);
    const note = el.querySelector('.p-note');
    note.hidden = !notice && !automatic;
    note.textContent = notice || (automatic ? 'Auto-Debait is on for enabled sites; only safe alternatives are applied.' : '');
  }

  async function loadToday() {
    const revision = ++todayRevision;
    const summary = summarizeWeek(await getRecentStats(1));
    const t = summary.sum;
    if (!el || revision !== todayRevision) return;
    const bait = t.rage + t.fear + t.envy;
    el.querySelector('[data-v="todayPct"]').textContent = summary.percentage(bait) ?? '—';
    el.querySelector('[data-v="todayLine"]').textContent = !summary.complete ? 'Category data is incomplete' : t.total
      ? `of ${t.total.toLocaleString()} analyzed headlines were flagged`
      : 'No headlines read yet today';
    for (const k of ['rage', 'fear', 'envy', 'clean']) {
      el.querySelector(`[data-v="${k}"]`).textContent = summary.complete ? t[k] : '—';
      const bar = el.querySelector(`.p-bar [data-k="${k}"]`);
      requestAnimationFrame(() => { bar.style.width = `${summary.percentage(t[k]) ?? 0}%`; });
    }
  }

  async function loadEngine() {
    const revision = ++engineRevision;
    const res = await chrome.runtime.sendMessage({ type: MSG.STATUS }).catch(() => null);
    if (!el) return;
    if (revision !== engineRevision) return;
    const s = res?.ok ? res.status || { source: 'none' } : { source: 'none', message: 'AI status could not be verified.' };
    const chip = el.querySelector('.chip');
    chip.dataset.src = s.source;
    chip.querySelector('span').textContent = SOURCE[s.source] || s.source;
    chip.title = s.message || '';
    el.querySelector('.p-engine-note').textContent = s.message || (s.source === 'none' ? 'No inference source has been verified yet.' : '');
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !el) return;
    if (changes.settings) {
      getSettings().then(settings => { if (el) for (const input of el.querySelectorAll('[data-setting]')) input.checked = !!settings[input.dataset.setting]; }).catch(() => {});
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
