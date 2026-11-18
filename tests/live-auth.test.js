import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveConnector } from '../src/offscreen/liveConnector.js';

test('Live authentication failure prevents model creation and connection', async () => {
  let attempts = 0;
  const connect = createLiveConnector({ getAi: async () => { throw { code: 'appCheck/rejected' }; },
    getLiveGenerativeModel: () => { attempts++; }, models: ['a', 'b'] });
  await assert.rejects(connect(undefined, async () => {}), error => error.code === 'debait/app-check');
  assert.equal(attempts, 0);
});

test('Local Only enabled during authentication prevents a new Live connection', async () => {
  let allowed = true, attempts = 0;
  const connect = createLiveConnector({ getAi: async () => { allowed = false; return {}; },
    getLiveGenerativeModel: () => { attempts++; }, models: ['a', 'b'] });
  await assert.rejects(connect(undefined, async () => { if (!allowed) throw new Error('LOCAL_ONLY'); }), /LOCAL_ONLY/);
  assert.equal(attempts, 0);
});

test('a missing Live model can try the next configured model after another privacy check', async () => {
  const attempted = []; let guards = 0;
  const connect = createLiveConnector({ getAi: async () => ({}), models: ['a', 'b'], parameters: {},
    getLiveGenerativeModel: (_ai, { model }) => ({ connect: async () => {
      attempted.push(model);
      if (model === 'a') throw { customData: { httpErrorCode: 404 } };
      return { session: 'test' };
    } }) });
  assert.deepEqual(await connect(undefined, async () => { guards++; }), { session: 'test' });
  assert.deepEqual(attempted, ['a', 'b']); assert.equal(guards, 6);
});

for (const code of [401, 403, 429]) {
  test(`Live does not retry authentication/access/quota failures against every model: ${code}`, async () => {
    let attempts = 0;
    const connect = createLiveConnector({ getAi: async () => ({}), models: ['a', 'b'], parameters: {},
      getLiveGenerativeModel: () => ({ connect: async () => { attempts++; throw { customData: { httpErrorCode: code } }; } }) });
    await assert.rejects(connect(undefined, async () => {}));
    assert.equal(attempts, 1);
  });
}

test('public SDK session resumption is opted in initially and stays on the same model',async()=>{
  const configs=[];const attempts=[];
  const connect=createLiveConnector({getAi:async()=>({}),models:['a','b'],parameters:{},reserve:async()=>{},
    getLiveGenerativeModel:(_ai,{model})=>({connect:async config=>{attempts.push(model);configs.push(config);return{close:async()=>{}};}})});
  const previousSession=await connect(undefined,async()=>{});await connect(undefined,async()=>{},{handle:'server-issued',previousSession});
  assert.deepEqual(configs,[{},{handle:'server-issued'}]);assert.deepEqual(attempts,['a','a']);
});
test('a late connection after timeout is closed without starting audio',async()=>{
  let resolve,closes=0;const pending=new Promise(r=>{resolve=r;});
  const connect=createLiveConnector({getAi:async()=>({}),models:['a'],parameters:{},timeoutMs:5,
    getLiveGenerativeModel:()=>({connect:()=>pending})});
  await assert.rejects(connect(undefined,async()=>{}),error=>error.code==='debait/timeout');
  resolve({close:async()=>{closes++;}});await new Promise(r=>setImmediate(r));assert.equal(closes,1);
});
test('a Live 429 reports exposed retry guidance and never tries another model',async()=>{
  let attempts=0,delay;
  const connect=createLiveConnector({getAi:async()=>({}),models:['a','b'],parameters:{},rateLimited:async ms=>{delay=ms;},
    getLiveGenerativeModel:()=>({connect:async()=>{attempts++;throw{customData:{httpErrorCode:429},retryAfterMs:65000};}})});
  await assert.rejects(connect(undefined,async()=>{}),error=>error.code==='debait/quota');assert.equal(attempts,1);assert.equal(delay,65000);
});

test('temporary service failures do not probe alternate models',async()=>{
 let attempts=0;const connect=createLiveConnector({getAi:async()=>({}),models:['a','b'],parameters:{},
  getLiveGenerativeModel:()=>({connect:async()=>{attempts++;throw{customData:{httpErrorCode:503},message:'model unavailable'};}})});
 await assert.rejects(connect(undefined,async()=>{}));assert.equal(attempts,1);
});

test('late sessions from a cancelled call cannot change another call resumption model',async()=>{
 let resolve,first=true;const pending=new Promise(r=>{resolve=r;});const attempted=[];
 const connect=createLiveConnector({getAi:async()=>({}),models:['a','b'],parameters:{},
  getLiveGenerativeModel:(_ai,{model})=>({connect:async config=>{
   attempted.push([model,config]);if(first){first=false;return pending;}
   if(model==='a')throw{customData:{httpErrorCode:404}};return{close:async()=>{}};
  }})});
 const old=connect(undefined,async()=>{});await new Promise(r=>setImmediate(r));
 const current=await connect(undefined,async()=>{});resolve({close:async()=>{}});await old;
 await connect(undefined,async()=>{},{handle:'current-server-handle',previousSession:current});
 assert.equal(attempted.at(-1)[0],'b');
});
test('Firebase 13.3 exposes the public Live methods used by this adapter',async()=>{
 const {LiveSession,LiveGenerativeModel}=await import('firebase/ai');
 for(const method of ['receive','sendAudioRealtime','sendFunctionResponses','send','close'])assert.equal(typeof LiveSession.prototype[method],'function');
 assert.equal(typeof LiveGenerativeModel.prototype.connect,'function');
});
