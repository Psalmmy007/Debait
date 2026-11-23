// Optional browser regressions: requires Playwright and Chromium in the test environment.
// All supplied AI responses are CONTROLLED fixtures; no real Gemini requests occur.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const assert = require('node:assert/strict');
const root = process.cwd(), port = 5198;
const prefix = 'Click to find out: ';
const safe = prefix + 'Officials you should HATE: join the outrage now';
const unsafe = "'I'd throw up in the car park': How school anxiety is harming children's futures";
const complex = 'The central bank announces a contractionary monetary policy stance.';
const html = `<!doctype html><html data-debait-preview><body><h2 id="safe" data-debait-headline><a href="/article?id=1"><span>${prefix}</span>${safe.slice(prefix.length)}</a></h2><h2 id="unsafe" data-debait-headline>${unsafe}</h2><h2 id="complex" data-debait-headline>${complex}</h2><script type="module" src="/preview.js"></script></body></html>`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'demo/vite.config.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'pipe' });
let browser;
(async () => {
  try {
    for (let n = 0; n < 80; n++) { try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    browser = await chromium.launch({ ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}), headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().resourceType() === 'document' && path === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (path === '/preview.js') {
        const response = await route.fetch(); let body = await response.text();
        body = `import { normalizeAssistance } from '/@fs${root}/src/engine/assistance.js';\n` + body;
        body = body.replace('onMessage: { addListener() {} },', 'onMessage: { addListener(f) { globalThis.__listener=f; } },');
        body = body.replace('async sendMessage(msg) {', `async sendMessage(msg) {
          globalThis.__messages ||= []; globalThis.__messages.push({type:msg.type,task:msg.task,texts:msg.texts});
          if(msg.type==='debait/debaited'){globalThis.__rewrites=(globalThis.__rewrites||0)+msg.count;return {ok:true};}
          if(msg.type==='debait/headline-assist'){
            if(globalThis.__quota)return {ok:false,code:'debait/quota',error:'Gemini cooldown. No assistance was produced.',retryAt:Date.now()+60000};
            const source=(globalThis.__forceDeviceAssist || store.settings?.localOnly)?'on-device':'cloud';
            const raw=msg.task==='rewrite'?{source,honest_rewrite:msg.text.startsWith(${JSON.stringify(prefix)})?msg.text.slice(${prefix.length}):msg.text.replace('harming','affecting')}:{source,simple_explanation:'The central bank announces a plan to limit demand in the economy.',definitions:[{term:'contractionary monetary policy',meaning:'A general term for measures intended to reduce demand in an economy.'}],missing_context:'The headline alone does not specify measures or outcomes.'};
            return {ok:true,result:normalizeAssistance(raw,msg.text,msg.task,msg.kind)};
          }
        `);
        body = body.replace('const raw = await mockEngine.scoreHeadlines(msg.texts, {});', `if(globalThis.__holdScoring)await new Promise(resolve=>{globalThis.__releaseScoring=()=>{globalThis.__holdScoring=false;resolve();};});
          await new Promise(resolve=>setTimeout(resolve,100));
          const raw=msg.texts.map(t=>({kind:t===${JSON.stringify(complex)}?'clean':t.startsWith(${JSON.stringify(prefix)})?'rage':'fear',score:50,triggers:t===${JSON.stringify(complex)}?[]:[{word:t,why:'Controlled fixture evidence, not a model evaluation'}],honest_rewrite:t.startsWith(${JSON.stringify(prefix)})?t.slice(${prefix.length}):t.replace('harming','affecting'),source:store.settings?.localOnly?'on-device':'cloud'}));`);
        return route.fulfill({ response, body });
      }
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:${port}/?preview`);
    await page.waitForFunction(() => !!globalThis.__listener);
    await page.evaluate(() => { globalThis.__link = document.querySelector('#safe a'); globalThis.__span = document.querySelector('#safe span'); });
    const invoke = (type, extra = {}) => page.evaluate(({ type, extra }) => new Promise(resolve => globalThis.__listener({ type, ...extra }, {}, resolve)), { type, extra });
    const action = await invoke('debait/togglePage');
    assert.equal(action.ok, true); assert.equal(action.rewrote, 1);
    assert.equal(await page.locator('#safe').textContent(), safe.slice(prefix.length));
    assert.equal(await page.locator('#unsafe').textContent(), unsafe);
    assert.equal(await page.evaluate(() => __link === document.querySelector('#safe a') && __span === document.querySelector('#safe span')), true);
    assert.equal((await invoke('debait/tool', { name: 'restore_page' })).result.restored, 1);
    assert.equal(await page.locator('#safe').textContent(), safe);

    // A toolbar popup must close the actual page settings, not just send an unused message.
    await page.locator('debait-root .orb').click({button:'right'});
    await page.locator('debait-root .panel').waitFor();
    const popup = await context.newPage();
    await popup.exposeFunction('__pageAction', message => invoke(message.type));
    await popup.route('**/pages-preview.js', async route => {
      const response = await route.fetch(); const body = await response.text();
      await route.fulfill({ response, body: body + '\nglobalThis.chrome.tabs.sendMessage = (_id, message) => globalThis.__pageAction(message);' });
    });
    await popup.goto(`http://127.0.0.1:${port}/pages.html?page=popup`);
    await popup.waitForFunction(() => document.querySelector('#engine')?.dataset.src === 'mock');
    await page.locator('debait-root .panel').waitFor({state:'detached'});
    await popup.locator('#debaitPage').click();
    await popup.waitForFunction(() => document.querySelector('#pageStatus').textContent.includes('Applied 1'));
    assert.equal(popup.isClosed(), false);
    await popup.close(); await invoke('debait/tool', { name: 'restore_page' });

    await page.evaluate(async root => {
      const {createSettingsPanel}=await import('/@fs'+root+'/src/content/ui/settings.js');
      const layer=document.createElement('div');document.body.append(layer);
      const original=chrome.storage.local.get;let release;
      chrome.storage.local.get=()=>new Promise(resolve=>{release=resolve;});
      const panel=createSettingsPanel(layer,{getPage:()=>({}),orbCenter:()=>({x:100,y:100})});
      const opening=panel.open();await panel.close();chrome.storage.local.get=original;
      release({settings:{}});await opening;
      if(layer.childElementCount)throw new Error('Settings reopened after toolbar close during initialization');
      layer.remove();
    }, root);
    await page.evaluate(() => { globalThis.__forceDeviceAssist = true; });
    await page.locator('debait-tag button').first().click();
    await page.locator('debait-root [data-act=request-rewrite]').click();
    await page.waitForFunction(() => document.querySelector('debait-root').shadowRoot.querySelector('[data-assistance-status]')?.textContent.includes('ready'));
    assert.ok((await page.locator('debait-root [data-rewrite-source]').textContent()).includes('On-device AI'));
    assert.ok((await page.locator('debait-root .card-foot .source').textContent()).includes('Cloud AI'));
    await page.locator('debait-root [data-act=debait]').click();
    await page.evaluate(() => { globalThis.__forceDeviceAssist = false; });
    assert.equal(await page.locator('#safe').textContent(), safe.slice(prefix.length));
    await invoke('debait/tool', { name: 'restore_page' });

    await page.locator('debait-tag button').nth(1).click();
    await page.locator('debait-root [data-act=request-rewrite]').click();
    await page.waitForFunction(() => document.querySelector('debait-root').shadowRoot.querySelector('[data-assistance-status]')?.textContent.includes('No safe alternative'));
    assert.equal(await page.locator('debait-root [data-act=debait]').count(), 0);
    await page.locator('debait-root [data-act=close]').click();

    await page.locator('debait-tag button').nth(2).click();
    await page.locator('debait-root [data-act=explain]').click();
    await page.waitForFunction(() => document.querySelector('debait-root').shadowRoot.querySelector('[data-explanation]')?.textContent.includes('General definition'));
    assert.ok((await page.locator('debait-root [data-explanation]').textContent()).includes('Not a fact-check'));
    assert.equal(await page.locator('#complex').textContent(), complex);
    await page.evaluate(() => { globalThis.__quota = true; });
    await page.locator('debait-root [data-act=explain]').click();
    await page.waitForFunction(() => document.querySelector('debait-root').shadowRoot.querySelector('[data-assistance-status]')?.textContent.includes('cooldown'));
    await page.locator('debait-root [data-act=close]').click();
    await page.evaluate(() => { globalThis.__quota = false; const h=document.createElement('h2');h.id='dynamic';h.dataset.debaitHeadline='';h.textContent='Click to find out: Your friends are better than you';document.body.append(h); });
    await page.waitForFunction(() => document.querySelectorAll('debait-tag').length === 4);
    await page.waitForTimeout(800);
    assert.ok((await page.locator('#dynamic').textContent()).startsWith(prefix));
    const countBefore = await page.evaluate(() => globalThis.__rewrites);
    await page.evaluate(() => chrome.storage.local.set({ settings: { autoDebait: true } }));
    await page.waitForFunction(() => document.querySelector('#dynamic').textContent === 'Your friends are better than you');
    assert.equal(await page.locator('#safe').textContent(), safe); // manual restore opt-out survives auto enable
    assert.equal(await page.evaluate(() => globalThis.__rewrites), countBefore + 1);
    await page.evaluate(() => { document.querySelector('#dynamic').firstChild.data = 'Click to find out: Officials you should HATE again'; });
    await page.waitForFunction(() => document.querySelector('#dynamic').textContent === 'Officials you should HATE again');
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => globalThis.__rewrites), countBefore + 2);
    await page.evaluate(() => chrome.storage.local.set({ settings: { autoDebait: false, localOnly: true } }));
    await page.waitForTimeout(1600);
    assert.equal(await page.locator('#dynamic').textContent(), 'Click to find out: Officials you should HATE again');
    assert.equal(await page.locator('#unsafe').textContent(), unsafe);
    await page.evaluate(() => chrome.storage.local.set({ settings: { autoDebait: true, localOnly: true } }));
    await page.waitForFunction(() => document.querySelector('#dynamic').textContent === 'Officials you should HATE again');
    assert.equal(errors.length, 0, errors.join('\n'));
    const localPage = await context.newPage();
    localPage.on('pageerror',error=>errors.push(error.message));
    await localPage.addInitScript(()=>{globalThis.__holdScoring=true;localStorage.setItem('debait-preview',JSON.stringify({settings:{localOnly:true,autoDebait:false}}));});
    await localPage.goto(`http://127.0.0.1:${port}/?preview`);
    await localPage.waitForFunction(()=>!!globalThis.__releaseScoring);
    assert.ok((await localPage.locator('debait-root .orb-tip').textContent()).includes('Local Only: checking or processing headlines'));
    assert.ok((await localPage.locator('debait-root .orb-tip').textContent()).includes('minutes'));
    await localPage.evaluate(()=>__releaseScoring());
    await localPage.waitForFunction(()=>document.querySelectorAll('debait-tag').length===3 && !document.querySelector('debait-root').shadowRoot.querySelector('.orb-wrap[data-state="busy"]'));
    assert.equal(errors.length,0,errors.join('\n'));
    const disabled = await context.newPage();
    await disabled.addInitScript(() => localStorage.setItem('debait-preview', JSON.stringify({ settings: { autoDebait: true, disabledSites: ['127.0.0.1'] } })));
    await disabled.goto(`http://127.0.0.1:${port}/?preview`);
    await disabled.waitForFunction(() => !!document.documentElement.dataset.debaitStarted);
    assert.equal(await disabled.locator('debait-tag').count(), 0);
    assert.equal(await disabled.locator('#safe').textContent(), safe);
    assert.equal(await disabled.evaluate(() => (globalThis.__messages || []).filter(m => m.type === 'debait/score').length), 0);
    console.log(JSON.stringify({ controlledBrowser: true, popupClosesSettings: true, pendingPanelOpeningCancelled: true, manualPage: true, popupResponse: true, individualRequestApplyRestore: true, unsafeRewriteRejected: true, cleanExplanationAndCooldown: true, autoOptInAndManualRestore: true, dynamicRecycledText: true, localOnlyInvalidation: true, completeContentLocalOnlyWaitingMessage: true, nestedLinksPreserved: true, disabledSiteRespected: true, realModelRequests: 0 }));
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
