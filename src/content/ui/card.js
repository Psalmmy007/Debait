// The Ingredients card: why a headline is bait, word by word, what actually happened, and one action.
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
  envy: 'Written to make you feel behind',
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
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }],
    { duration: 150, easing: 'ease-in' },
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
  const isMock = r.source === 'mock';
  const canRewrite = !clean && !isMock && r.rewrite_safe !== false && !!r.honest_rewrite?.trim();
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.kind = r.kind;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `${KIND[r.kind]}, bait score ${r.score} out of 100`);

  const rows = r.triggers.length
    ? r.triggers.map((t) => `<div class="c-row"><b>${esc(t.word)}</b><span>${esc(t.why)}</span></div>`).join('')
    : '<div class="c-row"><span class="none">No manipulative words. It sticks to the facts.</span></div>';

  const C = 2 * Math.PI * 19.5; // ring circumference
  setHTML(el, `
    <div class="c-top">
      <span class="c-icon">${ICON[r.kind]}</span>
      <div class="c-title"><b>${KIND[r.kind]}</b><span>${WHY[r.kind]} · Wording check, not a fact-check</span></div>
      <div class="c-ring" aria-hidden="true">
        <svg viewBox="0 0 48 48"><circle class="t" cx="24" cy="24" r="19.5"/><circle class="f" cx="24" cy="24" r="19.5" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
        <b class="num">${r.score}</b>
      </div>
    </div>
    <p class="c-head">${markTriggers(rec.text, r.triggers)}</p>
    <div class="c-sec"><h4 class="h">${clean ? 'Hooks' : 'Why it hooks you'}</h4><div class="group">${rows}</div></div>
    ${clean ? '' : `<div class="c-sec">
      <div class="seg" role="tablist" aria-label="Compare wording">
        <button role="tab" aria-selected="true" data-v="honest">Honest</button>
        <button role="tab" aria-selected="false" data-v="bait">Bait</button>
      </div>
      <p class="c-alt" aria-live="polite">${esc(canRewrite ? r.honest_rewrite : 'No verified neutral rewrite available')}</p>
    </div>`}
    <div class="c-foot">
      <span class="c-src" data-src="${esc(r.source)}"><i></i>${esc(SOURCE[r.source] || r.source)}</span>
      ${canRewrite ? `<div class="c-btns">
        <button class="btn round" data-act="share" aria-label="Share as an image" title="Share as an image">${ICON.share}</button>
        ${debaited
          ? '<button class="btn" data-act="restore">Show original</button>'
          : '<button class="btn primary" data-act="debait">Debait it</button>'}
      </div>` : ''}
    </div>`);

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

  const fill = el.querySelector('.c-ring .f');
  const num = el.querySelector('.c-ring .num');
  const target = C * (1 - r.score / 100);
  if (reducedMotion()) {
    fill.style.strokeDashoffset = String(target);
  } else {
    el.animate(
      [{ opacity: 0, transform: 'scale(0.94)' }, { opacity: 1, transform: 'none' }],
      { duration: 280, easing: OUT },
    );
    fill.animate([{ strokeDashoffset: C }, { strokeDashoffset: target }], { duration: 900, delay: 80, easing: OUT, fill: 'forwards' });
    countUp(num, r.score, 900, 80);
  }

  el.addEventListener('click', (e) => {
    const tab = e.target.closest('.seg button');
    if (tab) {
      const bait = tab.dataset.v === 'bait';
      el.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
      const alt = el.querySelector('.c-alt');
      alt.textContent = bait ? rec.text : r.honest_rewrite;
      alt.classList.toggle('bait', bait);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'debait') { closeCard(); onDebait(); }
    if (act === 'restore') { closeCard(); onRestore(); }
    if (act === 'share') {
      const btn = e.target.closest('[data-act="share"]');
      btn.disabled = true;
      shareHeadline({ bait: rec.text, honest: r.honest_rewrite, kind: r.kind, score: r.score })
        .then((how) => { btn.title = how === 'copied' ? 'Image copied' : 'Image saved'; setHTML(btn, ICON.check); })
        .catch(() => { btn.title = 'Could not share'; })
        .finally(() => { btn.disabled = false; });
    }
  });

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
