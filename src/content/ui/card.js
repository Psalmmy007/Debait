// The Ingredients card: a nutrition label for one headline. Why it is bait, word by word,
// what actually happened, and one action.
import { reducedMotion } from './page.js';
import { setHTML } from './html.js';
import { ICON, SOURCE } from './icons.js';
import { shareHeadline } from './share.js';

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KIND = { rage: 'Rage bait', fear: 'Fear bait', envy: 'Envy bait', clean: 'Clean' };
const WHY = {
  rage: 'Written to make you angry',
  fear: 'Written to make you afraid',
  envy: 'Written to make you feel left behind',
  clean: 'Plain and factual',
};

function markTriggers(text, triggers) {
  let html = esc(text);
  const words = triggers.map((t) => t.word).sort((a, b) => b.length - a.length);
  for (const w of words) {
    const re = new RegExp(esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    html = html.replace(re, (m) => `<mark>${m}</mark>`);
  }
  return html;
}

let current = null;

export function closeCard() {
  if (!current) return;
  const { el, cleanup } = current;
  current = null;
  cleanup();
  if (reducedMotion()) return el.remove();
  el.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-3px) scale(0.98)' }],
    { duration: 140, easing: 'ease-in' },
  ).finished.then(() => el.remove());
}

/**
 * @param layer  overlay card layer (inside shadow root)
 * @param rec    headline record {text, result, state}
 * @param rect   bounding rect of the tag that was clicked
 */
export function openCard(layer, rec, rect, { onDebait, onRestore }) {
  if (current?.rec === rec) return closeCard();
  closeCard();

  const r = rec.result;
  const debaited = rec.state === 'debaited';
  const clean = r.kind === 'clean';
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.kind = r.kind;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Ingredients: ${KIND[r.kind]}, bait score ${r.score} out of 100`);

  const rows = r.triggers.length
    ? r.triggers.map((t) => `<li><b>${esc(t.word)}</b><span>${esc(t.why)}</span></li>`).join('')
    : '<li><span class="none">No manipulative words. It sticks to the facts.</span></li>';

  setHTML(el, `
    <header class="c-head">
      <span class="micro">Ingredients</span>
      <span class="c-src" data-src="${esc(r.source)}"><i></i>${esc(SOURCE[r.source] || r.source)}</span>
    </header>
    <div class="rule thick"></div>
    <div class="c-verdict">
      <div><div class="c-kind"><i></i>${KIND[r.kind]}</div><span class="c-sub">${WHY[r.kind]}</span></div>
      <div class="c-score" aria-hidden="true"><span class="num">${r.score}</span><small>/100</small></div>
    </div>
    <div class="c-meter" aria-hidden="true"><s></s></div>
    <p class="c-headline">${markTriggers(rec.text, r.triggers)}</p>
    <section class="c-sec"><h4 class="micro">${clean ? 'Hooks' : 'Why it hooks you'}</h4><ul class="c-list">${rows}</ul></section>
    ${clean ? '' : `<section class="c-sec">
      <h4 class="micro">Bait vs honest<span>Drag to compare</span></h4>
      <div class="compare" style="--cut: 100%">
        <div class="cmp honest"><span class="cmp-tag">Honest</span>${esc(r.honest_rewrite)}</div>
        <div class="cmp bait" aria-hidden="true"><span class="cmp-tag">Bait</span>${esc(rec.text)}</div>
        <span class="cmp-handle" aria-hidden="true"></span>
        <input type="range" min="0" max="100" value="100" aria-label="Slide between the bait and the honest headline" />
      </div>
    </section>
    <footer class="c-foot">
      <button class="btn ghost" data-act="share">${ICON.share}<span>Share</span></button>
      ${debaited
        ? '<button class="btn" data-act="restore">Show original</button>'
        : `<button class="btn primary" data-act="debait">Debait it ${ICON.arrow}</button>`}
    </footer>`}`);

  layer.appendChild(el);

  // position under the tag; flip above if there's no room
  const W = el.offsetWidth;
  const H = el.offsetHeight;
  const left = Math.min(Math.max(12, rect.left - 6), innerWidth - W - 12);
  let top = rect.bottom + 10;
  if (top + H > innerHeight - 12 && rect.top - H - 10 > 12) {
    top = rect.top - H - 10;
    el.classList.add('flip');
  }
  top = Math.max(12, Math.min(top, innerHeight - H - 12));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.transformOrigin = `${rect.left + rect.width / 2 - left}px ${el.classList.contains('flip') ? '100%' : '0'}`;

  const meter = el.querySelector('.c-meter s');
  const num = el.querySelector('.c-score .num');
  if (reducedMotion()) {
    meter.style.width = `${r.score}%`;
  } else {
    el.animate(
      [{ opacity: 0, transform: 'translateY(-4px) scale(0.98)' }, { opacity: 1, transform: 'none' }],
      { duration: 220, easing: OUT },
    );
    meter.animate([{ width: '0%' }, { width: `${r.score}%` }], { duration: 800, delay: 80, easing: OUT, fill: 'forwards' });
    countUp(num, r.score, 800, 80);
  }

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'debait') { closeCard(); onDebait(); }
    if (act === 'restore') { closeCard(); onRestore(); }
    if (act === 'share') {
      const btn = e.target.closest('[data-act="share"]');
      const label = btn.querySelector('span');
      label.textContent = 'Making image…';
      shareHeadline({ bait: rec.text, honest: r.honest_rewrite, kind: r.kind, score: r.score })
        .then((how) => { label.textContent = how === 'copied' ? 'Image copied' : 'Image saved'; })
        .catch(() => { label.textContent = 'Could not share'; });
    }
  });

  // bait vs honest: drag to wipe between them; on open it sweeps once to show it moves
  const cmp = el.querySelector('.compare');
  if (cmp) {
    const range = cmp.querySelector('input');
    const set = (v) => { cmp.style.setProperty('--cut', `${v}%`); range.value = v; };
    range.addEventListener('input', () => set(range.value));
    range.addEventListener('pointerdown', (e) => e.stopPropagation());
    if (!reducedMotion()) {
      const t0 = performance.now() + 450;
      const tick = (t) => {
        if (!cmp.isConnected || range.matches(':active')) return;
        const p = Math.min(1, Math.max(0, (t - t0) / 1100));
        set(Math.round(100 - 55 * (1 - (1 - p) ** 3)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } else set(45);
  }

  const onDown = (e) => {
    const path = e.composedPath();
    if (path.includes(el) || path.some((n) => n.tagName === 'DEBAIT-TAG')) return; // tag clicks toggle it themselves
    closeCard();
  };
  const onKey = (e) => { if (e.key === 'Escape') closeCard(); };
  const onScroll = () => closeCard();
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    addEventListener('scroll', onScroll, { passive: true, once: true });
  }, 0);

  current = {
    el,
    rec,
    cleanup() {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      removeEventListener('scroll', onScroll);
    },
  };
}

function countUp(el, to, dur, delay) {
  const start = performance.now() + delay;
  el.textContent = '0';
  const tick = (t) => {
    const p = Math.max(0, Math.min(1, (t - start) / dur));
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 4))));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
