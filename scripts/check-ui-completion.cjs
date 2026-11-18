// Authentic source components + controlled fixtures only. No Gemini or Firebase calls.
// Run after npm ci && npm run fonts. Requires Playwright + Chromium (environment tools).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.cwd(), port = 5199;
const out = process.env.DEBAIT_UI_ARTIFACT_DIR || '/tmp/debait-ui-completion';
mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'demo/vite.config.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
const origin = `http://127.0.0.1:${port}`;
let browser, checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
(async () => { try {
  for (let n = 0; n < 80; n++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}), headless: true, args: ['--no-sandbox'] });
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 380, height: 850 }, colorScheme: theme, reducedMotion: 'reduce' });
    const errors = []; context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
    await context.route('**/pages-preview.js', async route => {
      const response = await route.fetch(); let body = await response.text();
      body = body.replace('const store = { stats: {} };', `const d=new Date(), key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        const store = { stats: { [key]: {total:10,rage:2,fear:1,envy:1,clean:6,debaited:1,sources:{'fictional.example':4}} } };
        globalThis.__previewStore=store;`);
      body += `\nchrome.runtime.getURL=p=>'/'+p;
        chrome.runtime.sendMessage=async()=>({ok:true,status:store.settings?.localOnly?{ready:false,source:'none',message:'Controlled preview: on-device model unavailable.'}:{ready:true,source:'cloud',message:'Controlled preview cloud status, not real inference.'}});
        chrome.tabs.query=async()=>[{id:1,url:'https://fictional.example/'}];
        chrome.tabs.sendMessage=async()=>{await new Promise(r=>setTimeout(r,100));return globalThis.__pageResult || {ok:true,rewrote:1,note:'Applied 1 safe rewrite. Controlled preview.'};};`;
      return route.fulfill({ response, body });
    });
    const popup = await context.newPage();
    await popup.goto(origin+'/pages.html?page=popup');
    await popup.waitForFunction(() => document.querySelector('#pct')?.textContent === '40');
    check(!(await popup.locator('[data-setting=autoDebait]').isChecked()), 'automatic mode starts off');
    check((await popup.locator('#sub').innerText()).includes('10 analyzed'), 'popup real-data denominator');
    await popup.screenshot({path:path.join(out,`popup-${theme}.png`),fullPage:true});
    await popup.locator('#debaitPage').click();
    check(await popup.locator('#debaitPage').isDisabled(), 'popup has loading state');
    await popup.waitForFunction(() => document.querySelector('#pageStatus').textContent.includes('Applied 1'));
    check((await popup.locator('#debaitPage').innerText()).includes('Restore'), 'popup restore action');
    await popup.evaluate(() => { globalThis.__pageResult={ok:false,error:'Gemini cooldown: try again later. No analysis produced.'}; });
    await popup.locator('#debaitPage').click();
    await popup.waitForFunction(() => document.querySelector('#pageStatus').textContent.includes('cooldown'));
    check(!(await popup.locator('#debaitPage').isDisabled()), 'quota failure releases UI without fake classification');
    await popup.locator('[data-setting=localOnly]').evaluate(e => {e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));});
    await popup.waitForFunction(() => document.querySelector('#engine').dataset.src === 'none');
    check((await popup.locator('#engineNote').innerText()).includes('unavailable'), 'Local Only status never claims cloud/device success');
    await popup.locator('.ingredients-guide > summary').click();
    await popup.locator('[data-ingredient=curiosity-preview] > summary').click();
    check((await popup.locator('[data-ingredient=curiosity-preview]').innerText()).includes('not active'), 'future category clearly labeled');
    await popup.locator('[data-ingredient=uncertain-preview] > summary').click();
    check((await popup.locator('[data-ingredient=uncertain-preview]').innerText()).includes('abstention'), 'uncertainty distinct from framing');
    await popup.screenshot({ path: path.join(out, `popup-guide-${theme}.png`), fullPage: true });
    await popup.setViewportSize({width:320,height:650});
    check(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow popup contains content');
    await popup.evaluate(async()=>{const d=new Date(), key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); await chrome.storage.local.set({stats:{[key]:{total:0,rage:0,fear:0,envy:0,clean:0,debaited:0,sources:{}}}});});
    await popup.waitForFunction(()=>document.querySelector('#sub').textContent.includes('No headlines'));
    check(await popup.locator('#pct').innerText()==='—', 'empty popup has no invented percentage');
    await popup.screenshot({ path:path.join(out,`popup-empty-narrow-${theme}.png`),fullPage:true });

    const weekly=await context.newPage();await weekly.goto(origin+'/pages.html');
    await weekly.waitForFunction(()=>document.querySelector('#total')?.textContent==='10');
    check(await weekly.locator('#baitPct').innerText()==='40', 'weekly real denominator retained');
    await weekly.screenshot({path:path.join(out,`weekly-real-${theme}.png`),fullPage:true});
    await weekly.locator('#seed').click();await weekly.waitForFunction(()=>document.querySelector('#realChip').textContent==='Sample data');
    check((await weekly.locator('#tip').innerText()).includes('do not describe your reading'), 'sample never gives personal advice');
    check(await weekly.locator('.education').isVisible(), 'Understanding Your Feed present');
    await weekly.locator('.ingredients-guide > summary').click();
    check(await weekly.locator('.ingredient-entry').count()===6, 'all six guide entries available');
    await weekly.screenshot({path:path.join(out,`weekly-sample-${theme}.png`),fullPage:true});
    await weekly.locator('#seed').click();await weekly.waitForFunction(()=>document.querySelector('#realChip').textContent==='Real numbers');
    check(await weekly.locator('#total').innerText()==='10','sample does not replace real counts');
    await weekly.setViewportSize({width:320,height:600});
    check(await weekly.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'weekly narrow containment');

    const p=await context.newPage(); await p.setViewportSize({width:1000,height:850});
    await p.route('**/controlled-ui',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Controlled Debait UI preview</title></head><body style="font:16px system-ui;margin:32px;background:${theme==='dark'?'#171717':'#f2f2f7'};color:${theme==='dark'?'#f5f5f7':'#1d1d1f'}"><h1>Debait UI review</h1><p>Controlled fixtures only. Not a real Gemini response or installed-extension test.</p><button id="opener">Headline card</button><button id="settings">Settings</button><div id="fixture"></div></body></html>`}));
    await p.goto(origin+'/controlled-ui');
    await p.evaluate(async({root})=>{
      await import('/pages-preview.js'); const mod=p=>import('/@fs'+root+'/src/'+p);
      const {injectPageStyles}=await mod('content/ui/page.js');injectPageStyles();
      const {createOverlay,createOrb}=await mod('content/ui/overlay.js');
      const {openCard,closeCard}=await mod('content/ui/card.js');
      const {createSettingsPanel}=await mod('content/ui/settings.js');
      const {orbFeedback}=await mod('shared/uiState.js');
      const overlay=createOverlay();const orb=createOrb(overlay,{onClick(){},onDoubleClick(){},onTripleClick(){}});
      globalThis.__orb=orb;globalThis.__feedback=orbFeedback;
      const rec={text:'Shocking: Council approves new park',state:'scored',result:{kind:'rage',score:65,triggers:[{word:'Shocking',why:'Controlled example of publisher-added alarm.'}],honest_rewrite:'Council approves new park',source:'cloud'}};
      globalThis.__rec=rec;
      const show=()=>openCard(overlay.cardLayer,rec,{left:480,right:550,bottom:150,top:120,width:70},{
        onDebait:async()=>{rec.state='debaited';return true;},onRestore:async()=>{rec.state='scored';rec.autoApplied=false;return true;},
        onAssist:async task=>{if(globalThis.__quota)throw new Error('Gemini cooldown. No result produced.');return task==='rewrite'?{honest_rewrite:globalThis.__reject?rec.text:'Council approves new park',source:'cloud'}:{simple_explanation:'The council agreed to create a new park.',definitions:[{term:'Council',meaning:'A group elected or appointed to make local decisions.'}],missing_context:'The headline does not state the location or opening date.',source:'cloud'};}
      });
      document.querySelector('#opener').onclick=show;
      const panel=createSettingsPanel(overlay.panelLayer,{getPage:()=>({bait:1,debaited:0,scanned:1,rewritable:1,automatic:true,notice:'Only accepted alternatives are applied.'}),onToggle:async()=>{},orbCenter:()=>({x:960,y:740}),onOpenChange(){}});
      document.querySelector('#settings').onclick=()=>{closeCard();panel.open();};
    },{root});
    await p.locator('#opener').click();
    check(await p.locator('debait-root .card').evaluate(e=>e.getRootNode().activeElement===e),'card receives focus');
    check(await p.locator('debait-root .compare').count()===0,'no clipping comparison');
    check((await p.locator('debait-root .card').innerText()).includes('Original headline'),'original clearly labeled');
    await p.locator('debait-root [data-act=explain]').click();
    await p.waitForSelector('debait-root [data-explanation]:not([hidden])');
    check((await p.locator('debait-root [data-explanation]').innerText()).includes('Not a fact-check'),'explanation disclaimer');
    check(await p.evaluate(()=>__rec.state)==='scored','explanation does not apply rewrite');
    await p.screenshot({path:path.join(out,`headline-explain-${theme}.png`),fullPage:true});
    await p.keyboard.press('Escape');
    check(await p.locator('#opener').evaluate(e=>document.activeElement===e),'card restores focus');
    await p.locator('#opener').click();await p.locator('debait-root [data-act=debait]').click();
    await p.locator('#opener').click();
    check(await p.locator('debait-root [data-act=restore]').count()===1,'applied rewrite has restoration');
    await p.locator('debait-root [data-act=restore]').click();
    check(await p.evaluate(()=>__rec.state)==='scored','restore handler called');
    await p.evaluate(()=>{__rec.state='debaited';__rec.autoApplied=true;});
    await p.locator('#opener').click();
    check((await p.locator('debait-root .transformation-note').innerText()).includes('Auto-Debait'),'automatic transformation labeled');
    await p.keyboard.press('Escape');await p.evaluate(()=>{__rec.state='scored';__reject=true;});
    await p.locator('#opener').click();await p.locator('debait-root [data-act=request-rewrite]').click();
    await p.waitForFunction(()=>document.querySelector('debait-root').shadowRoot.querySelector('.honest').textContent.includes('No safe alternative'));
    check(await p.locator('debait-root [data-act=debait]').count()===0,'rejected rewrite has no action');
    await p.evaluate(()=>{__quota=true;});await p.locator('debait-root [data-act=explain]').click();
    await p.waitForFunction(()=>document.querySelector('debait-root').shadowRoot.querySelector('[data-assistance-status]').textContent.includes('cooldown'));
    check((await p.locator('debait-root [data-assistance-status]').innerText()).includes('No result'),'honest assistance failure');
    await p.keyboard.press('Escape');
    for(const state of ['rage','fear','envy','clean','mixed','empty','busy','error','unavailable','disabled']){
      await p.evaluate(state=>{
        const opts=state==='mixed'?{results:[{kind:'rage',source:'cloud'},{kind:'fear',source:'cloud'}]}:['rage','fear','envy','clean'].includes(state)?{results:[{kind:state,source:'cloud'}]}:{[state]:true};
        __orb.update({state:state==='busy'?'busy':'idle',bait:0,debaited:0,scanned:0,feedback:__feedback(opts)});
      },state);
      check(await p.locator('debait-root .orb-wrap').getAttribute('data-feedback')===state,`orb ${state} presentation`);
      await p.screenshot({path:path.join(out,`orb-${state}-${theme}.png`),clip:{x:900,y:620,width:100,height:180}});
    }
    await p.locator('#settings').click();
    check(await p.locator('debait-root .panel').evaluate(e=>e.getRootNode().activeElement===e),'settings receives focus');
    check(await p.locator('debait-root .p-today').evaluate(e=>e.getBoundingClientRect().height<95),'percentage stays on one line');
    await p.screenshot({path:path.join(out,`settings-${theme}.png`),fullPage:true});
    await p.setViewportSize({width:320,height:500});
    check(await p.locator('debait-root .panel').evaluate(e=>e.offsetWidth<=innerWidth-24 && e.scrollHeight>e.clientHeight),'narrow settings scroll');
    await p.keyboard.press('Escape');
    check(await p.locator('#settings').evaluate(e=>document.activeElement===e),'settings restores focus');
    await p.locator('#opener').click();
    check(await p.locator('debait-root .card').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight-10),'short-screen card contained');
    check(await p.locator('debait-root .card').evaluate(e=>getComputedStyle(e).transitionDuration==='0s'),'reduced motion respected');
    await p.emulateMedia({reducedMotion:'no-preference'});
    await p.locator('debait-root .card').dispatchEvent('pointermove',{clientX:160,clientY:200,pointerType:'mouse'});
    check(await p.locator('debait-root .card').evaluate(e=>!e.style.transform),'short scrollable card avoids clipping tilt');
    await p.keyboard.press('Escape');await p.locator('debait-root .card').waitFor({state:'detached'});
    await p.setViewportSize({width:1000,height:850});await p.locator('#opener').click();
    await p.locator('debait-root .card').dispatchEvent('pointermove',{clientX:600,clientY:260,pointerType:'mouse'});
    check(await p.locator('debait-root .card').evaluate(e=>e.style.transform.includes('perspective')),'usable mouse tilt retained');
    await p.emulateMedia({reducedMotion:'reduce'});
    check(await p.locator('debait-root .card').evaluate(e=>getComputedStyle(e).transform==='none'),'reduced motion neutralizes existing tilt');
    check(errors.length===0,errors.join('\n'));
    await context.close();
  }
  const names=readdirSync(out).filter(n=>n.endsWith('.png')).sort();
  writeFileSync(path.join(out,'gallery.html'),`<!doctype html><meta charset="utf-8"><title>Debait UI completion evidence</title><style>body{max-width:1100px;margin:32px auto;font:16px/1.5 system-ui;background:#f2f2f7;color:#1d1d1f;padding:16px}img{max-width:100%;height:auto}figure{margin:32px 0}</style><h1>Debait UI completion: controlled browser evidence</h1><p>Actual source components; all AI/status/statistics responses are controlled synthetic fixtures. No live Gemini calls, authentication or genuine on-device inference is claimed.</p>`+names.map(n=>`<figure><figcaption>${n}</figcaption><img alt="${n}" src="data:image/png;base64,${readFileSync(path.join(out,n)).toString('base64')}"></figure>`).join(''));
  console.log(JSON.stringify({controlledUI:true,checks,failed:0,themes:['light','dark'],screenshots:names.length,realGeminiRequests:0,artifacts:out}));
} finally { if(browser) await browser.close(); server.kill(); }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
