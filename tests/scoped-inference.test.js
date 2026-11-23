import test from 'node:test';
import assert from 'node:assert/strict';
import { createInferenceRequests } from '../src/offscreen/inferenceRequests.js';
import { createInferenceTransport } from '../src/background/inferenceTransport.js';
import { createEvaluationService } from '../src/background/evaluation.js';
import { createHeadlineEngine } from '../src/engine/inference.js';
import { createEngine } from '../src/engine/runtime.js';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
const response=(text,source)=>({response:{inferenceSource:source,text:()=>JSON.stringify({results:[{kind:'clean',score:0,triggers:[],honest_rewrite:text}]})}});
function fixture({prepare,local,auth,available='available',localOnly=false,gate}={}){
 const calls=[],messages=[],registry=createInferenceRequests();let serial=0;
 const sdk=createHeadlineEngine({budgets:{device:25,deviceQueue:50,localQueue:120,localOnly:120,cloud:150,slowCooldown:1000},lang:[],prompt:texts=>texts[0],deviceAvailability:async()=>available,
  getDeviceAi:()=>({}),getAi:auth || (async()=>({})),InferenceMode:{ONLY_ON_DEVICE:'local',ONLY_IN_CLOUD:'cloud'},
  getGenerativeModel:(_ai,{mode})=>({generateContent:async(text,{signal})=>{
   calls.push({text,mode});
   if(mode==='cloud')return response(text,'in_cloud');
   return local ? local(text,signal) : new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  }})});
 const runtime=createEngine({firebaseEngine:sdk,mockEngine:{}});
 const transport=createInferenceTransport({prepare:prepare || (async payload=>payload),contexts:async()=>[{}],send:async msg=>{
  messages.push(JSON.parse(JSON.stringify(msg))); // Exercise the Chrome serialization boundary.
  if(msg.type==='debait/cancel-inference')return registry.cancel(msg.requestId);
  const operation=signal=>runtime.scoreHeadlines(msg.texts,{localOnly:msg.localOnly,signal});
  return{ok:true,results:await(msg.requestId?registry.run(msg.requestId,operation):operation(undefined))};
 }});
 const service=createEvaluationService({authorize:async()=>{},settings:async()=>({localOnly}),revision:()=>0,gate:gate||{run:op=>op()},
  infer:async({signal,...payload})=>transport.infer(payload,signal),cancelInference:id=>transport.cancel(id),requestId:()=>`request-${++serial}`,uuid:()=> 'run',metadata:{}});
 const sender={documentId:'controlled-evaluation'};
 return{calls,messages,registry,runtime,sdk,transport,service,
  begin:()=>service.handle({type:'debait/evaluation-begin'},sender),
  score:()=>service.handle({type:'debait/evaluation-score',runId:'run',texts:['Synthetic evaluation headline']},sender),
  cancel:()=>service.handle({type:'debait/evaluation-cancel',runId:'run'},sender)};
}
test('acknowledged evaluation cancellation during local inference makes zero cloud calls',async()=>{
 const f=fixture();await f.begin();const work=assert.rejects(f.score());await tick();
 assert.equal((await f.cancel()).ok,true);await work;await new Promise(r=>setTimeout(r,45));
 assert.equal(f.calls.filter(c=>c.mode==='cloud').length,0);
 const cancellation=f.messages.find(m=>m.type==='debait/cancel-inference');
 assert.deepEqual(Object.keys(cancellation).sort(),['requestId','target','type']);
 assert.ok(!JSON.stringify(f.messages).includes('"signal"'));
});
test('cancelling evaluation does not cancel an unrelated browsing request sharing the engine',async()=>{
 const f=fixture();await f.begin();const evalWork=assert.rejects(f.score());await tick();
 const browsing=f.transport.infer({texts:['Unrelated browsing headline'],localOnly:false});
 await f.cancel();await evalWork;const answer=await browsing;
 assert.equal(answer.results[0].source,'cloud');
 assert.equal(f.calls.filter(c=>c.text==='Synthetic evaluation headline'&&c.mode==='cloud').length,0);
 assert.equal(f.calls.filter(c=>c.text==='Unrelated browsing headline'&&c.mode==='cloud').length,1);
});
test('cancel during initialization never dispatches the headline after preparation finishes',async()=>{
 const ready=deferred(),f=fixture({prepare:async p=>{await ready.promise;return p;}});await f.begin();
 const work=assert.rejects(f.score());await tick();await f.cancel();await work;ready.resolve();await tick();
 assert.equal(f.calls.length,0);assert.equal(f.messages.filter(m=>m.texts).length,0);
});
test('cancel during cloud authentication prevents generateContent after the connection resolves',async()=>{
 const auth=deferred();let connecting=false;
 const f=fixture({local:async()=>{throw new Error('Nano failed');},auth:()=>{connecting=true;return auth.promise;}});await f.begin();
 const work=assert.rejects(f.score());while(!connecting)await tick();await f.cancel();await work;auth.resolve({});await tick();
 assert.equal(f.calls.filter(c=>c.mode==='cloud').length,0);
});
test('cancel while waiting in the shared gate cannot later start local or cloud inference',async()=>{
 const waiting=deferred(),f=fixture({gate:{run:async op=>{await waiting.promise;return op();}}});await f.begin();
 const work=assert.rejects(f.score());await tick();await f.cancel();waiting.resolve();await work;assert.equal(f.calls.length,0);
});
test('cancel while queued for Nano leaves the unrelated slot owner running',async()=>{
 const owner=deferred();const f=fixture({local:async(text,signal)=>{
  if(text==='Slot owner')return owner.promise;
  throw new Error('Cancelled request unexpectedly started');
 }});
 const browsing=f.runtime.scoreHeadlines(['Slot owner'],{localOnly:true});await tick();await f.begin();
 const work=assert.rejects(f.score());await tick();await f.cancel();await work;
 assert.equal(f.calls.length,1);owner.resolve(response('Slot owner','on_device'));assert.equal((await browsing)[0].source,'on-device');
});
test('cancel tombstones handle reordered start messages, duplicate dispatches and unrelated IDs',async()=>{
 const registry=createInferenceRequests();registry.cancel('cancelled-before-start');let calls=0;
 await assert.rejects(registry.run('cancelled-before-start',async()=>calls++),e=>e.code==='debait/cancelled');
 await registry.run('other',async()=>calls++);await assert.rejects(registry.run('other',async()=>calls++));assert.equal(calls,1);
});
test('registry bounds and expires completed IDs without evicting active or unexpired cancellations',async()=>{
 let now=0;const registry=createInferenceRequests({now:()=>now,retentionMs:10,limit:2}),active=deferred();
 const job=registry.run('active',()=>active.promise);registry.cancel('cancelled');
 await assert.rejects(registry.run('overflow',async()=>{}));now=11;
 await registry.run('new',async()=>{});await assert.rejects(registry.run('active',async()=>{}));active.resolve();await job;
});
test('unconfirmed cancellation times out honestly instead of acknowledging success',async()=>{
 const transport=createInferenceTransport({prepare:async p=>p,contexts:async()=>[{}],send:()=>new Promise(()=>{}),cancelTimeoutMs:5});
 await assert.rejects(transport.cancel('scoped-id'),e=>e.code==='debait/evaluation-cancel-pending');
});
test('cancellation before an offscreen document exists does not create one or send a headline',async()=>{
 const controller=new AbortController(),ready=deferred();let messages=0;
 const transport=createInferenceTransport({prepare:async p=>{await ready.promise;return p;},contexts:async()=>[],send:async()=>{messages++;}});
 const operation=assert.rejects(transport.infer({texts:['Synthetic headline']},controller.signal));await tick();controller.abort();
 assert.equal((await transport.cancel('no-document')).ok,true);await operation;ready.resolve();await tick();assert.equal(messages,0);
});

test('scoped Local Only cancellation never switches to cloud',async()=>{
 const f=fixture({localOnly:true,auth:async()=>{throw new Error('Cloud authentication must not run');}});
 await f.begin();const work=assert.rejects(f.score());await tick();await f.cancel();await work;
 await new Promise(r=>setTimeout(r,35));assert.equal(f.calls.filter(c=>c.mode==='cloud').length,0);
});
test('malformed request IDs cannot echo private data into cancellation diagnostics',()=>{
 const registry=createInferenceRequests();
 assert.throws(()=>registry.cancel('https://private.example/?token=PRIVATE_TEST_ONLY'),error=>!error.message.includes('PRIVATE_TEST_ONLY'));
});
