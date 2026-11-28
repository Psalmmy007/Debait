import { canRewriteRecord, hasMeaningfulRewrite, normalizeRewriteText } from '../../engine/qualityPolicy.js';
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
    @font-face { font-family: 'Debait Sans'; src: url('${url('jakarta.woff2')}') format('woff2'); font-weight: 200 800; font-display: swap; }
    @font-face { font-family: 'Debait Inter'; src: url('${url('inter.woff2')}') format('woff2'); font-weight: 100 900; font-display: swap; }
    @font-face { font-family: 'Debait Bricolage'; src: url('${url('bricolage.woff2')}') format('woff2'); font-weight: 200 800; font-display: swap; }
    @font-face { font-family: 'Debait Newsreader'; src: url('${url('newsreader.woff2')}') format('woff2'); font-weight: 200 800; font-display: swap; }
    ::highlight(debait-bait) { background-color: rgba(128, 128, 128, 0.2); color: inherit; text-decoration: underline 2px; text-decoration-color: currentColor; }
    ::highlight(debait-hot) { background-color: rgba(128, 128, 128, 0.42); color: inherit; text-decoration: underline 2px; text-decoration-color: currentColor; }
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

// ---------- the swap: the old headline decodes into the new one ----------

const GLYPHS = '░▒▓/\\|=+-_*#<>';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function decode(el, from, to, delay, write) {
  return new Promise((resolve) => {
    const node = write ? null : document.createTextNode(from);
    const go = () => {
      if (write) write(from); else el.replaceChildren(node);
      const len = Math.max(from.length, to.length);
      const dur = Math.min(1150, 520 + len * 7);
      // each character resolves at its own moment, roughly left to right
      const at = Array.from({ length: len }, (_, i) => Math.min(0.97, (i / len) * 0.72 + Math.random() * 0.22));
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / dur);
        let out = '';
        for (let i = 0; i < len; i++) {
          if (p >= at[i]) out += to[i] ?? '';
          else if (p >= at[i] - 0.3) out += (to[i] === ' ' || from[i] === ' ') ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
          else out += from[i] ?? '';
        }
        if (write) write(out); else node.data = out;
        if (p < 1) requestAnimationFrame(tick);
        else { if (write) write(to); else node.data = to; resolve(); }
      };
      requestAnimationFrame(tick);
    };
    if (delay > 0) wait(delay).then(go);
    else go();
  });
}

function headlineNodes(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = []; let node;
  while ((node = walker.nextNode())) if (!node.parentElement?.closest('debait-tag, debait-root')) nodes.push(node);
  return nodes;
}
const attached = (el, entries) => entries.every(({ node }) => el.contains(node));
export async function swapToRewrite(rec, { delay = 0, canApply = () => true } = {}) {
  if (!canRewriteRecord(rec) || !canApply()) return false;
  if (!hasMeaningfulRewrite(rec.el.innerText || rec.el.textContent || '', rec.result.honest_rewrite)) return false;
  const entries = headlineNodes(rec.el).map(node => ({ node, text: node.data }));
  if (!entries.length) return false;
  const from = entries.map(e => e.text).join('');
  const target = rec.result.honest_rewrite.trim();
  // Preserve DOM element, link, attribute, and event-listener identity by editing text nodes in place.
  const prefix = from.match(/^\s*(?:You\s+won['’]t\s+believe\s+this|You\s+will\s+not\s+believe\s+this|Click\s+to\s+find\s+out):\s+/i);
  let after;
  let primaryIdx = entries.findIndex(e => e.text.trim().length > 0);
  if (primaryIdx < 0) primaryIdx = 0;
  if (prefix && normalizeRewriteText(from.slice(prefix[0].length)) === normalizeRewriteText(target)) {
    let remaining = prefix[0].length;
    after = entries.map(({ text }) => { const removed = Math.min(remaining, text.length); remaining -= removed; return text.slice(removed); });
  } else {
    after = entries.map((_, i) => (i === primaryIdx ? target : ''));
  }
  let interrupted = false;
  let previous = entries.map(e => e.node.data);
  const write = value => {
    if (entries.some((e, i) => e.node.data !== previous[i])) {
      entries.forEach((entry, i) => { if (entry.node.data === previous[i]) entry.node.data = entry.text; });
      interrupted = true;
    }
    if (interrupted) return;
    entries.forEach(({ node }, i) => { node.data = i === primaryIdx ? value : ''; });
    previous = entries.map(e => e.node.data);
  };
  rec.animating = true;
  try {
    if (!reducedMotion()) await decode(rec.el, from, after.join(''), delay, write);
    if (interrupted) return false;
    if (!canApply() || !attached(rec.el, entries)) {
      if (attached(rec.el, entries)) entries.forEach(({ node, text }) => { node.data = text; });
      return false;
    }
    entries.forEach(({ node }, i) => { node.data = after[i]; });
    rec.original = entries;
    rec.rewrittenText = (rec.el.innerText || rec.el.textContent || after.join('')).replace(/\s+/g, ' ').trim();
    rec.state = 'debaited';
    return true;
  } finally { rec.animating = false; }
}
export async function swapToOriginal(rec, { delay = 0 } = {}) {
  if (rec.state !== 'debaited' || !rec.original || rec.animating) return false;
  const entries = rec.original;
  if (!attached(rec.el, entries) || normalizeRewriteText(entries.map(e => e.node.data).join('')) !== normalizeRewriteText(rec.rewrittenText)) return false;
  rec.animating = true;
  try {
    // Preserve markup and URL/event-handler identity during restore too.
    const beforeRestore = entries.map(e => e.node.data);
    let interrupted = false, previous = [...beforeRestore];
    const write = value => {
      if (entries.some((e, i) => e.node.data !== previous[i])) {
        entries.forEach((entry, i) => { if (entry.node.data === previous[i]) entry.node.data = beforeRestore[i]; });
        interrupted = true;
      }
      if (interrupted) return;
      entries.forEach(({ node }, i) => { node.data = i === 0 ? value : ''; });
      previous = entries.map(e => e.node.data);
    };
    if (!reducedMotion()) await decode(rec.el, rec.rewrittenText, rec.text, delay, write);
    if (interrupted || !attached(rec.el, entries)) return false;
    entries.forEach(({ node, text }) => { node.data = text; });
    rec.state = 'scored'; rec.original = null; rec.rewrittenText = null;
    return true;
  } finally { rec.animating = false; }
}
