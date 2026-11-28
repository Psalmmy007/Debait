// A Rage / Fear / Envy / Clean capsule placed right after a headline.
import tokens from '../styles/tokens.css?inline';
import tagCss from '../styles/tag.css?inline';
import { SPRING, reducedMotion } from './page.js';
import { ICON, LABEL, SOURCE } from './icons.js';
import { setHTML, adoptCss } from './html.js';

const anchorTags = new WeakMap();

/** Removes any orphaned <debait-tag> nodes left in the DOM from an older extension instance. */
export function cleanupOrphanedTags(root = document) {
  if (!root?.querySelectorAll) return 0;
  const stale = [...root.querySelectorAll('debait-tag')];
  for (const node of stale) node.remove();
  return stale.length;
}

/** Removes any stray adjacent <debait-tag> siblings immediately after `anchor` other than `keep`. */
function pruneAdjacentTags(anchor, keep = null) {
  let sib = anchor?.nextElementSibling;
  while (sib && sib.tagName === 'DEBAIT-TAG') {
    const next = sib.nextElementSibling;
    if (sib !== keep) sib.remove();
    sib = next;
  }
}

/** Is this headline on a dark background? (Light text = dark page.) */
function isDarkTone(el) {
  if (typeof getComputedStyle !== 'function') return false;
  const m = getComputedStyle(el).color.match(/\d+(\.\d+)?/g);
  if (!m) return false;
  const [r, g, b] = m.map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

/** True when an ancestor chain applies an odd number of vertical flips (e.g. Google's scaleY(-1) wrapper). */
function hasVerticalFlip(el) {
  if (typeof getComputedStyle !== 'function' || typeof DOMMatrix !== 'function') return false;
  let flipped = false;
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const t = getComputedStyle(p).transform;
    if (!t || t === 'none') continue;
    try {
      if (new DOMMatrix(t).d < 0) flipped = !flipped;
    } catch { /* ignore unsupported transform */ }
  }
  return flipped;
}

export function createTag(anchor, { onClick }) {
  const existing = anchorTags.get(anchor);
  if (existing && existing.host?.isConnected) {
    pruneAdjacentTags(anchor, existing.host);
    existing._setOnClick(onClick);
    existing.resetPending();
    return existing;
  }

  // Purge any orphaned/stale tags directly adjacent to this anchor before inserting one.
  pruneAdjacentTags(anchor, null);

  const host = document.createElement('debait-tag');
  host.style.cssText =
    'all: initial !important; display: inline-block !important; margin: 4px 0 4px 8px !important; vertical-align: middle !important; line-height: 0 !important;';
  const shadow = host.attachShadow({ mode: 'open' });
  adoptCss(shadow, tokens + tagCss);
  setHTML(shadow, `<button class="tag pending" type="button"><span class="ico">${ICON.dots}</span><span class="label">Reading</span><span class="score"></span></button>`);
  anchor.insertAdjacentElement('afterend', host);
  if (hasVerticalFlip(host)) host.style.setProperty('transform', 'scaleY(-1)', 'important');

  const btn = shadow.querySelector('.tag');
  const ico = shadow.querySelector('.ico');
  const label = shadow.querySelector('.label');
  const score = shadow.querySelector('.score');
  if (isDarkTone(anchor)) btn.dataset.tone = 'dark';

  let clickHandler = onClick;
  // Tags often sit inside links: don't let our clicks open the article.
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clickHandler?.(btn.getBoundingClientRect());
  });
  for (const t of ['pointerdown', 'mousedown', 'mouseup']) btn.addEventListener(t, (e) => e.stopPropagation());

  if (!reducedMotion() && typeof btn.animate === 'function') {
    btn.animate(
      [{ transform: 'scale(0.85)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 360, easing: SPRING },
    );
  }

  /** Changes the keycap's content and smoothly morphs its width. flip = turn it over like a card. */
  function morph(apply, { flip = false } = {}) {
    const w0 = btn.getBoundingClientRect?.().width || 0;
    if (flip && !reducedMotion() && typeof btn.animate === 'function') {
      // first half of the flip, then swap the face, then the second half
      btn.animate([{ transform: 'perspective(200px) rotateX(0deg)' }, { transform: 'perspective(200px) rotateX(90deg)' }], { duration: 140, easing: 'ease-in' })
        .finished.catch(() => {}).then(() => {
          apply();
          btn.animate([{ transform: 'perspective(200px) rotateX(-90deg)' }, { transform: 'perspective(200px) rotateX(0deg)' }], { duration: 420, easing: SPRING });
          widen(w0);
        });
      return;
    }
    apply();
    widen(w0);
  }
  function widen(w0) {
    const w1 = btn.getBoundingClientRect?.().width || 0;
    if (reducedMotion() || !w0 || Math.abs(w1 - w0) < 1 || typeof btn.animate !== 'function') return;
    btn.animate([{ width: `${w0}px` }, { width: `${w1}px` }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }

  const handle = {
    host,
    _setOnClick(fn) { clickHandler = fn; },
    resetPending() {
      btn.classList.add('pending');
      btn.classList.remove('debaited');
      delete btn.dataset.kind;
      setHTML(ico, ICON.dots);
      label.textContent = 'Reading';
      score.textContent = '';
      btn.title = '';
      btn.removeAttribute('aria-label');
    },
    setResult(result) {
      morph(() => {
        btn.classList.remove('pending', 'debaited');
        btn.dataset.kind = result.kind;
        setHTML(ico, ICON[result.kind]);
        label.textContent = LABEL[result.kind];
        score.textContent = result.kind === 'clean' ? '' : String(result.score);
        btn.title = `${LABEL[result.kind]}${result.kind === 'clean' ? '' : `, bait score ${result.score}`}. ${SOURCE[result.source] || ''}. Click for ingredients.`;
        btn.setAttribute('aria-label', btn.title);
      });
    },
    setDebaited(on, result) {
      morph(() => {
        btn.classList.toggle('debaited', on);
        setHTML(ico, on ? ICON.check : ICON[result.kind]);
        label.textContent = on ? 'Debaited' : LABEL[result.kind];
      }, { flip: true });
    },
    setVisible(v) {
      host.style.setProperty('display', v ? 'inline-block' : 'none', 'important');
    },
    remove() {
      if (anchorTags.get(anchor) === handle) anchorTags.delete(anchor);
      host.remove();
    },
  };

  anchorTags.set(anchor, handle);
  return handle;
}
