// Real Chromium WebAudio/AudioWorklet with synthetic microphone and controlled SDK wire.
// Also exercises existing orb personalization and share-image generation. No Gemini calls.
const {chromium}=require('playwright');const {spawn}=require('node:child_process');const {existsSync}=require('node:fs');const assert=require('node:assert/strict');
const origin='http://127.0.0.1:5208',root=process.cwd();let browser;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','demo/vite.config.js','--host','127.0.0.1','--port','5208','--strictPort'],{stdio:'pipe'});
(async()=>{try{
 for(let i=0;i<80;i++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const context=await browser.newContext({viewport:{width:1000,height:850},reducedMotion:'reduce'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/voice-csp-test',route=>route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self'; object-src 'none'"},body:'<!doctype html><title>Controlled voice worklet test</title><h1>Controlled synthetic audio, not Gemini</h1>'}));
 await p.goto(origin+'/voice-csp-test');
 await p.evaluate(async({root,origin})=>{
  const {startVoiceAudio}=await import('/@fs'+root+'/src/offscreen/voice-audio.js');
  globalThis.__audioSent=0;globalThis.__allowed=true;globalThis.__abort=new AbortController();
  const inbox=[];let wake;
  globalThis.__push=msg=>{inbox.push(msg);wake?.();wake=null;};
  const session={sendAudioRealtime:async()=>{globalThis.__audioSent++;},sendFunctionResponses:async()=>{},
    async *receive(){while(true){if(!inbox.length)await new Promise(r=>{wake=r;});const msg=inbox.shift();if(msg===null)return;yield msg;}}};
  const button=document.createElement('button');button.id='audio-test';button.textContent='Start controlled synthetic audio';document.body.append(button);
  const media={getUserMedia:async options=>{const stream=await navigator.mediaDevices.getUserMedia(options);globalThis.__stream=stream;return stream;}};
  button.onclick=()=>{globalThis.__starting=startVoiceAudio(session,{assertAllowed:async()=>{if(!globalThis.__allowed)throw new Error('LOCAL_ONLY');},signal:globalThis.__abort.signal,functionCallingHandler:async()=>({})},{media,workletUrl:origin+'/voice-worklets.js'}).then(c=>{globalThis.__controller=c;});};
 },{root,origin});
 await p.locator('#audio-test').click();await p.waitForFunction(()=>globalThis.__controller&&globalThis.__audioSent>=2);
 const sent=await p.evaluate(async()=>{globalThis.__allowed=false;globalThis.__abort.abort();await globalThis.__controller.stop();globalThis.__push(null);return globalThis.__audioSent;});
 await p.waitForTimeout(160);assert.equal(await p.evaluate(()=>globalThis.__audioSent),sent);
 assert.equal(await p.evaluate(()=>globalThis.__stream.getTracks().every(t=>t.readyState==='ended')),true);
 await p.goto(origin+'/?preview');await p.waitForSelector('debait-root .orb');
 await p.locator('debait-root .orb').click({button:'right'});await p.waitForSelector('debait-root .panel');
 for(const value of [.75,1,1.6]){
  await p.locator('debait-root [data-size]').evaluate((e,v)=>{e.value=String(v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},value);
  await p.waitForTimeout(40);
  const box=await p.locator('debait-root .orb-wrap').boundingBox();assert.ok(Math.abs(box.width-56*value)<1);
  assert.ok(box.x>=0&&box.x+box.width<=1000);
 }
 const image=await p.evaluate(async root=>{const {makeShareImage}=await import('/@fs'+root+'/src/content/ui/share.js');
  const blob=await makeShareImage({bait:'Click to find out: Council approves repairs',honest:'Council approves repairs',kind:'rage',score:50});
  const bitmap=await createImageBitmap(blob);return{type:blob.type,width:bitmap.width,height:bitmap.height,size:blob.size};},root);
 assert.equal(image.type,'image/png');assert.equal(image.width,1200);assert.equal(image.height,675);assert.ok(image.size>1000);
 await p.keyboard.press('Escape');
 await p.evaluate(async root=>{
  const {openCard,closeCard}=await import('/@fs'+root+'/src/content/ui/card.js');globalThis.__closeShareCard=closeCard;
  globalThis.__openShareCard=(kind='rage',source='cloud',same=false)=>{closeCard();
   const text='Click to find out: Council approves repairs';
   const rec={text,state:'scored',result:{kind,score:50,triggers:[],source,honest_rewrite:same?text:'Council approves repairs'}};
   openCard(document.querySelector('debait-root').shadowRoot.querySelector('.card-layer'),rec,{left:400,right:450,top:100,bottom:120,width:50},{onDebait:async()=>true,onRestore:async()=>true});
  };
  Object.defineProperty(navigator.clipboard,'write',{configurable:true,value:async()=>{throw new DOMException('Controlled denial','NotAllowedError');}});
 },root);
 for(const [kind,source,same]of [['clean','cloud',false],['rage','mock',false],['rage','cloud',true]]){
  await p.evaluate(args=>globalThis.__openShareCard(...args),[kind,source,same]);assert.equal(await p.locator('debait-root [data-act=share]').count(),0);
 }
 await p.evaluate(()=>globalThis.__openShareCard());
 const downloadPromise=p.waitForEvent('download');await p.locator('debait-root [data-act=share]').click();
 const download=await downloadPromise;assert.equal(download.suggestedFilename(),'debait-headline.png');
 const permission=await context.newPage();
 await permission.addInitScript(()=>{
  globalThis.__permit=false;globalThis.__requests=0;
  chrome={runtime:{sendMessage:async msg=>msg.type==='debait/voice-allowed'?{ok:true,allowed:globalThis.__permit}:{ok:false}}};
  const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async options=>{globalThis.__requests++;globalThis.__permissionStream=await capture(options);return globalThis.__permissionStream;};
 });
 await permission.goto(origin+'/@fs'+root+'/src/voice/index.html');
 await permission.waitForFunction(()=>document.querySelector('#msg').textContent.includes('Local Only'));
 assert.equal(await permission.evaluate(()=>globalThis.__requests),0);
 await permission.evaluate(()=>{globalThis.__permit=true;});await permission.locator('#allow').click();
 await permission.waitForFunction(()=>document.querySelector('#msg').textContent.includes('call could not start'));
 assert.equal(await permission.evaluate(()=>globalThis.__permissionStream.getTracks().every(t=>t.readyState==='ended')),true);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({controlled:true,realGeminiRequests:0,syntheticMicrophone:true,realPackagedAudioWorklet:true,strictSelfCspWorklets:true,privacyAbortReleasesMic:true,orbPersonalization:[.75,1,1.6],shareImage:image,shareClipboardDenialDownload:true,shareExcludedForCleanMockUnchanged:true,permissionPagePrivacyAndCleanup:true,nativeExtension:false}));
}finally{if(browser)await browser.close();server.kill();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
