import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BAIT_THRESHOLD,
  CACHE_VERSION,
  NO_SAFE_REWRITE,
  NO_SUMMARY_TEXT,
  isCacheEntryValid,
  isResultAllowedInMode,
  validateRewriteIntegrity,
  normalizeResult,
  hasEnoughSummaryText,
  isSummaryRefusal,
} from '../src/engine/contract.js';
import {
  verifyInferenceSource,
  expandNanoItem,
  ENABLE_HEDGING,
  isProjectAllowed,
  projectOrder,
  preferredProject,
  setPreferredProject,
  getAi,
  withCloudTimeout,
  cancelActiveCloudRequests,
} from '../src/engine/firebaseEngine.js';
import { LIVE_VOICE, ALLOW_BACKUP_FALLBACK, FIREBASE_PROJECTS, LIVE_TOKEN_FUNCTION, FUNCTIONS_REGION, ENABLE_LIVE_VOICE, VOICE_GATED_MESSAGE } from '../src/engine/firebaseConfig.js';
import { liveProjectOrder, withConnectTimeout, buildConstrainedWsUrl, classifyCallError } from '../src/offscreen/call.js';
import manifest, { SITES, EXCLUDED_SITES } from '../manifest.config.js';
import { isPrivateHost, isSensitivePage, getAdapter } from '../src/content/sites/index.js';

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

test('P0-2: Release disables unprotected backup project across scoring, summaries, and voice while keeping LIVE_VOICE', () => {
  assert.equal(LIVE_VOICE, 'Leda');
  assert.equal(ALLOW_BACKUP_FALLBACK, false, 'release builds must disable unprotected backup fallback');
  assert.equal(FIREBASE_PROJECTS[0].projectId || FIREBASE_PROJECTS[0].config.projectId, 'debait-d6d5d');
  assert.equal(FIREBASE_PROJECTS[0].appCheckEnforced, true);
  assert.equal(FIREBASE_PROJECTS[1].appCheckEnforced, false);

  // Project policy enforcement: only App Check-enforced primary project (0) is permitted
  assert.equal(isProjectAllowed(0), true);
  assert.equal(isProjectAllowed(1), false, 'unprotected backup project must be disallowed');
  assert.deepEqual(projectOrder(), [0], 'projectOrder must never route to unprotected backup project');
  assert.deepEqual(liveProjectOrder([0, 1]), [0], 'liveProjectOrder must never route voice to unprotected backup project');
  assert.deepEqual(liveProjectOrder([1]), [0], 'liveProjectOrder must fall back to permitted primary project only');

  // Stale engineMemory.prefer = 1 from older sessions must be sanitized back to 0
  setPreferredProject(1);
  assert.equal(preferredProject(), 0, 'setPreferredProject(1) must be rejected when backup is disabled');
  assert.throws(() => getAi('test-token', 1), /PROJECT_NOT_ALLOWED/, 'getAi must refuse to initialize disabled backup project');

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

test('P1-9: Broad news/web support preserved while excluding webmail, banking, code hosts, workspaces, and localhost dev tools + Trusted Types/CSP safe', () => {
  // Broad web matching retained for general news & search testing
  assert.ok(SITES.includes('https://*/*') && SITES.includes('http://*/*'));
  // Every exclude_matches entry must be a valid MV3 match pattern (no port numbers)
  for (const pat of EXCLUDED_SITES) {
    assert.match(pat, /^(\*|https?):\/\/[^/:]+\/.*$/, `Invalid MV3 match pattern: ${pat}`);
  }
  // Manifest must not weaken extension CSP
  assert.equal(manifest.content_security_policy, undefined);

  // Spot-check required sensitive categories in exclude_matches
  for (const required of [
    '*://mail.google.com/*',
    '*://outlook.live.com/*',
    '*://mail.yahoo.com/*',
    '*://*.chase.com/*',
    '*://*.paypal.com/*',
    '*://github.com/*',
    '*://*.github.dev/*',
    '*://gitlab.com/*',
    '*://replit.com/*',
    '*://*.vscode.dev/*',
    '*://docs.google.com/*',
    '*://*.notion.so/*',
    '*://*.slack.com/*',
    '*://discord.com/*',
    '*://localhost/admin*',
  ]) {
    assert.ok(EXCLUDED_SITES.includes(required), `EXCLUDED_SITES missing ${required}`);
  }

  // Content-script private-host guards block sensitive apps across all categories
  for (const blocked of [
    'mail.google.com',
    'outlook.live.com',
    'mail.yahoo.com',
    'mail.proton.me',
    'www.chase.com',
    'www.paypal.com',
    'dashboard.stripe.com',
    'github.com',
    'fantastic-space-123.github.dev',
    'gitlab.com',
    'replit.com',
    'vscode.dev',
    'docs.google.com',
    'www.notion.so',
    'app.slack.com',
    'discord.com',
    'api.localhost',
    'console.firebase.google.com',
  ]) {
    assert.equal(isPrivateHost(blocked), true, `Expected ${blocked} to be blocked as private`);
    assert.equal(getAdapter(blocked).name, 'off', `Expected adapter for ${blocked} to be off`);
  }

  // Localhost dev tools blocked by default unless explicitly opted-in as Debait demo page
  assert.equal(isSensitivePage({ querySelector: () => null }, { hostname: 'localhost', pathname: '/dashboard' }), true);
  assert.equal(isSensitivePage({ querySelector: (s) => (s === '[data-debait-headline]' ? {} : null) }, { hostname: 'localhost', pathname: '/' }), false);

  // General news sites, search engines, and social feeds remain allowed
  for (const allowed of ['www.bbc.com', 'www.reuters.com', 'www.nytimes.com', 'www.theguardian.com', 'www.google.com', 'www.youtube.com', 'x.com']) {
    assert.equal(isPrivateHost(allowed), false, `Expected general web/news host ${allowed} to stay allowed`);
    assert.notEqual(getAdapter(allowed).name, 'off');
  }

  // Trusted Types and Shadow DOM CSS compatibility without weakening host CSP
  const htmlSrc = fs.readFileSync('src/content/ui/html.js', 'utf8');
  assert.ok(htmlSrc.includes('defaultPolicy') && htmlSrc.includes('try {\n    el.innerHTML'));
  assert.ok(htmlSrc.includes('CSSStyleSheet') && !htmlSrc.includes('eval('));
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
  // Release policy: both HTTP projectOrder() and Live liveProjectOrder() permit only primary App Check project (0)
  assert.deepEqual(projectOrder(), [0]);
  assert.deepEqual(liveProjectOrder([0, 1]), [0]);

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

  // Google Search: avoid inverted tags inside span.V9tjod scaleY(-1) wrappers
  const sitesSrc = fs.readFileSync('src/content/sites/index.js', 'utf8');
  assert.ok(sitesSrc.includes("el.closest('.yuRUbf')"), 'Google adapter must place tags outside scaleY(-1) link wrappers');
  const tagSrc = fs.readFileSync('src/content/ui/tag.js', 'utf8');
  assert.ok(tagSrc.includes('hasVerticalFlip') && tagSrc.includes('scaleY(-1)'), 'tag.js must counter-flip if mounted inside a vertically flipped ancestor');
});

test('Ephemeral Live voice token endpoint enforces App Check and maps errors accurately', () => {
  assert.equal(LIVE_VOICE, 'Leda');
  assert.equal(LIVE_TOKEN_FUNCTION, 'mintLiveVoiceToken');
  assert.equal(FUNCTIONS_REGION, 'us-central1');

  // Cloud Function v2 enforces App Check + Secret Manager GEMINI_API_KEY + Leda voice constraint + v1beta parity
  const fnSrc = fs.readFileSync('functions/index.js', 'utf8');
  const handlerSrc = fs.readFileSync('functions/mintHandler.js', 'utf8');
  assert.ok(fnSrc.includes('enforceAppCheck: true'), 'mintLiveVoiceToken must enforce App Check');
  assert.ok(fnSrc.includes("defineSecret('GEMINI_API_KEY')"), 'must read Gemini API key from Secret Manager');
  assert.ok(fnSrc.includes('maxInstances: 5'), 'must cap Cloud Function maxInstances');
  assert.ok(handlerSrc.includes("LIVE_VOICE = 'Leda'"), 'must preserve LIVE_VOICE = Leda');
  assert.ok(handlerSrc.includes("EPHEMERAL_API_VERSION = 'v1beta'"), 'backend must mint v1beta ephemeral tokens');
  assert.ok(handlerSrc.includes('uses: 1'), 'ephemeral tokens must be single-use');

  const rc = JSON.parse(fs.readFileSync('.firebaserc', 'utf8'));
  assert.equal(rc.projects.default, 'debait-d6d5d');

  // Constrained WebSocket URL defaults to v1beta and uses access_token query param (never key=)
  const wsUrl = buildConstrainedWsUrl('auth_tokens/abc+123');
  assert.ok(wsUrl.startsWith('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token='));
  assert.equal(wsUrl.includes('?key='), false, 'ephemeral tokens must use access_token, not key');
  assert.ok(wsUrl.includes(encodeURIComponent('auth_tokens/abc+123')));

  // Accurate error classification (never misleads with generic "check your internet" on App Check/token/rate-limit failure)
  assert.match(classifyCallError(new Error('APP_CHECK_ERROR: invalid token'), true), /App Check/i);
  assert.match(classifyCallError({ code: 'functions/unauthenticated', message: 'Unauthenticated' }, true), /App Check/i);
  assert.match(classifyCallError(new Error('TOKEN_ENDPOINT_NOT_FOUND: 404'), true), /not deployed/i);
  assert.match(classifyCallError({ code: 'functions/resource-exhausted', message: 'rate limit' }, true), /Too many voice requests/i);
  assert.match(classifyCallError(new Error('TOKEN_MINT_ERROR: missing secret'), true), /mint a voice session token/i);
  assert.match(classifyCallError(new Error('OFFLINE: no network'), false), /internet connection/i);
});

test('Voice Release Gate: LIVE_VOICE and Cloud Function stay intact while release trigger is honestly gated', () => {
  assert.equal(LIVE_VOICE, 'Leda');
  assert.equal(ENABLE_LIVE_VOICE, false, 'release build must gate live voice until ephemeral token backend is deployed');
  assert.equal(VOICE_GATED_MESSAGE, 'Voice requires ephemeral token backend under App Check');
  assert.equal(fs.existsSync('functions/index.js'), true, 'Cloud Function implementation must remain intact');

  for (const file of ['src/offscreen/call.js', 'src/background/sw.js', 'src/content/main.js', 'src/content/ui/settings.js', 'src/popup/popup.js']) {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(src.includes('ENABLE_LIVE_VOICE') && src.includes('VOICE_GATED_MESSAGE'), `${file} must enforce ENABLE_LIVE_VOICE gate`);
  }
  const overlaySrc = fs.readFileSync('src/content/ui/overlay.js', 'utf8');
  assert.ok(overlaySrc.includes('ENABLE_LIVE_VOICE') && overlaySrc.includes("<em><kbd>2×</kbd> settings</em>"), 'orb tooltip must hide 3x talk hint when voice is gated');
  const popupHtml = fs.readFileSync('src/popup/index.html', 'utf8');
  assert.equal(popupHtml.includes('backup engine'), false, 'popup setup copy must not claim a backup engine fallback');
  const engineSrc = fs.readFileSync('src/engine/firebaseEngine.js', 'utf8');
  assert.ok(engineSrc.includes('const needsAppCheck = !localOnly && skipUntil[0] > Date.now()'), 'getStatus must surface needsAppCheck whenever primary project is App Check blocked');
});

test('P3: Local Only in-flight cancellation aborts active cloud work, blocks late cloud renders/cache/stats, and recovers cleanly when toggled OFF', async () => {
  const cloudRes = { kind: 'rage', score: 84, triggers: [{ word: 'SHOCKING', why: 'hype' }], honest_rewrite: 'Report released', source: 'cloud' };
  const localRes = { ...cloudRes, source: 'on-device' };
  const mockRes = { ...cloudRes, source: 'mock' };

  // Mode guard rejects late cloud/mock responses once Local Only is ON, accepts on-device, and re-allows cloud when OFF
  assert.equal(isResultAllowedInMode(cloudRes, true), false);
  assert.equal(isResultAllowedInMode(mockRes, true), false);
  assert.equal(isResultAllowedInMode(localRes, true), true);
  assert.equal(isResultAllowedInMode(cloudRes, false), true);
  assert.equal(isResultAllowedInMode(localRes, false), true);

  // Live async cancellation test: toggling Local Only ON aborts an in-flight cloud request immediately
  let observedAbortReason = null;
  let startedResolve;
  const started = new Promise((r) => { startedResolve = r; });
  const inflight = withCloudTimeout(undefined, (signal) => new Promise((_resolve, reject) => {
    startedResolve();
    signal.addEventListener('abort', () => {
      observedAbortReason = String(signal.reason?.message || signal.reason);
      reject(signal.reason);
    }, { once: true });
  }), 5000);
  await started;
  cancelActiveCloudRequests();
  await assert.rejects(() => inflight, /LOCAL_ONLY_SWITCH/);
  assert.match(observedAbortReason, /LOCAL_ONLY_SWITCH/);

  // Verify service worker re-checks localOnly & modeEpoch after awaiting toEngine() for scoring, summary, and hit stats
  const swSrc = fs.readFileSync('src/background/sw.js', 'utf8');
  assert.ok(swSrc.includes('modeEpoch') && swSrc.includes('switchedToLocal'), 'sw.js must discard late cloud scoring after Local Only toggle');
  assert.ok(swSrc.includes('discarded late cloud summary'), 'sw.js must discard late cloud summaries after Local Only toggle');
  assert.ok(swSrc.includes('isResultAllowedInMode(x?.result, localOnly)'), 'sw.js must filter debait/record-hits by current Local Only mode');

  // Verify content script invalidates in-flight score batches, retries, summaries, and DOM renders via modeGen + recovers when toggled OFF
  const mainSrc = fs.readFileSync('src/content/main.js', 'utf8');
  assert.ok(mainSrc.includes('let modeGen = 0') && mainSrc.includes('gen !== modeGen'), 'main.js must invalidate in-flight batches and retries via modeGen');
  assert.ok(mainSrc.includes('if (!isResultAllowedInMode(result, settings.localOnly)) return;'), 'applyResult must block late cloud DOM render & localCache write');
  assert.ok(mainSrc.includes('!next.localOnly && !r.result && r.el?.isConnected'), 'toggling Local Only OFF must cleanly recover pending headlines');
});
