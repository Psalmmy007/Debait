// Everything that touches the host page's own text:
// fonts, word highlights, and swapping headlines for their honest rewrite.

export const SPRING =
  'linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1.004 83.8%, 1)';
export const SOFT =
  'linear(0, 0.06 3.1%, 0.236 6.6%, 0.484 10.6%, 0.75 15.6%, 0.918 20.4%, 1.012 25.2%, 1.052 30.4%, 1.056 34.6%, 1.039 41.2%, 1.011 51.6%, 0.997 64.6%, 1)';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Fonts must be declared on the page itself (not inside the shadow root) to be usable there.
 * The ::highlight() rules also have to live on the page, because they style the page's own text.
 * Font names are prefixed "Debait" so they never clash with the site's fonts.
 */
export function injectPageStyles() {
  if (document.getElementById('debait-page-styles')) return;
  const url = (f) => chrome.runtime.getURL(`fonts/${f}`);
  const style = document.createElement('style');
  style.id = 'debait-page-styles';
  style.textContent = `
    @font-face { font-family: 'Debait Inter'; src: url('${url('inter.woff2')}') format('woff2'); font-weight: 100 900; font-display: swap; }
    @font-face { font-family: 'Debait Bricolage'; src: url('${url('bricolage.woff2')}') format('woff2'); font-weight: 200 800; font-display: swap; }
    @font-face { font-family: 'Debait Newsreader'; src: url('${url('newsreader.woff2')}') format('woff2'); font-weight: 200 800; font-display: swap; }
    ::highlight(debait-bait) { background-color: rgba(255, 181, 165, 0.78); color: inherit; }
    ::highlight(debait-hot) { background-color: #ff9d86; color: inherit; }
  `;
  (document.head || document.documentElement).appendChild(style);
}

// ---------- highlights (CSS Custom Highlight API: no DOM changes) ----------

function textIndex(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let full = '';
  let n;
  while ((n = walker.nextNode())) {
    if (n.parentElement?.closest('debait-tag')) continue;
    nodes.push({ node: n, start: full.length });
    full += n.data;
  }
  return { nodes, full };
}

function locate(nodes, i) {
  for (let k = nodes.length - 1; k >= 0; k--) {
    if (nodes[k].start <= i) return { node: nodes[k].node, offset: i - nodes[k].start };
  }
  return null;
}

export function rangesFor(el, words) {
  const { nodes, full } = textIndex(el);
  const lower = full.toLowerCase();
  const out = [];
  for (const word of words) {
    const w = word.toLowerCase();
    const i = lower.indexOf(w);
    if (i === -1) continue;
    const a = locate(nodes, i);
    const b = locate(nodes, i + w.length);
    if (!a || !b) continue;
    try {
      const r = new Range();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, Math.min(b.offset, b.node.length));
      out.push(r);
    } catch { /* text changed under us */ }
  }
  return out;
}

/** Repaints all bait-word highlights. `records` = iterable of scored records. */
export function paintHighlights(records, { enabled, hotRecord } = {}) {
  if (!('highlights' in CSS)) return;
  const bait = new Highlight();
  const hot = new Highlight();
  if (enabled) {
    for (const rec of records) {
      if (rec.state !== 'scored' || !rec.result || rec.result.kind === 'clean') continue;
      const ranges = rangesFor(rec.el, rec.result.triggers.map((t) => t.word));
      for (const r of ranges) (rec === hotRecord ? hot : bait).add(r);
    }
  }
  CSS.highlights.set('debait-bait', bait);
  CSS.highlights.set('debait-hot', hot);
}

// ---------- the swap ----------

const OUT = [
  { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0)' },
  { opacity: 0, filter: 'blur(6px)', transform: 'translateY(-5px)' },
];
const IN = [
  { opacity: 0, filter: 'blur(7px)', transform: 'translateY(9px)', textShadow: '0 0 14px rgba(47,91,255,0.75)' },
  { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0)', textShadow: '0 0 0 rgba(47,91,255,0)' },
];

async function morphText(el, replace, { delay = 0 } = {}) {
  if (reducedMotion()) {
    replace();
    return;
  }
  await el.animate(OUT, { duration: 240, delay, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).finished.catch(() => {});
  replace();
  el.getAnimations().forEach((a) => a.cancel());
  await el.animate(IN, { duration: 760, easing: SPRING }).finished.catch(() => {});
}

export function swapToRewrite(rec, opts) {
  if (rec.state !== 'scored') return Promise.resolve();
  rec.original = [...rec.el.childNodes].map((n) => n.cloneNode(true));
  rec.state = 'debaited';
  return morphText(rec.el, () => {
    rec.el.replaceChildren(document.createTextNode(rec.result.honest_rewrite));
  }, opts);
}

export function swapToOriginal(rec, opts) {
  if (rec.state !== 'debaited' || !rec.original) return Promise.resolve();
  rec.state = 'scored';
  return morphText(rec.el, () => {
    rec.el.replaceChildren(...rec.original.map((n) => n.cloneNode(true)));
  }, opts);
}
