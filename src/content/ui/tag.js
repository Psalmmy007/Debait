// A Rage / Fear / Envy / Clean pill placed right after a headline.
import css from '../styles/ui.css?inline';
import { SPRING, reducedMotion } from './page.js';

const LABEL = { rage: 'Rage', fear: 'Fear', envy: 'Envy', clean: 'Clean' };
const SOURCE = { 'on-device': 'On-device', cloud: 'Cloud', mock: 'Mock' };

export function createTag(anchor, { onClick }) {
  const host = document.createElement('debait-tag');
  host.style.cssText =
    'all: initial !important; display: inline-block !important; margin: 4px 0 4px 8px !important; vertical-align: middle !important; line-height: 0 !important;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${css}</style><button class="tag pending" type="button"><span class="dot"></span><span class="label">Reading</span><span class="score"></span></button>`;
  anchor.insertAdjacentElement('afterend', host);

  const btn = shadow.querySelector('.tag');
  const label = shadow.querySelector('.label');
  const score = shadow.querySelector('.score');

  // Tags often sit inside links: don't let our clicks open the article.
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(btn.getBoundingClientRect());
  });
  for (const t of ['pointerdown', 'mousedown', 'mouseup']) btn.addEventListener(t, (e) => e.stopPropagation());

  if (!reducedMotion()) {
    btn.animate(
      [{ transform: 'scale(0.4)', opacity: 0, filter: 'blur(4px)' }, { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }],
      { duration: 600, easing: SPRING },
    );
  }

  /** Changes the pill's content and smoothly morphs its width/color. */
  function morph(apply, { pop = true } = {}) {
    const w0 = btn.getBoundingClientRect().width;
    apply();
    const w1 = btn.getBoundingClientRect().width;
    if (reducedMotion() || !w0) return;
    btn.animate([{ width: `${w0}px` }, { width: `${w1}px` }], { duration: 650, easing: SPRING });
    if (pop) {
      btn.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.14, 0.9)', offset: 0.3 }, { transform: 'scale(0.96, 1.04)', offset: 0.6 }, { transform: 'scale(1)' }],
        { duration: 620, easing: 'ease-out', composite: 'add' },
      );
    }
  }

  return {
    host,
    setResult(result) {
      morph(() => {
        btn.classList.remove('pending', 'debaited');
        btn.dataset.kind = result.kind;
        label.textContent = LABEL[result.kind];
        score.textContent = result.kind === 'clean' ? '' : String(result.score);
        btn.title = `${LABEL[result.kind]}${result.kind === 'clean' ? '' : ` · bait score ${result.score}`} · ${SOURCE[result.source] || ''} · click for ingredients`;
        btn.setAttribute('aria-label', btn.title);
      }, { pop: false });
    },
    setDebaited(on, result) {
      morph(() => {
        btn.classList.toggle('debaited', on);
        label.textContent = on ? 'Debaited' : LABEL[result.kind];
      });
    },
    setVisible(v) {
      host.style.setProperty('display', v ? 'inline-block' : 'none', 'important');
    },
    remove() { host.remove(); },
  };
}
