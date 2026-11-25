import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BAIT_THRESHOLD,
  CACHE_VERSION,
  NO_SAFE_REWRITE,
  NO_SUMMARY_TEXT,
  isCacheEntryValid,
  validateRewriteIntegrity,
  normalizeResult,
  hasEnoughSummaryText,
  isSummaryRefusal,
} from '../src/engine/contract.js';
import {
  verifyInferenceSource,
  expandNanoItem,
  ENABLE_HEDGING,
  projectOrder,
  cancelActiveCloudRequests,
} from '../src/engine/firebaseEngine.js';
import { LIVE_VOICE, ALLOW_BACKUP_FALLBACK, FIREBASE_PROJECTS } from '../src/engine/firebaseConfig.js';
import { liveProjectOrder, withConnectTimeout } from '../src/offscreen/call.js';
import { SITES, EXCLUDED_SITES } from '../manifest.config.js';
import { isPrivateHost } from '../src/content/sites/index.js';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/headlines.json', import.meta.url), 'utf8'));

test('P0-1: Local Only cache isolation rejects cloud and mock entries', () => {
  const cloudEntry = { kind: 'rage', score: 85, triggers: [{ word: 'DESTROYS', why: 'fight' }], honest_rewrite: 'Criticizes', source: 'cloud' };
  const localEntry = { ...cloudEntry, source: 'on-device' };
  const mockEntry = { ...cloudEntry, source: 'mock' };

  assert.equal(CACHE_VERSION >= 5, true);
  assert.equal(isCacheEntryValid(cloudEntry, false), true);
  assert.equal(isCacheEntryValid(cloudEntry, true), false, 'cloud cache must never be served when localOnly is true');
  assert.equal(isCacheEntryValid(localEntry, true), true);
  assert.equal(isCacheEntryValid(mockEntry, false), false, 'mock entries must never be served from cache');
  assert.equal(isCacheEntryValid(mockEntry, true), false);
});

test('P0-2: Voice removes global WebSocket monkeypatch, tries enforced Team first, keeps LIVE_VOICE', () => {
  assert.equal(LIVE_VOICE, 'Leda');
  assert.equal(ALLOW_BACKUP_FALLBACK, true);
  assert.equal(FIREBASE_PROJECTS[0].appCheckEnforced, true);
  assert.equal(projectOrder()[0], 0, 'projectOrder must always try App Check-enforced Team project first');
  const callSrc = fs.readFileSync('src/offscreen/call.js', 'utf8');
  assert.equal(callSrc.includes('WebSocket.prototype.send'), false, 'global WebSocket.prototype monkeypatch must be removed');
});

test('P0-3: No silent mock fallback in production engine and mock is labeled non-AI', () => {
  const idxSrc = fs.readFileSync('src/engine/index.js', 'utf8');
  assert.ok(idxSrc.includes('OFFLINE_UNAVAILABLE'), 'offline without Nano must surface honest unavailable error');
  assert.ok(idxSrc.includes('AI_UNAVAILABLE'), 'cloud failure must surface honest unavailable error');
  assert.equal(idxSrc.includes('return mockEngine.scoreHeadlines'), false, 'production scoreHeadlines must not silently fall back to mockEngine');
  const iconsSrc = fs.readFileSync('src/content/ui/icons.js', 'utf8');
  assert.ok(iconsSrc.includes('Heuristic estimate — not AI'));
});

test('P0-4: Rewrite integrity gate rejects invented facts, numbers, and polarity flips across balanced fixtures', () => {
  for (const item of fixtures) {
    if (item.expected === 'clean') {
      const res = normalizeResult({ kind: 'clean', score: 5, triggers: [], honest_rewrite: item.text, source: 'on-device' }, item.text);
      assert.equal(res.kind, 'clean');
      assert.equal(res.honest_rewrite, item.text);
      continue;
    }
    const unsafeCheck = validateRewriteIntegrity(item.text, item.unsafe_rewrite);
    assert.equal(unsafeCheck.ok, false, `Expected unsafe rewrite rejected for ${item.id}: ${item.unsafe_rewrite}`);

    const rejected = normalizeResult(
      { kind: item.expected, score: 85, triggers: item.triggers, honest_rewrite: item.unsafe_rewrite, source: 'cloud' },
      item.text,
    );
    assert.equal(rejected.kind, item.expected);
    assert.equal(rejected.rewrite_safe, false);
    assert.equal(rejected.honest_rewrite, NO_SAFE_REWRITE);

    const safeCheck = validateRewriteIntegrity(item.text, item.safe_rewrite);
    assert.equal(safeCheck.ok, true, `Expected safe rewrite accepted for ${item.id}: ${item.safe_rewrite} (got ${safeCheck.reason})`);

    const accepted = normalizeResult(
      { kind: item.expected, score: 85, triggers: item.triggers, honest_rewrite: item.safe_rewrite, source: 'on-device' },
      item.text,
    );
    assert.equal(accepted.rewrite_safe, true);
    assert.equal(accepted.honest_rewrite, item.safe_rewrite);
  }
});

test('P1-5: Summarizer enforces sparse check, refusal filter, explicit opt-in, and sensitive host protection', () => {
  assert.equal(hasEnoughSummaryText({ kind: 'article', title: 'Login', text: '', headlines: [] }), false);
  assert.equal(hasEnoughSummaryText({ kind: 'feed', title: 'Empty', text: '', headlines: ['One', 'Two'] }), false);
  assert.equal(hasEnoughSummaryText({ kind: 'article', title: 'News', text: 'A'.repeat(320), headlines: [] }), true);
  assert.equal(isSummaryRefusal('I am sorry, but you did not provide an article to summarize.'), true);
  assert.equal(isSummaryRefusal('Central bank raised interest rates by 0.25%.'), false);
  assert.equal(NO_SUMMARY_TEXT, 'Not enough text on this page to summarize.');

  const settingsSrc = fs.readFileSync('src/content/ui/settings.js', 'utf8');
  assert.ok(settingsSrc.includes('Summarize this page'), 'Settings panel must require explicit opt-in button');
  assert.equal(/loadEngine\(\);\s*\n\s*summarize\(\);/.test(settingsSrc), false, 'Panel open must not auto-upload page paragraphs');
});

test('P1-6: Source provenance normalizes casing/omission and rejects cross-route mismatches', () => {
  assert.equal(verifyInferenceSource('on_device', 'on-device'), 'on-device');
  assert.equal(verifyInferenceSource('ON_DEVICE', 'on-device'), 'on-device');
  assert.equal(verifyInferenceSource('on-device', 'on-device'), 'on-device');
  assert.equal(verifyInferenceSource(undefined, 'on-device'), 'on-device');
  assert.equal(verifyInferenceSource('in_cloud', 'cloud'), 'cloud');
  assert.equal(verifyInferenceSource('IN_CLOUD', 'cloud'), 'cloud');
  assert.equal(verifyInferenceSource(undefined, 'cloud'), 'cloud');
  assert.throws(() => verifyInferenceSource('on_device', 'cloud'), /SOURCE_MISMATCH/);
  assert.throws(() => verifyInferenceSource('in_cloud', 'on-device'), /SOURCE_MISMATCH/);
  assert.throws(() => verifyInferenceSource('unknown', 'cloud'), /SOURCE_MISMATCH/);
});

test('P1-7: Hedging disabled by default and cloud cancellation helper exists', () => {
  assert.equal(ENABLE_HEDGING, false);
  assert.equal(typeof cancelActiveCloudRequests, 'function');
  cancelActiveCloudRequests(); // safe no-op when empty
});

test('P1-9: Manifest excludes private/IDE hosts and Trusted Types are protected', () => {
  assert.ok(SITES.includes('https://*/*'));
  assert.ok(EXCLUDED_SITES.includes('*://*.github.dev/*'), 'must exclude github.dev');
  assert.ok(EXCLUDED_SITES.includes('*://mail.google.com/*'), 'must exclude Gmail');
  assert.equal(isPrivateHost('fantastic-space-123.github.dev'), true);
  assert.equal(isPrivateHost('mail.google.com'), true);
  assert.equal(isPrivateHost('www.bbc.com'), false);
  assert.equal(isPrivateHost('www.youtube.com'), false);
  assert.equal(isPrivateHost('x.com'), false);
  const htmlSrc = fs.readFileSync('src/content/ui/html.js', 'utf8');
  assert.ok(htmlSrc.includes('defaultPolicy') && htmlSrc.includes('try {\n    el.innerHTML'));
});

test('Nano compact expansion integrates cleanly with strict rewrite-safety normalization', () => {
  const clean = normalizeResult(expandNanoItem({ k: 'c', s: 0 }, 'Continue on another device'), 'Continue on another device');
  assert.equal(clean.kind, 'clean');
  assert.equal(clean.score < BAIT_THRESHOLD, true);

  const bait = normalizeResult(
    expandNanoItem({ k: 'r', s: 88, t: ['DESTROYS', 'brutal'], w: 'Senator sharply criticizes reporter in video clip' }, 'Senator DESTROYS reporter in brutal clip'),
    'Senator DESTROYS reporter in brutal clip',
  );
  assert.equal(bait.kind, 'rage');
  assert.equal(bait.rewrite_safe, true);
  assert.equal(bait.source, 'on-device');
});

test('P2-11: AudioWorklet ring buffer, optimistic mute, and WebGL restoreContext guard remain intact', () => {
  const worklet = fs.readFileSync('public/voice-worklets.js', 'utf8');
  assert.ok(worklet.includes('new Float32Array(this.capacity)') && worklet.includes("data === 'flush'"));
  assert.ok(worklet.includes('inputSampleRate'), 'DebaitPlayer must support hardware sample-rate fallback');
  const orbGl = fs.readFileSync('src/content/ui/orb-gl.js', 'utf8');
  assert.ok(orbGl.includes('lostByUs') && orbGl.includes('canRestore') && orbGl.includes('gl.isContextLost()'));
});

test('Network, Call, and Local resilience regressions', async () => {
  // Call: prefers Live-compatible non-App-Check project first without breaking HTTP projectOrder()
  assert.equal(projectOrder()[0], 0);
  const liveOrder = liveProjectOrder([0, 1]);
  assert.equal(liveOrder[0], 1, 'Live WebSocket order must try non-App-Check-enforced project first');
  assert.deepEqual(liveOrder, [1, 0]);

  // Call: withConnectTimeout closes late-resolving WebSocket sessions
  let closed = false;
  let resolveLate;
  const late = new Promise((r) => { resolveLate = r; });
  await assert.rejects(() => withConnectTimeout(late, 10), /timed out/i);
  resolveLate({ close: async () => { closed = true; } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(closed, true, 'late WebSocket session must be closed after timeout');

  // Local: nanoItemSchema must not include maxItems (incompatible with some Chrome Prompt API builds)
  const engineSrc = fs.readFileSync('src/engine/firebaseEngine.js', 'utf8');
  assert.equal(engineSrc.includes('maxItems'), false, 'nanoItemSchema must omit maxItems');
  assert.ok(engineSrc.includes('directNanoBroken'), 'direct Nano fallback must avoid repeating broken calls');
  assert.ok(engineSrc.includes('/app ?check|401|403'), 'isAuth must match Firebase appCheck/* codes without a space');

  // Network: retry cooldown in engine/index.js must be shorter than content/main.js online retry delay
  const idxSrc = fs.readFileSync('src/engine/index.js', 'utf8');
  assert.ok(idxSrc.includes('RETRY_SOON = 5 * 1000'));
  assert.ok(idxSrc.includes('LOCAL_ONLY_SWITCH'));
});
