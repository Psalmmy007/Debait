// A Rage / Fear / Envy / Clean label placed right after a headline.
import tokens from '../styles/tokens.css?inline';
import tagCss from '../styles/tag.css?inline';
import { SPRING, reducedMotion } from './page.js';
import { ICON, LABEL, SOURCE } from './icons.js';
import { setHTML, adoptCss } from './html.js';

/** Is this headline on a dark background? (Light text = dark page.) */
function isDarkTone(el) {
  const m = getComputedStyle(el).color.match(/\d+(\.\d+)?/g);
  if (!m) return false;
  const [r, g, b] = m.map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

export function createTag(anchor, { onClick }) {
  const host = document.createElement('debait-tag');
  host.style.cssText =
    'all: initial !important; display: inline-block !important; margin: 4px 0 4px 8px !important; vertical-align: middle !important; line-height: 0 !important;';
  const shadow = host.attachShadow({ mode: 'open' });
  adoptCss(shadow, tokens + tagCss);
  setHTML(shadow, `<button class="tag pending" type="button"><span class="ico">${ICON.dots}</span><span class="label">Reading</span><span class="score"></span></button>`);
  anchor.insertAdjacentElement('afterend', host);

  const btn = shadow.querySelector('.tag');
  const ico = shadow.querySelector('.ico');
  const label = shadow.querySelector('.label');
  const score = shadow.querySelector('.score');
  if (isDarkTone(anchor)) btn.dataset.tone = 'dark';

  // Tags often sit inside links: don't let our clicks open the article.
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(btn.getBoundingClientRect());
  });
  for (const t of ['pointerdown', 'mousedown', 'mouseup']) btn.addEventListener(t, (e) => e.stopPropagation());

  if (!reducedMotion()) {
    btn.animate(
      [{ transform: 'translateY(3px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 280, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  }

  /** Changes the keycap's content and smoothly morphs its width. flip = turn it over like a card. */
  function morph(apply, { flip = false } = {}) {
    const w0 = btn.getBoundingClientRect().width;
    if (flip && !reducedMotion()) {
      // first half of the flip, then swap the face, then the second half
      btn.animate([{ transform: 'perspective(200px) rotateX(0deg)' }, { transform: 'perspective(200px) rotateX(90deg)' }], { duration: 140, easing: 'ease-in' })
        .finished.then(() => {
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
    const w1 = btn.getBoundingClientRect().width;
    if (reducedMotion() || !w0 || Math.abs(w1 - w0) < 1) return;
    btn.animate([{ width: `${w0}px` }, { width: `${w1}px` }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
  }

  return {
    host,
    setResult(result) {
      morph(() => {
        btn.classList.remove('pending', 'debaited');
        btn.dataset.kind = result.kind;
        setHTML(ico, result.kind === 'clean' ? ICON.check : ''); // bait kinds show a colour swatch (CSS)
        label.textContent = LABEL[result.kind];
        score.textContent = result.kind === 'clean' ? '' : String(result.score);
        btn.title = `${LABEL[result.kind]}${result.kind === 'clean' ? '' : `, bait score ${result.score}`}. ${SOURCE[result.source] || ''}. Click for ingredients.`;
        btn.setAttribute('aria-label', btn.title);
      });
    },
    setDebaited(on, result) {
      morph(() => {
        btn.classList.toggle('debaited', on);
        setHTML(ico, on || result.kind === 'clean' ? ICON.check : '');
        label.textContent = on ? 'Debaited' : LABEL[result.kind];
      }, { flip: true });
    },
    setVisible(v) {
      host.style.setProperty('display', v ? 'inline-block' : 'none', 'important');
    },
    remove() { host.remove(); },
  };
}
