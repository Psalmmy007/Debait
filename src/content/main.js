// Debait content script: finds headlines, gets them scored, and runs the on-page UI.
import { MSG, CACHE_VERSION, NO_SUMMARY_TEXT, hasEnoughSummaryText } from '../engine/contract.js';
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

  // Hydrate an in-memory copy of the normalized score cache so revisited or scrolled-back
  // headlines resolve in 0 ms offline without waiting behind an active Nano prompt.
  const localCache = new Map();
  try {
    const stored = await chrome.storage.local.get(['scoreCache', 'cacheVersion']);
    if (stored?.cacheVersion === CACHE_VERSION && Array.isArray(stored.scoreCache)) {
      for (const [k, v] of stored.scoreCache) if (k && v && v.source !== 'mock') localCache.set(k, v);
    }
  } catch { /* preview / storage unavailable */ }
  const onCacheStorage = (changes, area) => {
    if (area !== 'local') return;
    if (changes.cacheVersion && changes.cacheVersion.newValue !== CACHE_VERSION) {
      localCache.clear();
      return;
    }
    if (changes.scoreCache && Array.isArray(changes.scoreCache.newValue)) {
      for (const [k, v] of changes.scoreCache.newValue) if (k && v && v.source !== 'mock') localCache.set(k, v);
    }
  };
  chrome.storage?.onChanged?.addListener(onCacheStorage);

  // Batch 0 ms local cache hits into one background stats update for Weekly Mind Facts.
  let pendingHits = [];
  let hitTimer = null;
  function queueCacheHit(text, result) {
    pendingHits.push({ text, result });
    if (hitTimer) return;
    hitTimer = setTimeout(() => {
      hitTimer = null;
      const items = pendingHits;
      pendingHits = [];
      if (items.length && alive && extensionAlive()) send({ type: 'debait/record-hits', items });
    }, 500);
  }

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
      removeEventListener('online', onOnline);
      chrome.storage?.onChanged?.removeListener(onCacheStorage);
      pageObserver?.disconnect();
      io.disconnect();
      viewIo.disconnect();
      clearTimeout(scanTimer); clearTimeout(retryTimer); clearTimeout(upgradeTimer); clearTimeout(hitTimer);
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

  let voiceBusy = false;
  let lastVoiceToggle = 0;
  const VOICE_COOLDOWN = 900;

  const overlay = createOverlay();
  const orb = createOrb(overlay, {
    onClick: (origin) => { if (!extensionGone()) toggleDebaitPage(origin); },
    onDoubleClick: () => { if (extensionGone()) return; closeCard(); panel.toggle(); },
    onTripleClick: async () => {
      if (extensionGone() || voiceBusy) return;
      const now = Date.now();
      if (now - lastVoiceToggle < VOICE_COOLDOWN) return;
      voiceBusy = true;
      lastVoiceToggle = now;
      try {
        closeCard();
        panel.close();
        const s = await getSettings();
        const next = !s.voice;
        if (next && typeof navigator !== 'undefined' && navigator.onLine === false) {
          chime('end');
          onCallState({ state: 'error', message: 'Talk to Debait needs an internet connection.' });
          return;
        }
        if (next && s.localOnly) {
          chime('end');
          onCallState({ state: 'error', message: 'Turn off Local only to use Talk to Debait.' });
          return;
        }
        chime(next ? 'start' : 'end');
        await setSettings({ voice: next });
        if (!next) onCallState({ state: 'ended' });
      } finally {
        voiceBusy = false;
      }
    },
    onMuteToggle: () => { if (!extensionGone()) send({ type: 'debait/call-mute-toggle' }); },
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
    const hasArticle = (paras.length >= 3 && text.length >= 450) || text.length >= 600;
    return { kind: hasArticle ? 'article' : 'feed', title: document.title, text: hasArticle ? text : '', headlines };
  }

  let lastSummary = null;
  let summaryInflight = null; // { url, promise } — dedupes if the panel closes and reopens mid-summary
  let summarySoFar = '';
  let onSummaryText = null; // the panel, while a summary is being written
  async function summarizePage(onText) {
    const url = location.href;
    if (lastSummary?.url === url) return lastSummary;
    if (summaryInflight?.url === url) {
      onSummaryText = onText || null;
      if (summarySoFar && onText) onText(summarySoFar);
      return summaryInflight.promise;
    }
    const page = pageForSummary();
    if (!hasEnoughSummaryText(page)) {
      // Do not cache: dynamic feeds (X, YouTube) may finish loading headlines moments later
      return { url, summary: NO_SUMMARY_TEXT, source: 'none' };
    }
    summarySoFar = '';
    onSummaryText = onText || null;
    const promise = send({ type: MSG.SUMMARY, page, stream: true })
      .then((res) => {
        if (!res?.ok) throw new Error(res?.error || 'no response');
        const out = { url, summary: res.summary, source: res.source };
        if (res.source !== 'none') lastSummary = out;
        return out;
      })
      .finally(() => {
        if (summaryInflight?.promise === promise) summaryInflight = null;
        summarySoFar = '';
        onSummaryText = null;
      });
    summaryInflight = { url, promise };
    return promise;
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

  let lastCallState = 'ended';
  function onCallState({ state, message, muted }) {
    if (state === 'mute') {
      orb.setMuted?.(!!muted);
      return;
    }
    lastCallState = state || 'ended';
    if (typeof muted === 'boolean') orb.setMuted?.(muted);
    if (state === 'connecting') orb.setVoice({ mode: 'connecting', text: 'Calling Debait…' });
    else if (state === 'live') orb.setVoice({ mode: 'listening' });
    else if (state === 'talking') orb.setVoice({ mode: 'speaking', text: '' });
    else if (state === 'heard') orb.setVoice({ mode: 'heard', text: message });
    else if (state === 'reconnecting') orb.setVoice({ mode: 'connecting', text: 'Reconnecting…' });
    else if (state === 'working') orb.setVoice({ mode: 'speaking', text: 'On it…' });
    else if (state === 'error') { orb.setMuted?.(false); orb.setVoice({ mode: 'error', text: message }); }
    else { orb.setMuted?.(false); orb.setVoice({ mode: 'idle' }); }
  }
  // a call may already be running when this page loads (and clears stale voice:true after restart)
  if (settings.voice) {
    send({ type: 'debait/call-status' }).then((r) => {
      if (r?.inCall) onCallState({ state: 'live', muted: !!r.muted });
    });
  }

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
  // Live viewport observer: keeps rec.inView fresh so Nano always prioritizes what is on screen right now.
  const viewIo = new IntersectionObserver((entries) => {
    let added = false;
    for (const e of entries) {
      const rec = records.get(e.target);
      if (!rec) continue;
      rec.inView = e.isIntersecting;
      if (e.isIntersecting && !rec.result && !rec.queued && !rec.failed) {
        rec.queued = true;
        queue.push(rec);
        added = true;
      }
    }
    if (added) flushSoon();
  }, { rootMargin: '80px 0px' });

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const rec = records.get(e.target);
      if (rec && !rec.result && !rec.queued && !rec.failed) {
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
      if (!el.isConnected) { rec.tag?.remove(); io.unobserve(el); viewIo.unobserve(el); records.delete(el); }
    }
    let instantHits = 0;
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
        io.unobserve(el);
        viewIo.unobserve(el);
        records.delete(el);
      }
      const text = textOf(el);
      if (text.length < MIN_LEN || text.length > MAX_LEN) continue;
      const rec = { el, text, result: null, state: 'pending', tag: null, original: null, inView: false };
      records.set(el, rec);
      mountTag(rec);
      const cached = localCache.get(text);
      if (cached) {
        stats.hits++;
        stats.scored++;
        applyResult(rec, cached);
        queueCacheHit(text, cached);
        instantHits++;
      } else {
        viewIo.observe(el);
        io.observe(el);
      }
    }
    if (instantHits) paint();
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
      notice = '';
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
      const retryMs = isNanoOnly() ? 60000 : 5000;
      retryTimer = setTimeout(() => {
        notice = '';
        for (const r of records.values()) if (r.failed && !r.result) { r.failed = false; r.tag?.setVisible(settings.showTags); r.queued = true; queue.push(r); }
        flushSoon();
      }, retryMs);
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

  // Local only or offline: Gemini Nano handles one prompt at a time and large batches can exceed
  // its time budget on slower machines. Score visible headlines one-by-one and skip items scrolled far past.
  const isNanoOnly = () => settings.localOnly || (typeof navigator !== 'undefined' && navigator.onLine === false);

  function priorityKey(rec) {
    if (rec.inView) {
      const r = rec.el?.isConnected ? rec.el.getBoundingClientRect() : null;
      return r ? Math.max(0, r.top) : 0;
    }
    return 100000 + byDistance(rec);
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    // up to PARALLEL batches at once online (1 at a time on Nano), viewport headlines strictly first
    const running = new Set();
    while (queue.length || running.size) {
      const nano = isNanoOnly();
      const maxParallel = nano ? 1 : PARALLEL;
      const batchSize = nano ? 1 : BATCH;
      while (queue.length && running.size < maxParallel) {
        // Resolve any duplicate/newly-cached headlines in 0 ms and drop far-scrolled-past items in Nano mode.
        const maxOffscreen = innerHeight * 1.5;
        for (let i = queue.length - 1; i >= 0; i--) {
          const rec = queue[i];
          if (!rec.el?.isConnected || !records.has(rec.el)) {
            rec.queued = false;
            queue.splice(i, 1);
            continue;
          }
          const cached = localCache.get(rec.text);
          if (cached && (!rec.result || rec.result.source === 'mock')) {
            rec.queued = false;
            queue.splice(i, 1);
            stats.hits++;
            stats.scored++;
            applyResult(rec, cached);
            queueCacheHit(rec.text, cached);
            continue;
          }
          if (nano && !rec.inView && byDistance(rec) > maxOffscreen) {
            // User scrolled far past this headline: deprioritize it now, re-observe so scroll-back re-queues it.
            rec.queued = false;
            queue.splice(i, 1);
            io.observe(rec.el);
          }
        }
        if (!queue.length) break;
        queue.sort((x, y) => priorityKey(x) - priorityKey(y));
        const job = scoreBatch(queue.splice(0, batchSize)).finally(() => running.delete(job));
        running.add(job);
      }
      if (!running.size) break;
      await Promise.race(running);
    }
    flushing = false;
    paint();
    refreshOrb();
  }

  function applyResult(rec, result) {
    if (!records.has(rec.el) || !result) return;
    rec.queued = false;
    if (result.source !== 'mock') {
      viewIo.unobserve(rec.el);
      localCache.set(rec.text, result);
    }
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
    if (!rec?.result || rec.result.kind === 'clean' || rec.animating) return;
    swapToRewrite(rec).then(() => { paint(); refreshOrb(); });
    setTimeout(() => rec.tag?.setDebaited(true, rec.result), 240);
    if (rec.result.source !== 'mock') send({ type: 'debait/debaited', texts: [rec.text] });
    refreshOrb();
  }

  function restoreOne(rec) {
    if (!rec?.result || rec.animating) return;
    swapToOriginal(rec).then(() => { paint(); refreshOrb(); });
    setTimeout(() => rec.tag?.setDebaited(false, rec.result), 240);
    refreshOrb();
  }

  function distanceFrom(origin, el) {
    const b = el.getBoundingClientRect();
    return Math.hypot(b.left + b.width / 2 - origin.x, b.top + b.height / 2 - origin.y);
  }

  let pageDebaited = false; // after "Debait this page", until the originals are restored
  let togglingPage = false; // prevents overlapping debait/restore animations on rapid clicks
  function toggleDebaitPage(origin) {
    if (togglingPage) return;
    closeCard();
    orb.pulse();
    const all = [...records.values()].filter((r) => r.result);
    const bait = all.filter((r) => r.state === 'scored' && r.result.kind !== 'clean');
    const done = all.filter((r) => r.state === 'debaited');

    if (bait.length) {
      togglingPage = true;
      pageDebaited = true;
      // the wave rolls out from the orb; each headline decodes when the wave reaches it
      const { R, duration } = playRipple(origin);
      const jobs = bait.map((rec) => {
        const delay = duration ? Math.min(1, distanceFrom(origin, rec.el) / R) * duration * 0.75 : 0;
        setTimeout(() => rec.tag?.setDebaited(true, rec.result), delay + 240);
        return swapToRewrite(rec, { delay });
      });
      refreshOrb();
      Promise.all(jobs).finally(() => { togglingPage = false; paint(); refreshOrb(); });
      const real = bait.filter((r) => r.result.source !== 'mock').map((r) => r.text);
      if (real.length) send({ type: 'debait/debaited', texts: real });
    } else if (done.length) {
      togglingPage = true;
      pageDebaited = false;
      // undo: the wave flows back into the orb
      const { R, duration } = playRipple(origin, { undo: true });
      const jobs = done.map((rec) => {
        const delay = duration ? (1 - Math.min(1, distanceFrom(origin, rec.el) / R)) * duration * 0.6 : 0;
        setTimeout(() => rec.tag?.setDebaited(false, rec.result), delay + 240);
        return swapToOriginal(rec, { delay });
      });
      refreshOrb();
      Promise.all(jobs).finally(() => { togglingPage = false; paint(); refreshOrb(); });
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
    panel.syncSettings?.(next, prev);
    if (prev.localOnly !== next.localOnly && notice) { clearTimeout(retryTimer); notice = ''; for (const r of records.values()) if (r.failed && !r.result) { r.failed = false; r.tag?.setVisible(next.showTags); r.queued = true; queue.push(r); } flushSoon(); }
    if (prev.voice && !next.voice && lastCallState !== 'error') onCallState({ state: 'ended' });
    if (prev.showTags !== next.showTags) {
      for (const r of records.values()) r.tag?.setVisible(next.showTags);
      paint();
    }
  });

  // When connectivity returns after offline browsing, upgrade placeholder/failed headlines immediately.
  function onOnline() {
    if (!alive) return;
    clearTimeout(retryTimer);
    clearTimeout(upgradeTimer);
    upgradeTimer = null;
    upgradeDelay = 21000;
    notice = '';
    let n = 0;
    for (const r of records.values()) {
      if ((r.failed && !r.result) || (r.state === 'scored' && r.result?.source === 'mock')) {
        r.failed = false;
        r.upgrades = 0;
        r.tag?.setVisible(settings.showTags);
        if (!r.queued) { r.queued = true; queue.push(r); n++; }
      }
    }
    if (n) flushSoon();
  }
  addEventListener('online', onOnline);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'debait/summary-chunk') {
      summarySoFar = msg.text;
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
