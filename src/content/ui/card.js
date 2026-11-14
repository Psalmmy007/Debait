// The Ingredients card: why a headline is bait, word by word, plus what actually happened.
import { reducedMotion } from './page.js';
import { ICON, LABEL, SOURCE } from './icons.js';

const OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    [{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'translateY(-4px) scale(0.97)', filter: 'blur(4px)' }],
    { duration: 180, easing: 'ease-in' },
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
  el.setAttribute('aria-label', 'Debait ingredients');

  const rows = r.triggers.length
    ? r.triggers.map((t) => `<li><span class="w">${esc(t.word)}</span><span class="why">${esc(t.why)}</span></li>`).join('')
    : '<li class="none-row"><span class="none">No manipulative words found.</span></li>';

  const C = 2 * Math.PI * 30; // gauge circumference
  el.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-kicker">Ingredients</div>
        <div class="card-kind"><span class="tag" data-kind="${r.kind}"><span class="ico">${ICON[r.kind]}</span><span class="label">${LABEL[r.kind]}</span></span></div>
      </div>
      <div class="gauge" aria-label="Bait score ${r.score} out of 100">
        <svg viewBox="0 0 68 68"><circle class="track" cx="34" cy="34" r="30"/><circle class="fill" cx="34" cy="34" r="30" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
        <b><span class="num">${r.score}</span><small>score</small></b>
      </div>
    </div>
    <p class="card-headline">${markTriggers(rec.text, r.triggers)}</p>
    <div class="card-section"><h4>Why it pulls you in</h4><ul class="ingredients">${rows}</ul></div>
    ${clean ? '' : `<div class="card-section"><h4>What actually happened</h4><div class="honest">${esc(r.honest_rewrite)}</div></div>`}
    <div class="card-foot">
      <span class="source" data-src="${esc(r.source)}"><i></i>${esc(SOURCE[r.source] || r.source)}</span>
      <div class="btns">
        ${clean ? '<button class="btn" data-act="close">Close</button>' : debaited
          ? '<button class="btn" data-act="restore">Show original</button>'
          : `<button class="btn" data-act="close">Keep</button><button class="btn primary" data-act="debait">Debait it ${ICON.arrow}</button>`}
      </div>
    </div>`;

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

  const fill = el.querySelector('.gauge .fill');
  const num = el.querySelector('.gauge .num');
  const target = C * (1 - r.score / 100);
  if (reducedMotion()) {
    fill.style.strokeDashoffset = String(target);
  } else {
    // rises from the tag in 3D, then the details settle in one by one
    el.animate(
      [
        { opacity: 0, transform: 'perspective(900px) rotateX(-14deg) translateY(-6px) scale(0.94)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'perspective(900px) rotateX(0) translateY(0) scale(1)', filter: 'blur(0)' },
      ],
      { duration: 520, easing: OUT },
    );
    el.querySelectorAll('.card-headline, .card-section h4, .ingredients li, .honest, .card-foot').forEach((p, i) => {
      p.animate(
        [{ opacity: 0, transform: 'translateY(6px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
        { duration: 460, delay: 70 + i * 40, easing: OUT, fill: 'backwards' },
      );
    });
    fill.animate([{ strokeDashoffset: C }, { strokeDashoffset: target }], { duration: 900, delay: 120, easing: OUT, fill: 'forwards' });
    countUp(num, r.score, 900, 120);
  }

  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'debait') { closeCard(); onDebait(); }
    if (act === 'restore') { closeCard(); onRestore(); }
    if (act === 'close') closeCard();
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
