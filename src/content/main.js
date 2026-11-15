// Debait content script: finds headlines, gets them scored, and runs the on-page UI.
import { MSG } from '../engine/contract.js';
import { getSettings, onSettingsChange } from '../shared/storage.js';
import { getAdapter, textOf } from './sites/index.js';
import { injectPageStyles, paintHighlights, swapToRewrite, swapToOriginal } from './ui/page.js';
import { createOverlay, createOrb, playRipple } from './ui/overlay.js';
import { createTag } from './ui/tag.js';
import { openCard, closeCard } from './ui/card.js';
import { createSettingsPanel } from './ui/settings.js';

const BATCH = 8;
const MIN_LEN = 12;
const MAX_LEN = 320;

const adapter = getAdapter(location.hostname);
// In demo preview mode the page runs its own copy of the UI, so the real extension stays out.
// (The real extension has chrome.runtime.id; the preview's fake chrome object doesn't.)
const isPreviewPage = 'debaitPreview' in document.documentElement.dataset;
if (adapter && !window.__debaitLoaded && !(isPreviewPage && chrome.runtime?.id)) {
  window.__debaitLoaded = true;
  start();
}

async function start() {
  let settings = await getSettings();
  injectPageStyles();

  /** @type {Map<Element, {el, text, result, state, tag, original}>} */
  const records = new Map();
  const queue = [];
  let inflight = 0;
  let stats = { hits: 0, scored: 0 };

  const overlay = createOverlay();
  const orb = createOrb(overlay, {
    onClick: (origin) => toggleDebaitPage(origin),
    onDoubleClick: () => { closeCard(); panel.toggle(); },
  });
  const panel = createSettingsPanel(overlay.panelLayer, {
    getPage: pageCounts,
    onToggle: () => toggleDebaitPage(orb.center()),
    orbCenter: () => orb.center(),
    onOpenChange: (open) => orb.setPanelOpen(open),
  });
  orb.setVisible(settings.showOrb);

  // ---------- helpers ----------
  const paint = (hotRecord) => paintHighlights(records.values(), { enabled: settings.showTags, hotRecord });

  function pageCounts() {
    let bait = 0, debaited = 0, scanned = 0;
    for (const r of records.values()) {
      if (!r.result) continue;
      scanned++;
      if (r.state === 'debaited') debaited++;
      else if (r.result.kind !== 'clean') bait++;
    }
    return { bait, debaited, scanned };
  }

  function refreshOrb() {
    let bait = 0, debaited = 0, scanned = 0;
    for (const r of records.values()) {
      if (!r.result) continue;
      scanned++;
      if (r.state === 'debaited') debaited++;
      else if (r.result.kind !== 'clean') bait++;
    }
    const state = inflight > 0 && bait === 0 ? 'busy' : bait > 0 ? 'bait' : debaited > 0 ? 'calm' : 'idle';
    orb.update({ state, bait, debaited, scanned });
    panel.refresh();
  }

  // ---------- finding headlines ----------
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const rec = records.get(e.target);
      if (rec && !rec.result && !rec.queued) {
        rec.queued = true;
        queue.push(rec);
      }
    }
    flushSoon();
  }, { rootMargin: '300px 0px' });

  function scan() {
    for (const el of adapter.find(document)) {
      if (el.closest('debait-tag, debait-root')) continue;
      const existing = records.get(el);
      if (existing) {
        // sites like X reuse elements for new posts: rescore if the text changed
        if (existing.animating || existing.state === 'debaited' || textOf(el) === existing.text || textOf(el) === existing.result?.honest_rewrite) continue;
        existing.tag?.remove();
        records.delete(el);
      }
      const text = textOf(el);
      if (text.length < MIN_LEN || text.length > MAX_LEN) continue;
      const rec = { el, text, result: null, state: 'pending', tag: null, original: null };
      records.set(el, rec);
      mountTag(rec);
      io.observe(el);
    }
    refreshOrb();
  }

  function mountTag(rec) {
    rec.tag = createTag(rec.el, {
      onClick: (rect) => {
        if (!rec.result) return;
        paint(rec);
        openCard(overlay.cardLayer, rec, rect, {
          onDebait: () => debaitOne(rec),
          onRestore: () => restoreOne(rec),
        });
      },
    });
    rec.tag.setVisible(settings.showTags);
  }

  // ---------- scoring ----------
  let flushTimer = null;
  function flushSoon() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 120);
  }

  async function flush() {
    while (queue.length) {
      const batch = queue.splice(0, BATCH);
      inflight++;
      refreshOrb();
      try {
        const res = await chrome.runtime.sendMessage({ type: MSG.SCORE, texts: batch.map((r) => r.text) });
        if (!res?.ok) throw new Error(res?.error || 'no response');
        stats.hits += res.cacheHits;
        stats.scored += batch.length;
        batch.forEach((rec, i) => applyResult(rec, res.results[i]));
        console.debug(`[Debait] scored ${batch.length} (cache hits so far: ${stats.hits}/${stats.scored})`);
      } catch (err) {
        console.warn('[Debait] scoring failed:', err.message);
        batch.forEach((rec) => { rec.queued = false; rec.tag?.remove(); records.delete(rec.el); });
      } finally {
        inflight--;
      }
    }
    paint();
    refreshOrb();
  }

  function applyResult(rec, result) {
    if (!records.has(rec.el) || !result) return;
    rec.result = result;
    rec.state = 'scored';
    rec.tag?.setResult(result);
    if (settings.autoDebait && result.kind !== 'clean') {
      swapToRewrite(rec).then(() => rec.tag?.setDebaited(true, result));
    }
  }

  // ---------- debaiting ----------
  function debaitOne(rec) {
    swapToRewrite(rec).then(() => { paint(); refreshOrb(); });
    setTimeout(() => rec.tag?.setDebaited(true, rec.result), 240);
    chrome.runtime.sendMessage({ type: 'debait/debaited', count: 1 });
    refreshOrb();
  }

  function restoreOne(rec) {
    swapToOriginal(rec).then(() => { paint(); refreshOrb(); });
    setTimeout(() => rec.tag?.setDebaited(false, rec.result), 240);
    refreshOrb();
  }

  function distanceFrom(origin, el) {
    const b = el.getBoundingClientRect();
    return Math.hypot(b.left + b.width / 2 - origin.x, b.top + b.height / 2 - origin.y);
  }

  function toggleDebaitPage(origin) {
    closeCard();
    orb.pulse();
    const all = [...records.values()].filter((r) => r.result);
    const bait = all.filter((r) => r.state === 'scored' && r.result.kind !== 'clean');
    const done = all.filter((r) => r.state === 'debaited');

    if (bait.length) {
      // the wave rolls out from the orb; each headline decodes when the wave reaches it
      const { R, duration } = playRipple(origin);
      const jobs = bait.map((rec) => {
        const delay = duration ? Math.min(1, distanceFrom(origin, rec.el) / R) * duration * 0.75 : 0;
        setTimeout(() => rec.tag?.setDebaited(true, rec.result), delay + 240);
        return swapToRewrite(rec, { delay });
      });
      refreshOrb();
      Promise.all(jobs).then(() => { paint(); refreshOrb(); });
      chrome.runtime.sendMessage({ type: 'debait/debaited', count: bait.length });
    } else if (done.length) {
      // undo: the wave flows back into the orb
      const { R, duration } = playRipple(origin, { undo: true });
      const jobs = done.map((rec) => {
        const delay = duration ? (1 - Math.min(1, distanceFrom(origin, rec.el) / R)) * duration * 0.6 : 0;
        setTimeout(() => rec.tag?.setDebaited(false, rec.result), delay + 240);
        return swapToOriginal(rec, { delay });
      });
      refreshOrb();
      Promise.all(jobs).then(() => { paint(); refreshOrb(); });
    }
  }

  // ---------- settings + popup commands ----------
  onSettingsChange((next) => {
    const prev = settings;
    settings = next;
    orb.setVisible(next.showOrb);
    if (prev.showTags !== next.showTags) {
      for (const r of records.values()) r.tag?.setVisible(next.showTags);
      paint();
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'debait/togglePage') {
      toggleDebaitPage(orb.center());
      sendResponse({ ok: true });
    }
    return false;
  });

  // ---------- go ----------
  scan();
  let scanTimer = null;
  new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 400);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
