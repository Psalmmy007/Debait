// The Ingredients card: why a headline is bait, word by word, plus what actually happened.
import { SPRING, reducedMotion } from './page.js';

const LABEL = { rage: 'Rage', fear: 'Fear', envy: 'Envy', clean: 'Clean' };
const SOURCE = { 'on-device': 'Scored on-device', cloud: 'Scored in the cloud', mock: 'Mock engine' };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function markTriggers(text, triggers) {
  // wrap each trigger phrase in <mark>, working on the escaped string
  let html = esc(text);
  const words = [...triggers.map((t) => t.word)].sort((a, b) => b.length - a.length);
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
  el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.94) translateY(-4px)' }], {
    duration: 180,
    easing: 'ease-in',
  }).finished.then(() => el.remove());
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
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.kind = r.kind;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Debait ingredients');

  const rows = r.triggers.length
    ? r.triggers.map((t) => `<li><span class="w">${esc(t.word)}</span><span class="why">${esc(t.why)}</span></li>`).join('')
    : '<li><span class="none">No manipulative words found.</span></li>';

  el.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-kicker">Ingredients</div>
        <div class="card-kind"></div>
      </div>
      <div class="card-score"><b>${r.kind === 'clean' ? r.score : r.score}</b><span>bait score</span></div>
    </div>
    <p class="card-headline">${markTriggers(rec.text, r.triggers)}</p>
    <div class="card-section"><h4>Why it pulls you in</h4><ul class="ingredients">${rows}</ul></div>
    ${r.kind === 'clean' ? '' : `<div class="card-section"><h4>What actually happened</h4><div class="honest">${esc(r.honest_rewrite)}</div></div>`}
    <div class="card-foot">
      <span class="source" data-src="${esc(r.source)}"><i></i>${esc(SOURCE[r.source] || r.source)}</span>
      <div class="btns">
        ${r.kind === 'clean' ? '<button class="btn" data-act="close">Close</button>' : debaited
          ? '<button class="btn" data-act="restore">Show original</button>'
          : '<button class="btn" data-act="close">Keep</button><button class="btn primary" data-act="debait">Debait it</button>'}
      </div>
    </div>`;

  // reuse a tag-looking pill for the kind
  const pill = document.createElement('span');
  pill.className = 'tag';
  pill.dataset.kind = r.kind;
  pill.style.cursor = 'default';
  pill.innerHTML = `<span class="dot"></span><span class="label">${LABEL[r.kind]}</span>`;
  pill.style.paddingRight = '9px';
  el.querySelector('.card-kind').appendChild(pill);

  layer.appendChild(el);

  // position under the tag; flip above if there's no room
  const W = el.offsetWidth;
  const H = el.offsetHeight;
  let left = Math.min(Math.max(12, rect.left - 6), innerWidth - W - 12);
  let top = rect.bottom + 10;
  if (top + H > innerHeight - 12 && rect.top - H - 10 > 12) {
    top = rect.top - H - 10;
    el.classList.add('flip');
  }
  top = Math.max(12, Math.min(top, innerHeight - H - 12));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.transformOrigin = `${rect.left + rect.width / 2 - left}px ${el.classList.contains('flip') ? '100%' : '0'}`;

  if (!reducedMotion()) {
    el.animate(
      [{ opacity: 0, transform: 'scale(0.6)', filter: 'blur(6px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' }],
      { duration: 620, easing: SPRING },
    );
    const parts = el.querySelectorAll('.card-headline, .ingredients li, .honest, .card-foot');
    parts.forEach((p, i) => {
      p.animate(
        [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
        { duration: 520, delay: 80 + i * 55, easing: SPRING, fill: 'backwards' },
      );
    });
    const num = el.querySelector('.card-score b');
    countUp(num, r.score);
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

function countUp(el, to) {
  const start = performance.now();
  const dur = 700;
  const tick = (t) => {
    const p = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(to * eased));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
