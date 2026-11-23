import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeadlineEngine } from '../src/engine/inference.js';
import { createEngine } from '../src/engine/runtime.js';
import { createDeviceQueue } from '../src/engine/hybrid.js';
const tick = () => new Promise(resolve=>setImmediate(resolve));
const budgets={device:20,localOnly:70,cloud:100,slowCooldown:1000};
const answer=source=>({response:{inferenceSource:source,text:()=>JSON.stringify({results:[{kind:'clean',score:0,triggers:[],honest_rewrite:'City council approves a budget'}]})}});
function fixture({available='available',local,cloud=async()=>answer('in_cloud')}={}){
 const calls={auth:0,device:0,cloud:0,abort:0};let signal;
 const sdk=createHeadlineEngine({budgets,prompt:()=> 'controlled synthetic headline',deviceAvailability:async()=>available,
  getDeviceAi:()=>({device:true}),getAi:async()=>{calls.auth++;return{device:false};},InferenceMode:{ONLY_ON_DEVICE:'local',ONLY_IN_CLOUD:'cloud'},
  getGenerativeModel:(_ai,config)=>({generateContent:async(_input,options)=>{
   assert.equal(config.onDeviceParams.promptOptions.signal,options.signal);
   assert.equal(config.onDeviceParams.createOptions.signal,options.signal);
   if(config.mode==='cloud'){calls.cloud++;return cloud(options.signal);}
   calls.device++;signal=options.signal;
   return local ? local(options.signal) : new Promise((_,reject)=>{options.signal.addEventListener('abort',()=>{calls.abort++;reject(new DOMException('Aborted','AbortError'));},{once:true});});
  }})});
 return{sdk,calls,signal:()=>signal};
}
test('available Nano success uses the Firebase on-device mode without cloud authentication',async()=>{
 const f=fixture({local:async()=>answer('on_device')});const result=await f.sdk.scoreHeadlines(['City council approves a budget'],{localOnly:false});
 assert.equal(result[0].source,'on-device');assert.deepEqual(f.calls,{auth:0,device:1,cloud:0,abort:0});
});
test('slow Nano is aborted once then exactly one authenticated cloud request; subsequent hybrid requests skip slow Nano',async()=>{
 const f=fixture();for(let i=0;i<2;i++)assert.equal((await f.sdk.scoreHeadlines(['City council approves a budget'],{localOnly:false}))[0].source,'cloud');
 assert.equal(f.calls.device,1);assert.equal(f.calls.abort,1);assert.equal(f.calls.cloud,2);assert.equal(f.calls.auth,2);
});
test('failed Nano falls back once, unavailable Nano goes directly to cloud, and cloud failure never produces a classification',async()=>{
 for(const available of ['available','unavailable']){
  const f=fixture({available,local:async()=>{throw new Error('device execution failed');},cloud:async()=>{throw new Error('403 forbidden');}});
  await assert.rejects(f.sdk.scoreHeadlines(['City council approves a budget'],{localOnly:false}),e=>e.code==='debait/access');
  assert.equal(f.calls.cloud,1);assert.equal((await f.sdk.getStatus({localOnly:false})).source,'none');
 }
});
test('Local Only slow or failed Nano never authenticates or submits cloud work',async()=>{
 for(const local of [undefined,async()=>{throw new Error('device failed');}]){
  const f=fixture({local});await assert.rejects(f.sdk.scoreHeadlines(['City council approves a budget'],{localOnly:true}));
  assert.equal(f.calls.auth,0);assert.equal(f.calls.cloud,0);assert.ok(f.signal().aborted);
 }
 const f=fixture({available:'unavailable'});await assert.rejects(f.sdk.scoreHeadlines(['headline'],{localOnly:true}),e=>e.code==='debait/device-unavailable');
 assert.equal(f.calls.device+f.calls.cloud+f.calls.auth,0);
});
test('Local Only permits a response slower than the hybrid budget',async()=>{
 const f=fixture({local:()=>new Promise(resolve=>setTimeout(()=>resolve(answer('on_device')),35))});
 assert.equal((await f.sdk.scoreHeadlines(['City council approves a budget'],{localOnly:true}))[0].source,'on-device');assert.equal(f.calls.cloud,0);
});
test('caller cancellation before or during Nano prevents cloud fallback',async()=>{
 const f=fixture();const controller=new AbortController();const work=f.sdk.scoreHeadlines(['headline'],{localOnly:false,signal:controller.signal});
 await tick();controller.abort();await assert.rejects(work,e=>e.code==='debait/cancelled');
 assert.equal(f.calls.cloud,0);assert.ok(f.signal().aborted);
 const g=fixture();await assert.rejects(g.sdk.scoreHeadlines(['headline'],{localOnly:false,signal:controller.signal}));assert.equal(g.calls.device+g.calls.auth,0);
});
test('a cancelled uncooperative local SDK operation retains its slot and prevents overlapping local prompts',async()=>{
 let finish;const f=fixture({local:()=>new Promise(resolve=>{finish=resolve;})});
 await assert.rejects(f.sdk.scoreHeadlines(['headline'],{localOnly:true}));
 await assert.rejects(f.sdk.scoreHeadlines(['headline'],{localOnly:true}));
 assert.equal(f.calls.device,1);assert.equal(f.calls.cloud,0);finish(answer('on_device'));await tick();
});
test('local queue is bounded, supports waiting cancellation and never overlaps jobs',async()=>{
 const run=createDeviceQueue(1),controller=new AbortController();let release,started=0;
 const first=run(()=>new Promise(resolve=>{started++;release=resolve;}));
 const waiting=run(async()=>{started++;},controller.signal);const rejected=assert.rejects(waiting);
 await assert.rejects(run(async()=>{}),e=>e.code==='debait/device-busy');controller.abort();await rejected;release();await first;assert.equal(started,1);
});
test('runtime cancellation reaches active SDK work and cannot turn a late answer into success',async()=>{
 let signal,finish;const runtime=createEngine({firebaseEngine:{scoreHeadlines:async(_texts,opts)=>{signal=opts.signal;return new Promise(resolve=>{finish=resolve;});}},mockEngine:{}});
 const work=runtime.scoreHeadlines(['headline'],{localOnly:false});await tick();runtime.cancelAll();
 await assert.rejects(work,e=>e.code==='debait/cancelled');assert.ok(signal.aborted);finish([{source:'cloud'}]);
});
test('an on-device response is never accepted from an explicit cloud route or vice versa',async()=>{
 const local=fixture({local:async()=>answer('in_cloud')});await assert.rejects(local.sdk.scoreHeadlines(['headline'],{localOnly:false}));assert.equal(local.calls.cloud,0);
 const cloud=fixture({available:'unavailable',cloud:async()=>answer('on_device')});await assert.rejects(cloud.sdk.scoreHeadlines(['headline'],{localOnly:false}));
});
