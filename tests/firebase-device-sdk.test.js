import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from '../node_modules/@firebase/ai/dist/esm/index.esm.js';
import { createHeadlineEngine } from '../src/engine/inference.js';
// Load the browser SDK entry: the Node entry deliberately has no Chrome adapter.
// Installed Firebase SDK -> controlled Chrome LanguageModel stand-in, NOT real Nano.
test('Firebase 13.3 forwards both create and prompt cancellation options and attributes local output',async t=>{
 let creates=0,prompts=0,network=0,slow=false,cancelled=0;const signals=[];
 t.mock.method(globalThis,'fetch',async()=>{network++;throw new Error('No network permitted in this controlled SDK test');});
 const previous=Object.getOwnPropertyDescriptor(globalThis,'LanguageModel');
 Object.defineProperty(globalThis,'LanguageModel',{configurable:true,value:{availability:async()=> 'available',
  create:async options=>{creates++;signals.push(options.signal);return{destroy(){},prompt:async(_messages,opts)=>{prompts++;assert.equal(opts.signal,options.signal);if(slow)return new Promise((_,reject)=>opts.signal.addEventListener('abort',()=>{cancelled++;reject(new DOMException('Aborted','AbortError'));},{once:true}));return JSON.stringify({results:[{kind:'clean',score:0,triggers:[],honest_rewrite:'City council approves a budget'}]});}};}}});
 const app=initializeApp({apiKey:'synthetic-public-api-key',projectId:'synthetic-project',appId:'synthetic-app'},'controlled-local-sdk');
 try{
  const ai=getAI(app,{backend:new GoogleAIBackend()});
  const engine=createHeadlineEngine({getDeviceAi:()=>ai,getAi:async()=>{throw new Error('No cloud authentication allowed');},getGenerativeModel,InferenceMode,
   budgets:{device:20,localOnly:20,cloud:30,slowCooldown:1000},deviceAvailability:async()=> 'available',cloudModel:'synthetic-cloud-model',prompt:()=> 'Synthetic headline',lang:[{type:'text',languages:['en']}],deviceSchema:{type:'object'}});
  const [result]=await engine.scoreHeadlines(['City council approves a budget'],{localOnly:true});
  assert.equal(result.source,'on-device');assert.equal(creates,1);assert.equal(prompts,1);assert.equal(network,0);assert.ok(signals[0] instanceof AbortSignal);
  slow=true;await assert.rejects(engine.scoreHeadlines(['City council approves a budget'],{localOnly:true}));
  assert.equal(cancelled,1);assert.equal(network,0);
 }finally{await deleteApp(app);if(previous)Object.defineProperty(globalThis,'LanguageModel',previous);else delete globalThis.LanguageModel;}
});
