import { sendRuntimeMessage } from '../shared/messaging.js';
// Debait content script: finds headlines, gets them scored, and runs the on-page UI.
import { MSG } from '../engine/contract.js';
import { getSettings, onSettingsChange } from '../shared/storage.js';
import { getAdapter, textOf } from './sites/index.js';
import { injectPageStyles, paintHighlights, swapToRewrite, swapToOriginal } from './ui/page.js';
import { createOverlay, createOrb, playRipple } from './ui/overlay.js';
import { createTag } from './ui/tag.js';
import { openCard, closeCard } from './ui/card.js';
import { createSettingsPanel } from './ui/settings.js';
import { setSettings } from '../shared/storage.js';

const BATCH = 8;
const MIN_LEN = 12;
const MAX_LEN = 320;

const adapter = getAdapter(location.hostname);
// In demo preview mode the page runs its own copy of the UI, so the real extension stays out.
// (The real extension has chrome.runtime.id; the preview's fake chrome object doesn't.)
const isPreviewPage = 'debaitPreview' in document.documentElement.dataset;
// Status marks on the page (data-debait-*), so problems can be diagnosed from any tab.
const mark = (k, v) => { try { document.documentElement.setAttribute(`data-debait-${k}`, String(v).slice(0, 400)); } catch { /* page blocks attributes */ } };
const report = (err) => {
  const message = String(err?.stack || err?.message || err).slice(0, 600);
  mark('error', message);
  try { sendRuntimeMessage({ type: 'debait/error', where: `content ${location.hostname}`, message }).catch(() => {}); } catch { /* extension reloaded */ }
};
mark('loaded', chrome.runtime?.getManifest?.().version || 'yes');

if (adapter && !window.__debaitLoaded && !(isPreviewPage && chrome.runtime?.id)) {
  window.__debaitLoaded = true;
  start().then(() => mark('started', Date.now()), report);
}

async function start() {
  let settings = await getSettings();
  const host = location.hostname.replace(/^www./, '');
  onSettingsChange((next) => {
    if (next.disabledSites.includes(host) !== settings.disabledSites.includes(host)) location.reload();
  });
  if (settings.disabledSites.includes(host)) return; // switched off for this site
  injectPageStyles();

  /** @type {Map<Element, {el, text, result, state, tag, original}>} */
  const records = new Map();
  const queue = [];
  let inflight = 0;
  let stats = { hits: 0, scored: 0 };
  let contextLost = false;
  let notice = '';     // why scoring is paused, shown on the orb
  let retryTimer = null;

  const overlay = createOverlay();
  const orb = createOrb(overlay, {
    onClick: (origin) => toggleDebaitPage(origin),
    onDoubleClick: () => { closeCard(); panel.toggle(); },
    onTripleClick: async () => {
      closeCard();
      panel.close();
      const s = await getSettings();
      await setSettings({ voice: !s.voice });
      if (s.voice) onCallState({ state: 'ended' });
    },
  });
  const panel = createSettingsPanel(overlay.panelLayer, {
    getPage: pageCounts,
    onToggle: () => toggleDebaitPage(orb.center()),
    orbCenter: () => orb.center(),
    onOpenChange: (open) => orb.setPanelOpen(open),
  });
  orb.setVisible(settings.showOrb);

  // ---------- call mode: Gemini Live acts on this page through these tools ----------
  function kinds() {
    const k = { rage: 0, fear: 0, envy: 0 };
    for (const r of records.values()) if (r.result && r.state === 'scored' && r.result.kind !== 'clean') k[r.result.kind]++;
    return k;
  }
  const baitList = () => [...records.values()]
    .filter((r) => r.result && r.result.kind !== 'clean')
    .sort((a, b) => b.result.score - a.result.score);

  async function runTool(name, args) {
    const { bait, debaited, scanned } = pageCounts();
    if (name === 'page_report') {
      return {
        site: location.hostname.replace(/^www./, ''),
        headlines_read: scanned, bait_now: bait, already_debaited: debaited, ...kinds(),
        worst: baitList().slice(0, 6).map((r, i) => ({ number: i + 1, headline: r.text, kind: r.result.kind, score: r.result.score, debaited: r.state === 'debaited' })),
      };
    }
    if (name === 'debait_page') {
      if (bait > 0) toggleDebaitPage(orb.center());
      return { rewrote: bait, note: bait ? 'done' : debaited ? 'page was already debaited' : 'no bait found' };
    }
    if (name === 'restore_page') {
      if (debaited > 0 && bait === 0) toggleDebaitPage(orb.center());
      return { restored: debaited };
    }
    if (name === 'explain_headline') {
      const r = baitList()[Math.max(0, (args.number || 1) - 1)];
      if (!r) return { error: 'no such headline' };
      return { headline: r.text, kind: r.result.kind, score: r.result.score, manipulative_words: r.result.triggers, honest_rewrite: r.result.honest_rewrite };
    }
    if (name === 'set_setting') {
      const key = { show_tags: 'showTags', auto_debait: 'autoDebait', local_only: 'localOnly', show_orb: 'showOrb' }[args.setting];
      if (!key) return { error: 'unknown setting' };
      await setSettings({ [key]: !!args.on });
      return { ok: true, setting: args.setting, on: !!args.on };
    }
    if (name === 'open_mind_facts') {
      const res = await sendRuntimeMessage({ type: 'debait/openSidePanel' }).catch(() => null);
      return res?.ok ? { ok: true } : { ok: false, tip: 'Tell the user to click the Debait icon, then Weekly Mind Facts.' };
    }
    return { error: 'unknown tool' };
  }

  function onCallState({ state, message }) {
    if (state === 'connecting') orb.setVoice({ mode: 'speaking', text: 'Calling Debait…' });
    else if (state === 'live') orb.setVoice({ mode: 'listening' });
    else if (state === 'working') orb.setVoice({ mode: 'speaking', text: 'On it…' });
    else if (state === 'error') orb.setVoice({ mode: 'error', text: message });
    else orb.setVoice({ mode: 'idle' });
  }
  // a call may already be running when this page loads
  if (settings.voice) sendRuntimeMessage({ target: 'offscreen', type: 'debait/call-status' }).then((r) => r?.inCall && onCallState({ state: 'live' })).catch(() => {});

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
    orb.update({ state, bait, debaited, scanned, notice });
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
    rec.tag = createTag(adapter.place?.(rec.el) || rec.el, {
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
  // throttle, not debounce: busy pages that never stop changing must still get scored
  function flushSoon() {
    if (flushTimer || flushing) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 120);
  }
  let flushing = false;

  async function flush() {
    if (flushing || contextLost) return;
    flushing = true;
    while (queue.length) {
      const batch = queue.splice(0, BATCH);
      inflight++;
      refreshOrb();
      try {
        const res = await sendRuntimeMessage({ type: MSG.SCORE, texts: batch.map((r) => r.text) });
        if (!res?.ok) throw new Error(res?.error || 'no response');
        stats.hits += res.cacheHits;
        stats.scored += batch.length;
        batch.forEach((rec, i) => applyResult(rec, res.results[i]));
        console.debug(`[Debait] scored ${batch.length} (cache hits so far: ${stats.hits}/${stats.scored})`);
      } catch (err) {
        console.warn('[Debait] scoring failed:', err.message);
        // keep the records (no rescan loop), hide the waiting pills, tell the user why, retry in a minute
        batch.forEach((rec) => { rec.queued = false; rec.failed = true; rec.tag?.setVisible(false); });
        notice = /LOCAL_ONLY/.test(err.message)
          ? `Local only: analysis unavailable. ${err.message.replace(/^LOCAL_ONLY:\s*/, '')}`
          : `Analysis unavailable: ${err.message}. No classification was produced. Retrying in a minute.`;
        clearTimeout(retryTimer);
        if (err.code === 'debait/context-unavailable') {
          contextLost = true;
          notice = err.message;
          break; // A stale extension context cannot recover by retrying messages.
        }
        retryTimer = setTimeout(() => {
          notice = '';
          for (const r of records.values()) if (r.failed && !r.result) { r.failed = false; r.tag?.setVisible(settings.showTags); r.queued = true; queue.push(r); }
          flushSoon();
        }, 60000);
      } finally {
        inflight--;
      }
    }
    flushing = false;
    paint();
    refreshOrb();
  }

  function applyResult(rec, result) {
    if (!records.has(rec.el) || !result) return;
    rec.result = result;
    rec.state = 'scored';
    rec.tag?.setResult(result);
    if (settings.autoDebait && result.kind !== 'clean' && result.source !== 'mock') {
      swapToRewrite(rec).then(() => rec.tag?.setDebaited(true, result));
    }
  }

  // ---------- debaiting ----------
  function debaitOne(rec) {
    swapToRewrite(rec).then(() => { paint(); refreshOrb(); });
    setTimeout(() => rec.tag?.setDebaited(true, rec.result), 240);
    if (rec.result.source !== 'mock') sendRuntimeMessage({ type: 'debait/debaited', count: 1 }).catch(() => {});
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
      const real = bait.filter((r) => r.result.source !== 'mock').length;
      if (real) sendRuntimeMessage({ type: 'debait/debaited', count: real }).catch(() => {});
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
    if (prev.localOnly !== next.localOnly && notice) { clearTimeout(retryTimer); notice = ''; for (const r of records.values()) if (r.failed && !r.result) { r.failed = false; r.tag?.setVisible(next.showTags); r.queued = true; queue.push(r); } flushSoon(); }
    if (prev.voice && !next.voice) onCallState({ state: 'ended' });
    if (prev.showTags !== next.showTags) {
      for (const r of records.values()) r.tag?.setVisible(next.showTags);
      paint();
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'debait/tool') {
      runTool(msg.name, msg.args || {}).then((result) => sendResponse({ result }), (e) => sendResponse({ result: { error: String(e?.message || e) } }));
      return true;
    }
    if (msg?.type === 'debait/call-state') {
      onCallState(msg);
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'debait/togglePage') {
      toggleDebaitPage(orb.center());
      sendResponse({ ok: true });
    }
    return false;
  });

  // ---------- go ----------
  scan();
  let scanTimer = null;
  // rescan at most every 600ms while the page changes (infinite scroll, live updates)
  new MutationObserver((muts) => {
    if (scanTimer) return;
    if (muts.every((m) => m.target.nodeName === 'DEBAIT-TAG' || m.target.closest?.('debait-tag'))) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 600);
  }).observe(document.body, { childList: true, subtree: true });
}
