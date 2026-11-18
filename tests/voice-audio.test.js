import test from 'node:test';import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';import vm from 'node:vm';
import { startVoiceAudio } from '../src/offscreen/voice-audio.js';
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{resolve,promise};};
function fixture(overrides={}){
 const nodes=[],contexts=[],sent=[],wire=[];let stopped=0,allowed=true,wake;const inbox=[];
 const stream={getTracks:()=>[{stop(){stopped++;},addEventListener(){}}]};
 const node=()=>({connect(){},disconnect(){}});
 class Context{constructor({sampleRate}){this.sampleRate=sampleRate;this.state='running';this.destination={};this.audioWorklet={addModule:async url=>{assert.equal(url,'extension-local-worklets.js');}};contexts.push(this);}resume=async()=>{};close=async()=>{this.state='closed';};createMediaStreamSource=node;createGain=()=>({...node(),gain:{value:1}});}
 class Worklet{constructor(ctx,name){this.name=name;this.port={postMessage:value=>sent.push({name,value})};nodes.push(this);}connect(){}disconnect(){}}
 const session={sendAudioRealtime:async frame=>wire.push(frame),sendFunctionResponses:async responses=>wire.push(responses),
  async *receive(){while(true){if(!inbox.length)await new Promise(r=>{wake=r;});const message=inbox.shift();if(message===null)return;yield message;}}};
 const abort=new AbortController();const options={signal:abort.signal,assertAllowed:async()=>{if(!allowed)throw new Error('LOCAL_ONLY');},functionCallingHandler:async calls=>({id:calls[0].id,name:calls[0].name,response:{ok:true}})};
 const dependencies={media:{getUserMedia:async constraints=>{assert.equal(constraints.audio.noiseSuppression,true);assert.equal(constraints.audio.echoCancellation,true);return stream;}},AudioContext:Context,AudioWorkletNode:Worklet,workletUrl:'extension-local-worklets.js',...overrides};
 return{options,dependencies,session,nodes,contexts,sent,wire,abort,stream,stops:()=>stopped,disallow:()=>{allowed=false;},push:message=>{inbox.push(message);wake?.();wake=null;}};
}
test('audio uses native noise processing, exact rates and cleans up microphone/contexts on stop',async()=>{
 const f=fixture();const c=await startVoiceAudio(f.session,f.options,f.dependencies);
 assert.deepEqual(f.contexts.map(c=>c.sampleRate),[16000,24000]);
 f.nodes[0].port.onmessage({data:new ArrayBuffer(1280)});await tick();assert.equal(f.wire[0].mimeType,'audio/pcm;rate=16000');
 await c.stop();await c.stop();assert.equal(f.stops(),1);assert.ok(f.contexts.every(c=>c.state==='closed'));assert.equal((await c.done).reason,'stopped');
});
test('denied permission and worklet initialization failure release every acquired track',async()=>{
 const denied=fixture({media:{getUserMedia:async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}}});
 await assert.rejects(startVoiceAudio(denied.session,denied.options,denied.dependencies),{name:'NotAllowedError'});
 const f=fixture();f.dependencies.AudioWorkletNode=class{constructor(){throw new Error('processor unavailable');}};
 await assert.rejects(startVoiceAudio(f.session,f.options,f.dependencies));assert.equal(f.stops(),1);assert.ok(f.contexts.every(c=>c.state==='closed'));
});
test('a late microphone permission result is stopped after cancellation, with no duplicate capture',async()=>{
 const pending=deferred();const f=fixture({media:{getUserMedia:()=>pending.promise}});
 const setup=startVoiceAudio(f.session,f.options,f.dependencies);await tick();f.abort.abort();
 await assert.rejects(startVoiceAudio(f.session,f.options,f.dependencies),/previous microphone/);
 pending.resolve(f.stream);await assert.rejects(setup,/stopped/);assert.equal(f.stops(),1);assert.equal(f.contexts.length,0);
});
test('privacy guard prevents queued microphone frames and page responses from reaching the server',async()=>{
 const f=fixture();const c=await startVoiceAudio(f.session,f.options,f.dependencies);f.disallow();
 f.nodes[0].port.onmessage({data:new ArrayBuffer(1280)});await tick();assert.equal(f.wire.length,0);
 f.push({type:'toolCall',functionCalls:[{id:'1',name:'page_report'}]});await tick();assert.equal(f.wire.length,0);await c.stop();
});
test('interrupted playback is cleared and short final audio is explicitly flushed',async()=>{
 const f=fixture();const c=await startVoiceAudio(f.session,f.options,f.dependencies);
 f.push({type:'serverContent',interrupted:true,modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:btoa('\0\0')}}]},turnComplete:true});
 await tick();assert.ok(f.sent.some(s=>s.value==='clear'));assert.ok(f.sent.some(s=>s.value==='flush'));
 assert.ok(f.sent.some(s=>s.value instanceof Float32Array));await c.stop();
});
test('unsupported PCM and playback overflow report errors rather than pretending audio succeeded',async()=>{
 const f=fixture();const c=await startVoiceAudio(f.session,f.options,f.dependencies);
 f.push({type:'serverContent',modelTurn:{parts:[{inlineData:{mimeType:'audio/wav',data:'AA=='}}]}});
 assert.equal((await c.done).reason,'audio');await c.stop();
 const g=fixture();const d=await startVoiceAudio(g.session,g.options,g.dependencies);g.nodes[1].port.onmessage({data:{type:'overflow'}});
 assert.match((await d.done).message,/stopped/);await d.stop();
});
test('tool batches are handled serially, and provider-cancelled calls do not execute',async()=>{
 const f=fixture();const executed=[];f.options.functionCallingHandler=async calls=>{executed.push(calls[0].id);return{id:calls[0].id,name:calls[0].name,response:{ok:true}};};
 const c=await startVoiceAudio(f.session,f.options,f.dependencies);
 f.push({type:'toolCallCancellation',functionIds:['cancelled']});
 f.push({type:'toolCall',functionCalls:[{id:'a',name:'one'},{id:'cancelled',name:'two'},{id:'b',name:'three'}]});
 await tick();await tick();assert.deepEqual(executed,['a','b']);await c.stop();
});
function processors(rate){const found={};vm.runInNewContext(readFileSync(new URL('../public/voice-worklets.js',import.meta.url),'utf8'),{
 sampleRate:rate,ArrayBuffer,DataView,Float32Array,Math,
 AudioWorkletProcessor:class{constructor(){this.messages=[];this.port={postMessage:m=>this.messages.push(m)};}},registerProcessor:(name,type)=>{found[name]=type;}});return found;}
test('microphone worklet emits contiguous 40ms PCM16 little-endian frames',()=>{
 const Mic=processors(16000)['debait-mic'],mic=new Mic();
 for(let i=0;i<5;i++)mic.process([[new Float32Array(128).fill(-1)]]);
 assert.equal(mic.messages.length,1);assert.equal(mic.messages[0].byteLength,1280);assert.equal(new DataView(mic.messages[0]).getInt16(0,true),-32768);
});
test('jitter buffer flushes utterances shorter than its cushion, clears interruptions and bounds memory',()=>{
 const Player=processors(24000)['debait-player'],p=new Player();const block=()=>{const out=new Float32Array(128);p.process([],[[out]]);return out;};
 p.port.onmessage({data:new Float32Array(240).fill(.5)});assert.ok(block().every(v=>v===0));
 p.port.onmessage({data:'flush'});assert.ok(block().some(v=>v>0));p.port.onmessage({data:'clear'});assert.ok(block().every(v=>v===0));
 p.port.onmessage({data:new Float32Array(24000*6)});assert.ok(p.messages.some(m=>m.type==='overflow'));assert.equal(p.buffered,0);
});

test('unsupported context rates and suspended audio setup fail honestly and clean tracks',async()=>{
 const f=fixture();const Original=f.dependencies.AudioContext;
 f.dependencies.AudioContext=class extends Original{constructor(options){super(options);this.sampleRate=48000;}};
 await assert.rejects(startVoiceAudio(f.session,f.options,f.dependencies),/required 16 kHz/);assert.equal(f.stops(),1);
 const g=fixture();const Base=g.dependencies.AudioContext;
 g.dependencies.AudioContext=class extends Base{resume=()=>new Promise(()=>{});};g.dependencies.initTimeoutMs=5;
 await assert.rejects(startVoiceAudio(g.session,g.options,g.dependencies),/did not start/);assert.equal(g.stops(),1);assert.ok(g.contexts.every(c=>c.state==='closed'));
});
