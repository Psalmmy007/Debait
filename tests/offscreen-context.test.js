import test from 'node:test';
import assert from 'node:assert/strict';

test('the real offscreen entry loads with runtime messaging only and acknowledges readiness', async () => {
  let listener;
  globalThis.chrome = { runtime: {
    sendMessage: async () => ({ ok: false }),
    onMessage: { addListener: fn => { listener = fn; } },
  } };
  // Loads the actual SDK-backed entry, without getManifest, management or storage APIs.
  // No inference is requested and no credentials are supplied.
  await import('../src/offscreen/offscreen.js');
  assert.equal(typeof listener, 'function');
  const response = await new Promise(resolve => {
    assert.equal(listener({ target: 'offscreen', type: 'debait/engine-ready' }, {}, resolve), true);
  });
  assert.deepEqual(response, { ok: true, ready: true });
  let answered = false;
  assert.equal(listener({ type: 'debait/installation-type' }, {}, () => { answered = true; }), false);
  assert.equal(answered, false);
});

test('offscreen transports evaluation provenance separately from the normalized result array', async () => {
  const { readFile } = await import('node:fs/promises');
  const url = new URL('../src/offscreen/offscreen.js', import.meta.url);
  let source = await readFile(url, 'utf8');
  source = source.replace("import { engine } from '../engine/index.js';", `const engine = {
    async scoreHeadlines(texts, opts) {
      const results = texts.map(text => ({ kind: 'clean', score: 0, triggers: [], honest_rewrite: text, source: 'on-device' }));
      if (opts.evaluation) results.evaluationMetadata = { configuredModel: 'controlled-model', sdkVersion: 'controlled-sdk' };
      return results;
    }
  };`).replace(/from '(\.[^']+)'/g, (_, path) => `from '${new URL(path, url).href}'`);
  let listener;
  globalThis.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
  await import(`data:text/javascript,${encodeURIComponent(source)}#evaluation-transport`);
  const send = message => new Promise(resolve => listener(message, {}, resolve));
  const result = await send({ target: 'offscreen', type: 'debait/score', texts: ['Headline'], evaluation: true });
  assert.equal(result.ok, true); assert.equal(result.results[0].source, 'on-device');
  assert.deepEqual(result.evaluationMetadata, { configuredModel: 'controlled-model', sdkVersion: 'controlled-sdk' });
  const normal = await send({ target: 'offscreen', type: 'debait/score', texts: ['Headline'] });
  assert.equal(Object.hasOwn(normal, 'evaluationMetadata'), false);
});

test('release offscreen rejects voice startup and only trusted extension background contexts can cancel inference',async()=>{
 const {readFile}=await import('node:fs/promises');const url=new URL('../src/offscreen/offscreen.js',import.meta.url);
 let cancelled=0,listener;
 globalThis.__cancelReleaseTest=()=>{cancelled++;};
 const source=(await readFile(url,'utf8')).replace("import { engine } from '../engine/index.js';", 'const engine={cancelAll:()=>globalThis.__cancelReleaseTest()};')
  .replace(/from '(\.[^']+)'/g,(_,p)=>`from '${new URL(p,url).href}'`);
 globalThis.chrome={runtime:{id:'controlled-extension',onMessage:{addListener(fn){listener=fn;}}}};
 await import(`data:text/javascript,${encodeURIComponent(source)}#release-cancellation`);
 const send=(msg,sender={})=>new Promise(resolve=>listener({target:'offscreen',...msg},sender,resolve));
 assert.equal((await send({type:'debait/call-start'})).ok,false);
 assert.equal((await send({type:'debait/cancel-inference'},{id:'other'})).ok,false);
 assert.equal((await send({type:'debait/cancel-inference'},{id:chrome.runtime.id,tab:{id:1}})).ok,false);
 assert.equal(cancelled,0);
 assert.equal((await send({type:'debait/cancel-inference'},{id:chrome.runtime.id})).ok,true);assert.equal(cancelled,1);
 delete globalThis.__cancelReleaseTest;
});
