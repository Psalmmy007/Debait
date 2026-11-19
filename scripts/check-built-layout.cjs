// Actual built HTML/CSS/JS served in Chromium, with CONTROLLED Chrome API fixtures.
// This does NOT load an extension and does NOT prove native toolbar auto-sizing.
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path'), assert = require('node:assert/strict');
const dist = path.resolve('dist'), out = process.env.DEBAIT_LAYOUT_ARTIFACT_DIR || '/tmp/debait-built-layout';
let browser, server; let checks = 0; const reports = [];
(async () => { try {
  assert.ok(existsSync(path.join(dist, 'manifest.json')), 'Build first'); mkdirSync(out, { recursive: true });
  server = createServer((req, res) => {
    const file = path.resolve(dist, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(dist + path.sep) || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'})[path.extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}), headless: true, args: ['--no-sandbox'], ignoreDefaultArgs: ['--hide-scrollbars'] });
  for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({colorScheme:theme,reducedMotion:'reduce',viewport:{width:200,height:600}});
    await context.addInitScript(() => {
      const store={};const listeners=[];globalThis.__tabMessages=[];
      globalThis.__diagnostics=async value=>{store.debaitErrors=value;listeners.forEach(l=>l({debaitErrors:{newValue:value}},'local'));};
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{if(globalThis.__denyCopy)throw new Error('denied');globalThis.__copied=text;}}});
      globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,status:{source:'none',ready:false,message:'Controlled built-layout preview: no inference verified.'}})},
        storage:{local:{get:async k=>{const snapshot=store[k];if(k==='debaitErrors' && globalThis.__holdProblemRead){globalThis.__holdProblemRead=false;return new Promise(resolve=>{globalThis.__releaseProblemRead=()=>resolve({[k]:snapshot});});}return{[k]:snapshot};},set:async o=>{Object.assign(store,o);listeners.forEach(l=>l(Object.fromEntries(Object.entries(o).map(([k,v])=>[k,{newValue:v}])),'local'));}},onChanged:{addListener:f=>listeners.push(f)}},
        tabs:{query:async()=>[{id:1,url:'https://fictional.example'}],sendMessage:async(_id,msg)=>{globalThis.__tabMessages.push(msg);return{ok:false,error:'Controlled cooldown. No inference performed.'};}},windows:{getCurrent:async()=>({id:1})},sidePanel:{open:async()=>{globalThis.__openedFacts=true;}}};
    });
    const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
    await p.goto(origin+'/src/popup/index.html');await p.waitForFunction(()=>document.querySelector('#sub')?.textContent.includes('No headlines'));
    assert.ok(await p.evaluate(()=>globalThis.__tabMessages.some(m=>m.type==='debait/close-settings-panel')));checks++;
    assert.equal(await p.locator('#engine span').innerText(),'Not verified');checks++;
    await p.evaluate(()=>__diagnostics([{at:new Date().toISOString(),where:'voice session',message:'network offline token=PRIVATE_TEST_TOKEN https://private.example'}]));
    await p.waitForFunction(()=>!document.querySelector('#problems').hidden);
    assert.ok((await p.locator('#problemList').textContent()).includes('connectivity'));checks++;
    assert.ok(!(await p.locator('#problemList').textContent()).includes('PRIVATE_TEST_TOKEN'));checks++;
    await p.locator('#copyProblems').click();
    assert.ok(!(await p.evaluate(()=>__copied)).includes('PRIVATE_TEST_TOKEN'));checks++;
    assert.ok((await p.evaluate(()=>__copied)).includes('\n'));checks++;
    await p.evaluate(()=>{globalThis.__denyCopy=true;});await p.locator('#copyProblems').click();
    await p.waitForFunction(()=>document.querySelector('#copyProblems').textContent.includes('Could not copy'));checks++;
    await p.evaluate(()=>__diagnostics({malformed:true}));
    await p.waitForFunction(()=>document.querySelector('#problems').hidden);checks++;
    await p.evaluate(()=>{globalThis.__holdProblemRead=true;__diagnostics([]);});
    await p.waitForFunction(()=>!!globalThis.__releaseProblemRead);
    await p.evaluate(()=>__diagnostics([{at:new Date().toISOString(),where:'voice session',message:'network offline'}]));
    await p.waitForFunction(()=>!document.querySelector('#problems').hidden);
    await p.evaluate(()=>__releaseProblemRead());await p.waitForTimeout(50);
    assert.equal(await p.locator('#problems').isVisible(),true);checks++;
    const measure=()=>p.evaluate(()=>({viewport:innerWidth,root:document.documentElement.getBoundingClientRect().width,body:document.body.getBoundingClientRect().width,client:document.body.clientWidth,scroll:document.body.scrollWidth,zoom:getComputedStyle(document.body).zoom}));
    const small=await measure();assert.equal(small.root,380);assert.equal(small.body,380);checks+=2;
    await p.setViewportSize({width:380,height:600});
    const comfortable=await measure();assert.ok(comfortable.scroll<=comfortable.client);checks++;
    assert.equal(await p.locator('#legend li').count(),4);checks++;
    await p.locator('#debaitPage').click();await p.waitForFunction(()=>document.querySelector('#pageStatus').textContent.includes('cooldown'));checks++;
    await p.screenshot({path:path.join(out,`built-popup-${theme}.png`)});
    for(const width of [320,380,600]){
      await p.setViewportSize({width,height:800});await p.goto(origin+'/src/sidepanel/index.html');await p.locator('.education').waitFor();
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
      assert.equal(await p.locator('#realChip').innerText(),'Real numbers');checks++;
      await p.locator('#seed').click();await p.waitForFunction(()=>document.querySelector('#realChip').textContent==='Sample data');checks++;
      if(width===380)await p.screenshot({path:path.join(out,`built-sidepanel-${theme}.png`),fullPage:true});
    }
    assert.deepEqual(errors,[]);checks++;reports.push({theme,smallStartingViewport:small,comfortableViewport:comfortable});
    await context.close();
  }
  const report={controlledBuiltLayout:true,nativeExtensionLoaded:false,checks,failed:0,realGeminiRequests:0,measurements:reports};
  writeFileSync(path.join(out,'measurements.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally { if(browser)await browser.close();if(server)await new Promise(r=>server.close(r)); } })().catch(e=>{console.error(e.stack);process.exitCode=1;});
