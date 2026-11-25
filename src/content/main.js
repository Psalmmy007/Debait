// Debait content script: finds headlines, gets them scored, and runs the on-page UI.
import { MSG } from '../engine/contract.js';
import { getSettings, onSettingsChange } from '../shared/storage.js';
import { getAdapter, textOf } from './sites/index.js';
import { injectPageStyles, paintHighlights, swapToRewrite, swapToOriginal } from './ui/page.js';
import { createOverlay, createOrb, playRipple } from './ui/overlay.js';
import { chime } from './ui/chime.js';
import { createTag } from './ui/tag.js';
import { openCard, closeCard } from './ui/card.js';
import { createSettingsPanel } from './ui/settings.js';
import { setSettings } from '../shared/storage.js';
import { send, extensionAlive } from './ext.js';

const BATCH = 8;
const PARALLEL = 3;
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
  send({ type: 'debait/error', where: `content ${location.hostname}`, message });
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

  // When Debait reloads (an update or a new build) Chrome puts a fresh copy into open tabs, but the
  // old copy keeps running in its own sandbox. Tell any old copy to stop and clear its tags and orb,
  // so a headline never shows two or three tags.
  document.dispatchEvent(new CustomEvent('debait:takeover'));
  document.querySelectorAll('debait-tag, debait-root').forEach((n) => n.remove());
  let alive = true;
  let liveTimer = null;
  const stopHere = (reason) => {
    if (!alive) return;
    alive = false;
    try {
      clearInterval(liveTimer);
      pageObserver?.disconnect();
      io.disconnect();
      clearTimeout(scanTimer); clearTimeout(retryTimer); clearTimeout(upgradeTimer);
      queue.length = 0;
      orb.destroy?.();
      if (reason === 'gone') {
        // Debait was updated or removed and no new copy took over: take our dead UI off the page
        for (const r of records.values()) r.tag?.remove();
        overlay.host.remove();
        if ('highlights' in CSS) { CSS.highlights.delete('debait-bait'); CSS.highlights.delete('debait-hot'); }
      }
    } catch { /* still starting up: the alive flag is enough */ }
  };
  // this copy is the old one now: step aside quietly
  document.addEventListener('debait:takeover', () => stopHere('takeover'), { once: true });
  const extensionGone = () => { if (extensionAlive()) return false; stopHere('gone'); return true; };
  liveTimer = setInterval(extensionGone, 4000);
  let pageObserver = null;
  injectPageStyles();

  /** @type {Map<Element, {el, text, result, state, tag, original}>} */
  const records = new Map();
  const queue = [];
  let inflight = 0;
  let stats = { hits: 0, scored: 0 };
  let notice = '';     // why scoring is paused, shown on the orb
  let retryTimer = null;

  const overlay = createOverlay();
  const orb = createOrb(overlay, {
    onClick: (origin) => { if (!extensionGone()) toggleDebaitPage(origin); },
    onDoubleClick: () => { if (extensionGone()) return; closeCard(); panel.toggle(); },
    onTripleClick: async () => {
      if (extensionGone()) return;
      closeCard();
      panel.close();
      const s = await getSettings();
      chime(s.voice ? 'end' : 'start');
      await setSettings({ voice: !s.voice });
      if (s.voice) onCallState({ state: 'ended' });
    },
  });
  const panel = createSettingsPanel(overlay.panelLayer, {
    getPage: pageCounts,
    onToggle: () => toggleDebaitPage(orb.center()),
    orbCenter: () => orb.center(),
    onSize: (k) => orb.setSize(k),
    onSummarize: (onText) => summarizePage(onText),
    onOpenChange: (open) => orb.setPanelOpen(open),
  });
  orb.setVisible(settings.showOrb);
  orb.setSize(settings.orbSize);

  // ---------- call mode: Gemini Live acts on this page through these tools ----------
  function kinds() {
    const k = { rage: 0, fear: 0, envy: 0 };
    for (const r of records.values()) if (r.result && r.state === 'scored' && r.result.kind !== 'clean') k[r.result.kind]++;
    return k;
  }
  const baitList = () => [...records.values()]
    .filter((r) => r.result && r.result.kind !== 'clean')
    .sort((a, b) => b.result.score - a.result.score);

  // ---------- page summary ----------
  /** The article's text if this is an article, otherwise the headlines Debait found. */
  function pageForSummary() {
    const root = document.querySelector('article') || document.querySelector('main') || document.body;
    const paras = [...root.querySelectorAll('p')]
      .filter((p) => !p.closest('nav, footer, aside, debait-root') && p.offsetParent !== null)
      .map((p) => p.innerText.replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 60);
    const text = paras.join('\n').slice(0, 7000);
    const headlines = [...records.values()].map((r) => r.text).slice(0, 40);
    const article = (paras.length >= 4 && text.length > 900) || headlines.length < 3;
    return { kind: article ? 'article' : 'feed', title: document.title, text, headlines };
  }

  let lastSummary = null;
  let onSummaryText = null; // the panel, while a summary is being written
  async function summarizePage(onText) {
    if (lastSummary?.url === location.href) return lastSummary;
    onSummaryText = onText || null;
    const res = await send({ type: MSG.SUMMARY, page: pageForSummary(), stream: !!onText }).finally(() => { onSummaryText = null; });
    if (!res?.ok) throw new Error(res?.error || 'no response');
    lastSummary = { url: location.href, summary: res.summary, source: res.source };
    return lastSummary;
  }

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
    if (name === 'summarize_page') {
      const r = await summarizePage().catch((e) => ({ error: e.message }));
      return r.error ? { error: r.error } : { summary: r.summary };
    }
    if (name === 'open_mind_facts') {
      const res = await send({ type: 'debait/openSidePanel' });
      return res?.ok ? { ok: true } : { ok: false, tip: 'Tell the user to click the Debait icon, then Weekly Mind Facts.' };
    }
    return { error: 'unknown tool' };
  }

  function onCallState({ state, message }) {
    if (state === 'connecting') orb.setVoice({ mode: 'speaking', text: 'Calling Debait…' });
    else if (state === 'live') orb.setVoice({ mode: 'listening' });
    else if (state === 'talking') orb.setVoice({ mode: 'speaking', text: '' });
    else if (state === 'heard') orb.setVoice({ mode: 'heard', text: message });
    else if (state === 'reconnecting') orb.setVoice({ mode: 'speaking', text: 'Reconnecting…' });
    else if (state === 'working') orb.setVoice({ mode: 'speaking', text: 'On it…' });
    else if (state === 'error') orb.setVoice({ mode: 'error', text: message });
    else orb.setVoice({ mode: 'idle' });
  }
  // a call may already be running when this page loads
  if (settings.voice) send({ target: 'offscreen', type: 'debait/call-status' }).then((r) => r?.inCall && onCallState({ state: 'live' }));

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
  }, { rootMargin: '900px 0px' }); // score a little ahead of where you're reading

  function scan() {
    if (!alive || extensionGone()) return;
    // the site redrew or removed a headline (Google, React apps): drop its old tag so tags never pile up
    for (const [el, rec] of records) {
      if (!el.isConnected) { rec.tag?.remove(); io.unobserve(el); records.delete(el); }
    }
    for (const el of adapter.find(document)) {
      if (el.closest('debait-tag, debait-root')) continue;
      const existing = records.get(el);
      if (existing) {
        // the site redrew a debaited headline with its own words (React, Preact): put the honest one back
        if (existing.state === 'debaited' && !existing.animating && textOf(el) === existing.text && existing.result?.honest_rewrite) {
          el.replaceChildren(document.createTextNode(existing.result.honest_rewrite));
          continue;
        }
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
    const anchor = adapter.place?.(rec.el) || rec.el;
    // never two tags on one headline (a stray one left behind by a redraw)
    if (anchor.nextElementSibling?.localName === 'debait-tag') anchor.nextElementSibling.remove();
    rec.tag = createTag(anchor, {
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

  // what's on screen first, then nearest to the screen
  function byDistance(rec) {
    const r = rec.el?.isConnected ? rec.el.getBoundingClientRect() : null;
    if (!r || (!r.width && !r.height)) return 1e9;
    return r.bottom < 0 ? -r.bottom + innerHeight : r.top > innerHeight ? r.top : 0;
  }

  async function scoreBatch(batch) {
    if (!alive || extensionGone()) return;
    inflight++;
    refreshOrb();
    try {
      const res = await send({ type: MSG.SCORE, texts: batch.map((r) => r.text) });
      if (!res?.ok) throw new Error(res?.error || 'no response');
      stats.hits += res.cacheHits;
      stats.scored += batch.length;
      batch.forEach((rec, i) => applyResult(rec, res.results[i]));
      if (res.results.some((r) => r?.source === 'mock')) upgradeSoon();
      console.debug(`[Debait] scored ${batch.length} (cache hits so far: ${stats.hits}/${stats.scored})`);
    } catch (err) {
      console.debug('[Debait] scoring failed:', err.message); // the orb tells the user; not an extension error
      // keep the records (no rescan loop), hide the waiting pills, tell the user why, retry in a minute
      batch.forEach((rec) => { rec.queued = false; rec.failed = true; rec.tag?.setVisible(false); });
      notice = /LOCAL_ONLY_(SLOW|FAILED)/.test(err.message)
        ? 'Local only is on, and Gemini Nano did not finish on this computer. Retrying in a minute, or turn off Local only to use Gemini in the cloud.'
        : /LOCAL_ONLY/.test(err.message)
        ? 'Local only is on, but Gemini Nano is not downloaded yet. Open the Debait popup and click Turn on Debait, or turn off Local only.'
        : 'Debait could not reach its AI. Retrying in a minute.';
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        notice = '';
        for (const r of records.values()) if (r.failed && !r.result) { r.failed = false; r.tag?.setVisible(settings.showTags); r.queued = true; queue.push(r); }
        flushSoon();
      }, 60000);
    } finally {
      inflight--;
    }
  }

  // The first headlines of a session are answered by the backup engine while Gemini warms up.
  // Re-ask for those a little later so the placeholder tags turn into real Gemini results.
  let upgradeTimer = null;
  let upgradeDelay = 21000; // just after Gemini's retry window (engine/index.js)
  function upgradeSoon() {
    if (upgradeTimer) return;
    upgradeTimer = setTimeout(() => {
      upgradeTimer = null;
      let n = 0;
      for (const r of records.values()) {
        if (r.state === 'scored' && r.result?.source === 'mock' && !r.queued && (r.upgrades || 0) < 4) {
          r.upgrades = (r.upgrades || 0) + 1; r.queued = true; queue.push(r); n++;
        }
      }
      upgradeDelay = Math.min(upgradeDelay * 2, 120000); // back off while Gemini stays down
      if (n) flushSoon();
    }, upgradeDelay);
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    // up to PARALLEL batches at once (each is one Gemini call), visible headlines first
    const running = new Set();
    while (queue.length || running.size) {
      while (queue.length && running.size < PARALLEL) {
        queue.sort((x, y) => byDistance(x) - byDistance(y));
        const job = scoreBatch(queue.splice(0, BATCH)).finally(() => running.delete(job));
        running.add(job);
      }
      await Promise.race(running);
    }
    flushing = false;
    paint();
    refreshOrb();
  }

  function applyResult(rec, result) {
    if (!records.has(rec.el) || !result) return;
    rec.queued = false;
    if (rec.state === 'debaited') {
      // a better answer arrived for a headline that's already debaited
      rec.result = result;
      if (result.kind === 'clean') {
        swapToOriginal(rec).then(() => { paint(); refreshOrb(); });
        rec.tag?.setResult(result);
        rec.tag?.setDebaited(false, result);
        return;
      }
      if (textOf(rec.el) !== result.honest_rewrite) rec.el.replaceChildren(document.createTextNode(result.honest_rewrite));
      rec.tag?.setResult(result);
      rec.tag?.setDebaited(true, result);
      return;
    }
    rec.result = result;
    rec.state = 'scored';
    rec.tag?.setResult(result);
    // "Debait automatically", or this page was debaited: new and redrawn bait headlines follow suit
    if ((settings.autoDebait || pageDebaited) && result.kind !== 'clean' && result.source !== 'mock') {
      swapToRewrite(rec).then(() => rec.tag?.setDebaited(true, result));
      send({ type: 'debait/debaited', texts: [rec.text] }); // auto-debaited headlines count too
    }
  }

  // ---------- debaiting ----------
  function debaitOne(rec) {
    if (!rec?.result || rec.result.kind === 'clean') return;
    swapToRewrite(rec).then(() => { paint(); refreshOrb(); });
    setTimeout(() => rec.tag?.setDebaited(true, rec.result), 240);
    if (rec.result.source !== 'mock') send({ type: 'debait/debaited', texts: [rec.text] });
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

  let pageDebaited = false; // after "Debait this page", until the originals are restored
  function toggleDebaitPage(origin) {
    closeCard();
    orb.pulse();
    const all = [...records.values()].filter((r) => r.result);
    const bait = all.filter((r) => r.state === 'scored' && r.result.kind !== 'clean');
    const done = all.filter((r) => r.state === 'debaited');

    if (bait.length) {
      pageDebaited = true;
      // the wave rolls out from the orb; each headline decodes when the wave reaches it
      const { R, duration } = playRipple(origin);
      const jobs = bait.map((rec) => {
        const delay = duration ? Math.min(1, distanceFrom(origin, rec.el) / R) * duration * 0.75 : 0;
        setTimeout(() => rec.tag?.setDebaited(true, rec.result), delay + 240);
        return swapToRewrite(rec, { delay });
      });
      refreshOrb();
      Promise.all(jobs).then(() => { paint(); refreshOrb(); });
      const real = bait.filter((r) => r.result.source !== 'mock').map((r) => r.text);
      if (real.length) send({ type: 'debait/debaited', texts: real });
    } else if (done.length) {
      pageDebaited = false;
      // undo: the wave flows back into the orb
      const { R, duration } = playRipple(origin, { undo: true });
      const jobs = done.map((rec) => {
        const delay = duration ? (1 - Math.min(1, distanceFrom(origin, rec.el) / R)) * duration * 0.6 : 0;
        setTimeout(() => rec.tag?.setDebaited(false, rec.result), delay + 240);
        return swapToOriginal(rec, { delay });
      });
      refreshOrb();
      Promise.all(jobs).then(() => { paint(); refreshOrb(); });
    } else if ([...records.values()].some((r) => !r.result)) {
      // clicked while Gemini is still reading the headlines: remember it, and each bait
      // headline is debaited the moment its result arrives (see applyResult)
      pageDebaited = true;
      playRipple(origin);
    }
  }

  // ---------- settings + popup commands ----------
  onSettingsChange((next) => {
    const prev = settings;
    settings = next;
    orb.setVisible(next.showOrb);
    orb.setSize(next.orbSize);
    if (prev.localOnly !== next.localOnly && notice) { clearTimeout(retryTimer); notice = ''; for (const r of records.values()) if (r.failed && !r.result) { r.failed = false; r.tag?.setVisible(next.showTags); r.queued = true; queue.push(r); } flushSoon(); }
    if (prev.voice && !next.voice) onCallState({ state: 'ended' });
    if (prev.showTags !== next.showTags) {
      for (const r of records.values()) r.tag?.setVisible(next.showTags);
      paint();
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'debait/summary-chunk') {
      onSummaryText?.(msg.text);
      return false;
    }
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
  pageObserver = new MutationObserver((muts) => {
    if (scanTimer || !alive) return;
    if (muts.every((m) => m.target.nodeName === 'DEBAIT-TAG' || m.target.closest?.('debait-tag'))) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 600);
  });
  pageObserver.observe(document.body, { childList: true, subtree: true });
}
