import { hasMeaningfulRewrite } from '../../engine/qualityPolicy.js';
// The Ingredients card: why a headline is bait, word by word, plus safe wording and plain-language assistance.
import { reducedMotion } from './page.js';
import { setHTML } from './html.js';
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
export function openCard(layer, rec, rect, { onDebait, onRestore, onAssist }) {
  if (current?.rec === rec) return closeCard();
  closeCard();

  const r = rec.result;
  const debaited = rec.state === 'debaited';
  const clean = r.kind === 'clean';
  let available = !clean && hasMeaningfulRewrite(rec.text, r.honest_rewrite);
  const el = document.createElement('div');
  el.className = 'card';
  // Functional containment for variable-length explanations; existing styling remains.
  el.style.maxHeight = 'calc(100vh - 24px)';
  el.style.overflowY = 'auto';
  el.dataset.kind = r.kind;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Debait ingredients');

  const rows = r.triggers.length
    ? r.triggers.map((t) => `<li><span class="w">${esc(t.word)}</span><span class="why">${esc(t.why)}</span></li>`).join('')
    : '<li class="none-row"><span class="none">No manipulative words found.</span></li>';

  const C = 2 * Math.PI * 30; // gauge circumference
  setHTML(el, `
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
    <p class="card-headline" aria-label="Original headline">${markTriggers(rec.text, r.triggers)}</p>
    <div class="card-section"><h4>Why it pulls you in</h4><ul class="ingredients">${rows}</ul></div>
    ${clean ? '' : `<div class="card-section"><h4>Suggested rewrite</h4><div class="honest">${available ? esc(r.honest_rewrite) : 'No safe alternative available'}</div><p data-rewrite-source>Wording suggestion only. Not a fact-check. Source: ${esc(SOURCE[rec.rewriteSource || r.source])}.</p></div>`}
    <div class="card-section">
      ${!clean && !debaited ? '<button class="btn" data-act="request-rewrite">Request neutral wording</button>' : ''}
      <button class="btn" data-act="explain">Explain Simply</button>
      <p data-assistance-status role="status" aria-live="polite"></p>
      <div data-explanation hidden></div>
    </div>
    <div class="card-foot">
      <span class="source" data-src="${esc(r.source)}" title="Classification source"><i></i>${esc(SOURCE[r.source] || r.source)}</span>
      <div class="btns">
        ${clean || (!available && !debaited) ? '<button class="btn" data-act="close">Close</button>' : debaited
          ? '<button class="btn" data-act="restore">Show original</button>'
          : `<button class="btn" data-act="close">Keep</button><button class="btn primary" data-act="debait">Apply rewrite ${ICON.arrow}</button>`}
      </div>
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

  // a gentle 3D tilt that follows the cursor
  el.addEventListener('pointermove', (e) => {
    if (reducedMotion()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 4).toFixed(2)}deg)`;
  });
  el.addEventListener('pointerleave', () => { el.style.transform = ''; });

  el.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'request-rewrite' || act === 'explain') {
      if (!onAssist || rec.assistPending) return;
      const buttons = [...el.querySelectorAll('[data-act="request-rewrite"], [data-act="explain"]')];
      buttons.forEach(button => { button.disabled = true; });
      const status = el.querySelector('[data-assistance-status]');
      status.textContent = act === 'explain' ? 'Explaining the headline…' : 'Requesting safe neutral wording…';
      try {
        const result = await onAssist(act === 'explain' ? 'explain' : 'rewrite');
        if (current?.el !== el) return;
        if (act === 'request-rewrite') {
          available = hasMeaningfulRewrite(rec.text, result.honest_rewrite);
          el.querySelector('.honest').textContent = available ? result.honest_rewrite : 'No safe alternative available';
          el.querySelector('[data-rewrite-source]').textContent = `Wording suggestion only. Not a fact-check. Source: ${SOURCE[result.source]}.`;
          status.textContent = `${available ? 'A proposed alternative is ready. Compare it with the original before applying.' : 'No safe alternative available. The original is unchanged.'} Source: ${SOURCE[result.source]}.`;
          let apply = el.querySelector('[data-act="debait"]');
          if (available && !apply) {
            apply = document.createElement('button'); apply.className = 'btn primary'; apply.dataset.act = 'debait'; apply.textContent = 'Apply rewrite';
            el.querySelector('.btns').append(apply);
          }
          if (!available) apply?.remove();
        } else {
          const content = el.querySelector('[data-explanation]'); content.replaceChildren(); content.hidden = false;
          const paragraph = text => { const p = document.createElement('p'); p.textContent = text; content.append(p); };
          paragraph(`Simple explanation: ${result.simple_explanation}`);
          for (const definition of result.definitions) paragraph(`General definition — ${definition.term}: ${definition.meaning}`);
          paragraph(`Missing context: ${result.missing_context}`);
          paragraph(`Headline wording only. Not a fact-check. Source: ${SOURCE[result.source]}.`);
          status.textContent = 'Explanation ready. The page headline has not been changed.';
        }
      } catch (error) {
        if (current?.el === el) status.textContent = `${error.message}${Number.isFinite(error.retryAt) ? ` Try again after ${new Date(error.retryAt).toLocaleTimeString()}.` : ''}`;
      } finally {
        buttons.forEach(button => { button.disabled = false; });
        if (current?.el === el) {
          const bounds = el.getBoundingClientRect();
          if (bounds.bottom > innerHeight - 12) el.style.top = `${Math.max(12, innerHeight - bounds.height - 12)}px`;
        }
      }
    }
    if ((act === 'debait' && available) || act === 'restore') {
      const button = e.target.closest('[data-act]'); button.disabled = true;
      const status = el.querySelector('[data-assistance-status]');
      status.textContent = act === 'restore' ? 'Restoring original wording…' : 'Applying the accepted rewrite…';
      try {
        const changed = await (act === 'restore' ? onRestore() : onDebait());
        if (changed) closeCard();
        else status.textContent = 'The headline changed or its markup cannot be safely edited. No text was replaced. Open its current tag and try again.';
      } catch { status.textContent = 'The page action could not complete. The original wording remains available.'; }
      finally { button.disabled = false; }
    }
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
