// Optional native loaded-extension regression. No fake Chrome APIs or Gemini answers.
// Requires a Chrome/Chromium environment that permits unpacked extensions.
const { chromium } = require('playwright');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } = require('node:fs');
const os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const dist = path.resolve(process.env.DEBAIT_EXTENSION_DIR || 'dist');
const out = process.env.DEBAIT_NATIVE_ARTIFACT_DIR || '/tmp/debait-native-extension';
let context;
(async () => { try {
  assert.ok(existsSync(path.join(dist, 'manifest.json')), 'Build the extension first');
  mkdirSync(out, { recursive: true });
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  context = await chromium.launchPersistentContext(mkdtempSync(path.join(os.tmpdir(), 'debait-native-')), {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }), headless: process.env.DEBAIT_HEADED !== '1', viewport: null,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--no-sandbox', `--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  let worker;
  const deadline = Date.now() + 7000;
  while (!worker && Date.now() < deadline) {
    for (const candidate of context.serviceWorkers()) {
      if (!candidate.url().startsWith('chrome-extension://')) continue;
      const ours = await candidate.evaluate(() => chrome.runtime.getManifest().name === 'Debait').catch(() => false);
      if (ours) { worker = candidate; break; }
    }
    if (!worker) await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!worker || !worker.url().startsWith('chrome-extension://')) {
    console.error('BLOCKED: Chromium did not load the unpacked extension. Check managed extension policy/browser support. No native popup, side-panel or Gemini success is claimed.');
    process.exitCode = 2; return;
  }
  const id = new URL(worker.url()).host;
  // Fresh test profile, Local Only. No cloud credentials or cloud model requests.
  await worker.evaluate(() => chrome.storage.local.set({ settings: { localOnly: true, autoDebait: false, showOrb: true, showTags: true, voice: false, disabledSites: [] } }));
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/src/popup/index.html`);
  await popup.locator('#engineNote').waitFor();
  const dimensions = await popup.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.getBoundingClientRect().width,
    body: document.body.getBoundingClientRect().width, contentWidth: document.body.clientWidth, scrollWidth: document.body.scrollWidth }));
  assert.ok(dimensions.body >= 360 && dimensions.body <= 400, JSON.stringify(dimensions));
  assert.ok(dimensions.scrollWidth <= dimensions.contentWidth, 'Body content must not overflow horizontally');
  assert.equal(await popup.locator('#legend li').count(), 4);
  assert.ok(await popup.locator('[data-setting=localOnly]').isChecked());
  await popup.locator('.ingredients-guide > summary').click();
  assert.equal(await popup.locator('.ingredient-entry').count(), 6);
  await popup.screenshot({ path: path.join(out, 'loaded-extension-popup.png'), fullPage: true });
  const side = await context.newPage(); await side.goto(`chrome-extension://${id}/src/sidepanel/index.html`);
  await side.locator('.education').waitFor();
  assert.equal(await side.locator('#realChip').innerText(), 'Real numbers');
  await side.locator('#seed').click();
  await side.waitForFunction(() => document.querySelector('#realChip').textContent === 'Sample data');
  await side.screenshot({ path: path.join(out, 'loaded-extension-sidepanel-document.png'), fullPage: true });
  // Separate direct-document checks above from native toolbar popup autosizing.
  let nativeAction = false;
  try {
    const opened = context.waitForEvent('page', { timeout: 5000 });
    opened.catch(() => {});
    await worker.evaluate(() => chrome.action.openPopup());
    const action = await opened;
    await action.waitForLoadState('domcontentloaded');
    const size = await action.evaluate(() => ({ width: innerWidth, body: document.body.getBoundingClientRect().width }));
    assert.ok(size.width >= 360 && size.width <= 400, JSON.stringify(size));
    await action.screenshot({ path: path.join(out, 'native-toolbar-popup.png') });
    nativeAction = true;
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error;
    console.error('PARTIAL: Loaded extension documents passed; native toolbar popup automation unavailable. Manual toolbar and side-panel-docking checks remain.');
  }
  const report = { loadedExtension: true, directPopupDocument: dimensions, nativeToolbarPopup: nativeAction,
    nativeSidePanelDocking: 'manual verification required', realGeminiRequests: 0, localOnly: true };
  writeFileSync(path.join(out, 'native-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { if (context) await context.close(); } })().catch(error => { console.error(error.stack); process.exitCode = 1; });
