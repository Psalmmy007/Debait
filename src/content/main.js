import { orbFeedback } from '../shared/uiState.js';
import { canRewriteRecord, hasMeaningfulRewrite } from '../engine/qualityPolicy.js';
import { isQuotaError, planAnalysisRetry } from '../shared/quota.js';
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
  let pauseUntil = 0;
  let pauseReason = '';
  let notice = '';     // why scoring is paused, shown on the orb
  let retryTimer = null;
  let privacyEpoch = 0;
  let pageAction = null;

  const overlay = createOverlay();
  const orb = createOrb(overlay, {
    onClick: (origin) => toggleDebaitPage(origin).then(() => panel.open()).catch(report),
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
    onToggle: () => toggleDebaitPage(orb.center()).catch(report),
    orbCenter: () => orb.center(),
    onOpenChange: (open) => orb.setPanelOpen(open),
    onSize: (value) => orb.setSize(value),
  });
  orb.setSize(settings.orbSize);
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
      return await toggleDebaitPage(orb.center(), { rewriteOnly: true });
    }
    if (name === 'restore_page') {
      return await toggleDebaitPage(orb.center(), { restoreOnly: true });
    }
    if (name === 'explain_headline') {
      const r = baitList()[Math.max(0, (args.number || 1) - 1)];
      if (!r) return { error: 'no such headline' };
      return { headline: r.text, kind: r.result.kind, score: r.result.score, manipulative_words: r.result.triggers, honest_rewrite: r.result.honest_rewrite, rewrite_available: hasMeaningfulRewrite(r.text, r.result.honest_rewrite) };
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
    else if (state === 'reconnecting' || state === 'buffering' || state === 'reconnected') orb.setVoice({ mode: 'speaking', text: message });
    else if (state === 'talking') orb.setVoice({ mode: 'speaking', text: 'Debait is speaking…' });
    else if (state === 'heard') orb.setVoice({ mode: 'heard', text: message });
    else if (state === 'tool-error') orb.setVoice({ mode: 'error', text: message });
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
    return { bait, debaited, scanned, notice, pending: [...records.values()].filter(r => !r.result).length, rewritable: [...records.values()].filter(canRewriteRecord).length, busy: !!pageAction, automatic: settings.autoDebait };
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
    const feedback = orbFeedback({
      results: [...records.values()].filter(r => r.state !== 'debaited' && (!settings.localOnly || r.result?.source === 'on-device')).map(r => r.result),
      busy: inflight > 0,
      error: [...records.values()].some(r => r.failed),
      unavailable: contextLost,
    });
    orb.update({ state, bait, debaited, scanned, notice, feedback });
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
    if (settings.disabledSites.includes(host)) return;
    for (const [el, rec] of records) if (!el.isConnected) { rec.tag?.remove(); io.unobserve(el); records.delete(el); }
    for (const el of adapter.find(document)) {
      if (el.closest('debait-tag, debait-root, blockquote, p, pre, code, [contenteditable=true]')) continue;
      const existing = records.get(el);
      if (existing) {
        // sites like X reuse elements for new posts: rescore if the text changed
        if (existing.animating || textOf(el) === (existing.state === 'debaited' ? existing.rewrittenText : existing.text)) continue;
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
          onAssist: task => requestAssistance(rec, task),
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
    if (flushTimer || flushing || Date.now() < pauseUntil) return;
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 400);
  }
  let flushing = false;

  async function flush() {
    if (flushing || contextLost || settings.disabledSites.includes(host) || Date.now() < pauseUntil) return;
    flushing = true;
    while (queue.length) {
      const batch = [...new Set(queue.splice(0, BATCH))].filter(r => records.get(r.el) === r && r.el.isConnected && !r.result);
      if (!batch.length) continue;
      inflight++;
      refreshOrb();
      try {
        const res = await sendRuntimeMessage({ type: MSG.SCORE, texts: batch.map((r) => r.text) });
        if (!res?.ok) throw Object.assign(new Error(res?.error || 'no response'), { code: res?.code, retryAt: res?.retryAt, autoRetry: res?.autoRetry });
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
        if (isQuotaError(err)) {
          // One tab timer, not one immediate worker request per queued batch.
          for (const r of queue.splice(0)) { r.queued = false; r.failed = true; r.tag?.setVisible(false); }
          notice = err.message;
        }
        const retry = planAnalysisRetry([...records.values()].filter(r => r.failed && !r.result && !r.retryStopped), err);
        if (retry) {
          pauseUntil = retry.at;
          pauseReason = notice;
          notice += ` Retrying no earlier than ${new Date(retry.at).toLocaleTimeString()}.`;
          retryTimer = setTimeout(() => {
            pauseUntil = 0;
            notice = '';
            for (const r of retry.records) if (r.failed && !r.result) {
              r.failed = false; r.tag?.setVisible(settings.showTags); r.queued = true; queue.push(r);
            }
            flushSoon();
          }, Math.max(0, retry.at - Date.now()));
        } else {
          pauseUntil = Infinity;
          notice = `${err.message} Automatic retries stopped. Refresh to try again later.`;
          pauseReason = notice;
        }
        if (isQuotaError(err)) break;

      } finally {
        inflight--;
      }
    }
    flushing = false;
    paint();
    refreshOrb();
  }

  function applyResult(rec, result) {
    if (records.get(rec.el) !== rec || !rec.el.isConnected || textOf(rec.el) !== rec.text || !result) return;
    if (settings.localOnly && result.source !== 'on-device') return;
    rec.result = result;
    rec.state = 'scored';
    rec.tag?.setResult(result);
    if (settings.autoDebait && !rec.autoRestored && canRewriteRecord(rec) && result.source !== 'mock') {
      debaitOne(rec, { automatic: true }).catch(report);
    }
  }

  // ---------- debaiting ----------
  async function debaitOne(rec, { automatic = false, delay = 0 } = {}) {
    const epoch = privacyEpoch;
    const permitted = () => !settings.disabledSites.includes(host) && records.get(rec.el) === rec && rec.el.isConnected && epoch === privacyEpoch &&
      (!settings.localOnly || (rec.rewriteSource || rec.result?.source) === 'on-device') && (!automatic || (settings.autoDebait && !rec.autoRestored));
    if (!canRewriteRecord(rec) || !permitted()) return false;
    if (notice === 'No safe alternative available') notice = '';
    const changed = await swapToRewrite(rec, { canApply: permitted, delay });
    if (changed) {
      rec.autoRestored = false;
      rec.autoApplied = automatic;
      if (!pageAction) notice = automatic ? 'Auto-Debait applied a safe alternative. The original can be restored.' : 'Safe rewrite applied. Open its tag to restore the original.';
      rec.tag?.setDebaited(true, rec.result);
      if (rec.result.source !== 'mock') sendRuntimeMessage({ type: 'debait/debaited', count: 1 }).catch(() => {});
    }
    if (!changed && rec.el.isConnected && textOf(rec.el) !== rec.text) scan();
    paint(); refreshOrb();
    return changed;
  }

  async function restoreOne(rec, { delay = 0, manual = true } = {}) {
    const restored = await swapToOriginal(rec, { delay });
    if (restored) {
      rec.autoApplied = false;
      if (manual) rec.autoRestored = true;
      if (manual && !pageAction) notice = settings.autoDebait ? 'Original restored. Auto-Debait will leave this headline unchanged.' : 'Original wording restored.';
      rec.tag?.setDebaited(false, rec.result);
    }
    if (!restored && rec.el.isConnected && textOf(rec.el) !== rec.text) scan();
    paint(); refreshOrb();
    return restored;
  }

  async function requestAssistance(rec, task) {
    if (settings.disabledSites.includes(host)) throw new Error('Debait is disabled on this site.');
    if (rec.assistPending) throw new Error('A headline request is already in progress.');
    const epoch = privacyEpoch;
    if (records.get(rec.el) !== rec || !rec.el.isConnected) throw new Error('This headline changed. Open its new tag.');
    rec.assistPending = true;
    try {
      const response = await sendRuntimeMessage({ type: MSG.ASSIST, text: rec.text, task, kind: rec.result.kind });
      if (!response?.ok) throw Object.assign(new Error(response?.error || 'Assistance unavailable. The original is unchanged.'), { code: response?.code, reason: response?.reason, retryAt: response?.retryAt });
      if (epoch !== privacyEpoch || records.get(rec.el) !== rec || !rec.el.isConnected ||
          textOf(rec.el) !== (rec.state === 'debaited' ? rec.rewrittenText : rec.text)) throw new Error('The headline or privacy setting changed. Request again.');
      if (settings.localOnly && response.result.source !== 'on-device') throw new Error('LOCAL_ONLY: Cloud assistance cannot be used.');
      if (task === 'rewrite') {
        rec.result = { ...rec.result, honest_rewrite: response.result.honest_rewrite, rewriteReason: response.result.rewriteReason };
        rec.rewriteSource = response.result.source;
      }
      return response.result;
    } finally { rec.assistPending = false; }
  }

  function distanceFrom(origin, el) {
    const b = el.getBoundingClientRect();
    return Math.hypot(b.left + b.width / 2 - origin.x, b.top + b.height / 2 - origin.y);
  }

  async function toggleDebaitPage(origin, options = {}) {
    if (pageAction) return pageAction;
    pageAction = performPageAction(origin, options);
    try { return await pageAction; }
    finally { pageAction = null; refreshOrb(); }
  }
  async function performPageAction(origin, { rewriteOnly = false, restoreOnly = false } = {}) {
    if (settings.disabledSites.includes(host) && !restoreOnly) return { rewrote: 0, restored: 0, note: 'Debait is disabled on this site.' };
    if (!restoreOnly) {
      scan();
      for (const rec of records.values()) if (!rec.result && !rec.queued && !rec.retryStopped) { rec.queued = true; queue.push(rec); }
      if (Date.now() < pauseUntil) {
        if (!rewriteOnly && [...records.values()].some(rec => rec.state === 'debaited')) return performPageAction(origin, { restoreOnly: true });
        refreshOrb(); return { rewrote: 0, restored: 0, note: pauseReason || notice || 'Analysis is paused. Wait for the cooldown or refresh later.' };
      }
      notice = 'Analyzing eligible headlines before applying safe rewrites…'; refreshOrb();
      flush().catch(report);
      // Another automatic flush may already own the queue. Await its current batch,
      // bounded by the engine timeout; do not bypass a cooldown or create retries.
      const until = Date.now() + 32000;
      while (flushing && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
    }
    closeCard();
    const all = [...records.values()].filter(r => r.result);
    if (all.some(r => r.animating)) return { rewrote: 0, restored: 0, note: 'Rewriting is still in progress' };
    const bait = restoreOnly ? [] : all.filter(canRewriteRecord);
    const done = all.filter(r => r.state === 'debaited');
    if (bait.length) {
      if (notice === 'No safe alternative available') notice = '';
      orb.pulse();
      const { R, duration } = playRipple(origin);
      const changes = await Promise.all(bait.map(rec => debaitOne(rec, { delay: duration ? Math.min(1, distanceFrom(origin, rec.el) / R) * duration * 0.75 : 0 })));
      const count = changes.filter(Boolean).length;
      const unavailable = all.filter(r => r.state !== 'debaited' && r.result.kind !== 'clean').length;
      const remaining = [...records.values()].filter(r => !r.result).length;
      const waiting = remaining ? ` ${remaining} headline(s) still await analysis. ${notice}` : '';
      notice = `Analyzed ${all.length} headlines. Applied ${count} safe rewrite(s); ${unavailable} flagged headline(s) have no safe alternative.${waiting}`;
      paint(); refreshOrb();
      return { rewrote: count, restored: 0, note: notice };
    }
    if (done.length && !rewriteOnly) {
      orb.pulse();
      const { R, duration } = playRipple(origin, { undo: true });
      const restored = await Promise.all(done.map(rec => restoreOne(rec, { delay: duration ? (1 - Math.min(1, distanceFrom(origin, rec.el) / R)) * duration * 0.6 : 0 })));
      notice = `Restored ${restored.filter(Boolean).length} original headline(s).`;
      paint(); refreshOrb();
      return { rewrote: 0, restored: restored.filter(Boolean).length, note: notice };
    }
    const failed = [...records.values()].filter(r => !r.result).length;
    notice = failed ? `${failed} headline(s) are not analyzed yet. ${notice}` : !all.length ? 'No eligible headlines were found on this page. Article bodies are not rewritten.' : all.some(r => r.result.kind !== 'clean') ? 'Analysis complete. No safe alternative available. Open a headline to request neutral wording or Explain Simply.' : 'Analysis complete. No emotionally framed headlines need rewriting. Explain Simply is available on each tag.';
    refreshOrb();
    return { rewrote: 0, restored: 0, note: notice };
  }

  // ---------- settings + popup commands ----------
  onSettingsChange((next) => {
    const prev = settings;
    settings = next;
    orb.setVisible(next.showOrb);
    if (prev.orbSize !== next.orbSize) orb.setSize(next.orbSize);
    if (prev.localOnly !== next.localOnly) {
      privacyEpoch++; closeCard();
      for (const rec of records.values()) if (next.localOnly && (rec.result?.source !== 'on-device' || rec.rewriteSource === 'cloud')) {
        (async () => {
          while (rec.animating) await new Promise(resolve => setTimeout(resolve, 25));
          if (rec.state === 'debaited') await restoreOne(rec, { manual: false });
          if (records.get(rec.el) !== rec) return;
          rec.result = null; rec.rewriteSource = null; rec.failed = false; rec.retryStopped = false;
          rec.analysisRetries = 0; rec.pacingDeferrals = 0;
          rec.tag?.remove(); mountTag(rec);
          rec.queued = true; if (!queue.includes(rec)) queue.push(rec);
          flushSoon();
        })().catch(report);
      }
    }
    if (!prev.autoDebait && next.autoDebait) {
      notice = 'Auto-Debait is on for enabled sites. Only safe alternatives will be applied.';
      for (const rec of records.values()) if (!rec.autoRestored && canRewriteRecord(rec) && rec.result.source !== 'mock') debaitOne(rec, { automatic: true }).catch(report);
    }

    if (prev.localOnly !== next.localOnly && notice) { clearTimeout(retryTimer); pauseUntil = 0; notice = ''; for (const r of records.values()) if (r.failed && !r.result) { r.failed = false; r.retryStopped = false; r.analysisRetries = 0; r.pacingDeferrals = 0; r.tag?.setVisible(next.showTags); r.queued = true; queue.push(r); } flushSoon(); }
    if (prev.voice && !next.voice) onCallState({ state: 'ended' });
    if (prev.showTags !== next.showTags) {
      for (const r of records.values()) r.tag?.setVisible(next.showTags);
      paint();
    }
    refreshOrb();
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
      toggleDebaitPage(orb.center()).then(result => sendResponse({ ok: true, ...result }), error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    return false;
  });

  // ---------- go ----------
  scan();
  let scanTimer = null;
  // rescan at most every 600ms while the page changes (infinite scroll, live updates)
  new MutationObserver((muts) => {
    if (scanTimer) return;
    if (muts.every(m => (m.target.nodeType === 3 ? m.target.parentElement : m.target)?.closest?.('debait-tag, debait-root'))) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 600);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
