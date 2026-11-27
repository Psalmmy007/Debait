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
  LIVE_VOICE,
  ALLOW_BACKUP_FALLBACK,
  FIREBASE_PROJECTS,
  LIVE_TOKEN_FUNCTION,
  FUNCTIONS_REGION,
  ENABLE_LIVE_VOICE,
  VOICE_GATED_MESSAGE,
} from '../src/engine/firebaseConfig.js';
import { VOICE_ENABLED } from '../src/shared/release.js';
import { withConnectTimeout, buildConstrainedWsUrl, classifyCallError } from '../src/offscreen/call.js';
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

test('P0-2: Release disables unprotected backup project across scoring and voice while keeping LIVE_VOICE', () => {
  assert.equal(LIVE_VOICE, 'Leda');
  assert.equal(ALLOW_BACKUP_FALLBACK, false, 'release builds must disable unprotected backup fallback');
  assert.equal(FIREBASE_PROJECTS.length, 1, 'release config must contain only the primary App Check-enforced project');
  assert.equal(FIREBASE_PROJECTS[0].config.projectId, 'debait-d6d5d');
  assert.equal(FIREBASE_PROJECTS[0].appCheckEnforced, true);

  const cfgSrc = fs.readFileSync('src/engine/firebaseConfig.js', 'utf8');
  assert.equal(cfgSrc.includes('axi-chat-2026'), false, 'secondary unprotected project must not exist in release config');

  const callSrc = fs.readFileSync('src/offscreen/call.js', 'utf8');
  assert.equal(callSrc.includes('WebSocket.prototype.send'), false, 'global WebSocket.prototype monkeypatch must be removed');
});

test('P0-3: No silent mock fallback in production engine', () => {
  const runtimeSrc = fs.readFileSync('src/engine/runtime.js', 'utf8');
  const idxSrc = fs.readFileSync('src/engine/index.js', 'utf8');
  assert.ok(idxSrc.includes('export const USE_MOCK = DEMO_MODE;'), 'mock mode must require explicit DEMO_MODE');
  assert.ok(runtimeSrc.includes('if (demo && !opts.localOnly) return await mockEngine.scoreHeadlines'), 'mock engine must only run in explicit demo mode when not localOnly');
  assert.ok(runtimeSrc.includes("throw new Error('Gemini returned an invalid inference source or incomplete results.')"));
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

    const safeCheck = validateRewriteIntegrity(item.text, item.safe_rewrite);
    assert.equal(safeCheck.ok, true, `Expected safe rewrite accepted for ${item.id}: ${item.safe_rewrite} (got ${safeCheck.reason})`);
  }
  assert.equal(BAIT_THRESHOLD, 60);
  assert.equal(NO_SAFE_REWRITE, 'No verified neutral rewrite available');
});

test('P1-5: Summary guards enforce sparse check and refusal filter', () => {
  assert.equal(hasEnoughSummaryText({ kind: 'article', title: 'Login', text: '', headlines: [] }), false);
  assert.equal(hasEnoughSummaryText({ kind: 'feed', title: 'Empty', text: '', headlines: ['One', 'Two'] }), false);
  assert.equal(hasEnoughSummaryText({ kind: 'article', title: 'News', text: 'A'.repeat(320), headlines: [] }), true);
  assert.equal(isSummaryRefusal('I am sorry, but you did not provide an article to summarize.'), true);
  assert.equal(isSummaryRefusal('Central bank raised interest rates by 0.25%.'), false);
  assert.equal(NO_SUMMARY_TEXT, 'Not enough text on this page to summarize.');
});

test('P1-9: Broad news/web support preserved while excluding webmail, banking, code hosts, workspaces, and localhost dev tools + Trusted Types/CSP safe', () => {
  assert.ok(SITES.includes('https://*/*') && SITES.includes('http://*/*'));
  for (const pat of EXCLUDED_SITES) {
    assert.match(pat, /^(\*|https?):\/\/[^/:]+\/.*$/, `Invalid MV3 match pattern: ${pat}`);
  }
  assert.equal(manifest.content_security_policy, undefined);

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

  assert.equal(isSensitivePage({ querySelector: () => null }, { hostname: 'localhost', pathname: '/dashboard' }), true);
  assert.equal(isSensitivePage({ querySelector: (s) => (s === '[data-debait-headline]' ? {} : null) }, { hostname: 'localhost', pathname: '/' }), false);

  for (const allowed of ['www.bbc.com', 'www.reuters.com', 'www.nytimes.com', 'www.theguardian.com', 'www.google.com', 'www.youtube.com', 'x.com']) {
    assert.equal(isPrivateHost(allowed), false, `Expected general web/news host ${allowed} to stay allowed`);
    assert.notEqual(getAdapter(allowed).name, 'off');
  }

  const htmlSrc = fs.readFileSync('src/content/ui/html.js', 'utf8');
  assert.ok(htmlSrc.includes('defaultPolicy') && /try\s*\{\s*el\.innerHTML/.test(htmlSrc));
  assert.ok(htmlSrc.includes('CSSStyleSheet') && !htmlSrc.includes('eval('));
});

test('P2-11: WebGL restoreContext guard and Google Search upright tag fixes remain intact', async () => {
  const orbGl = fs.readFileSync('src/content/ui/orb-gl.js', 'utf8');
  assert.ok(orbGl.includes('lostByUs') && orbGl.includes('canRestore') && orbGl.includes('gl.isContextLost()'));

  const sitesSrc = fs.readFileSync('src/content/sites/index.js', 'utf8');
  assert.ok(sitesSrc.includes("el.closest('.yuRUbf')"), 'Google adapter must place tags outside scaleY(-1) link wrappers');
  const tagSrc = fs.readFileSync('src/content/ui/tag.js', 'utf8');
  assert.ok(tagSrc.includes('hasVerticalFlip') && tagSrc.includes('scaleY(-1)'), 'tag.js must counter-flip if mounted inside a vertically flipped ancestor');

  // Call: withConnectTimeout closes late-resolving WebSocket sessions
  let closed = false;
  let resolveLate;
  const late = new Promise((r) => { resolveLate = r; });
  await assert.rejects(() => withConnectTimeout(late, 10), /timed out/i);
  resolveLate({ close: async () => { closed = true; } });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(closed, true, 'late WebSocket session must be closed after timeout');
});

test('Ephemeral Live voice token endpoint enforces App Check and maps errors accurately', () => {
  assert.equal(LIVE_VOICE, 'Leda');
  assert.equal(LIVE_TOKEN_FUNCTION, 'mintLiveVoiceToken');
  assert.equal(FUNCTIONS_REGION, 'us-central1');

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

  const wsUrl = buildConstrainedWsUrl('auth_tokens/abc+123');
  assert.ok(wsUrl.startsWith('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token='));
  assert.equal(wsUrl.includes('?key='), false, 'ephemeral tokens must use access_token, not key');
  assert.ok(wsUrl.includes(encodeURIComponent('auth_tokens/abc+123')));

  assert.match(classifyCallError(new Error('APP_CHECK_ERROR: invalid token'), true), /App Check/i);
  assert.match(classifyCallError({ code: 'functions/unauthenticated', message: 'Unauthenticated' }, true), /App Check/i);
  assert.match(classifyCallError(new Error('TOKEN_ENDPOINT_NOT_FOUND: 404'), true), /not deployed/i);
  assert.match(classifyCallError({ code: 'functions/resource-exhausted', message: 'rate limit' }, true), /Too many voice requests/i);
  assert.match(classifyCallError(new Error('TOKEN_MINT_ERROR: missing secret'), true), /mint a voice session token/i);
  assert.match(classifyCallError(new Error('OFFLINE: no network'), false), /internet connection/i);
});

test('Voice Release Gate: LIVE_VOICE and Cloud Function stay intact while release build excludes voice', () => {
  assert.equal(LIVE_VOICE, 'Leda');
  assert.equal(ENABLE_LIVE_VOICE, false, 'release build must keep ENABLE_LIVE_VOICE = false');
  assert.equal(VOICE_ENABLED, false, 'release build must keep VOICE_ENABLED = false');
  assert.equal(VOICE_GATED_MESSAGE, 'Voice requires ephemeral token backend under App Check');
  assert.equal(fs.existsSync('functions/index.js'), true, 'Cloud Function implementation must remain intact');

  const callSrc = fs.readFileSync('src/offscreen/call.js', 'utf8');
  assert.ok(callSrc.includes('ENABLE_LIVE_VOICE') && callSrc.includes('VOICE_GATED_MESSAGE'), 'call.js must enforce ENABLE_LIVE_VOICE gate');

  const popupHtml = fs.readFileSync('src/popup/index.html', 'utf8');
  assert.equal(popupHtml.includes('backup engine'), false, 'popup setup copy must not claim a backup engine fallback');
  assert.equal(popupHtml.includes('data-setting="voice"'), false, 'release popup must not expose voice toggle');
});

test('P3: Mode isolation rejects late cloud/mock results under Local Only', () => {
  const cloudRes = { kind: 'rage', score: 84, triggers: [{ word: 'SHOCKING', why: 'hype' }], honest_rewrite: 'Report released', source: 'cloud' };
  const localRes = { ...cloudRes, source: 'on-device' };
  const mockRes = { ...cloudRes, source: 'mock' };

  assert.equal(isResultAllowedInMode(cloudRes, true), false);
  assert.equal(isResultAllowedInMode(mockRes, true), false);
  assert.equal(isResultAllowedInMode(localRes, true), true);
  assert.equal(isResultAllowedInMode(cloudRes, false), true);
  assert.equal(isResultAllowedInMode(localRes, false), true);

  const swSrc = fs.readFileSync('src/background/sw.js', 'utf8');
  assert.ok(swSrc.includes('privacyRevision') && swSrc.includes('debait/cancel-inference'), 'sw.js must invalidate and cancel in-flight inference when Local Only changes');
  assert.ok(swSrc.includes('isPrivateHost'), 'sw.js injectOpenTabs must skip sensitive/private hosts');
});
