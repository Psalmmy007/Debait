import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceSession } from '../src/offscreen/voiceSession.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const tick = () => new Promise(r => setImmediate(r));
function fixture(overrides = {}) {
  const calls = { connects: 0, audio: 0, stops: 0, closes: 0, tools: 0, greetings: 0 };
  let allowed = true, handler;
  const session = { close: async () => { calls.closes++; }, send: async () => { calls.greetings++; } };
  const controller = { stop: async () => { calls.stops++; } };
  const voice = createVoiceSession({
    isAllowed: async () => allowed,
    connect: async (_token, guard) => { await guard(); calls.connects++; return session; },
    startAudio: async (_s, opts) => { calls.audio++; handler = opts.functionCallingHandler; return controller; },
    sendTool: async () => { calls.tools++; return { result: { headline: 'private' } }; },
    state() {}, ...overrides,
  });
  return { voice, calls, session, controller, disallow: () => { allowed = false; }, handler: () => handler };
}

test('Local Only policy blocks a new connection before contacting Gemini or microphone', async () => {
  const f = fixture(); f.disallow();
  await f.voice.startCall('test');
  assert.equal(f.calls.connects, 0); assert.equal(f.calls.audio, 0);
  assert.equal(f.voice.inCall(), false);
});

test('policy failure fails closed', async () => {
  const f = fixture({ isAllowed: async () => { throw new Error('worker unavailable'); } });
  await f.voice.startCall('test');
  assert.equal(f.calls.connects, 0);
});

test('ending a live session stops audio and closes the connection', async () => {
  const f = fixture(); await f.voice.startCall('test');
  assert.equal(f.voice.inCall(), true);
  f.disallow(); await f.voice.endCall();
  assert.equal(f.calls.stops, 1); assert.equal(f.calls.closes, 1);
  assert.equal(f.voice.inCall(), false);
});

test('a connection resolving after cancellation is closed, never starts audio', async () => {
  const pending = deferred();
  const f = fixture({ connect: () => pending.promise });
  const start = f.voice.startCall('test'); await tick();
  f.disallow(); await f.voice.endCall();
  pending.resolve(f.session); await start;
  assert.equal(f.calls.closes, 1); assert.equal(f.calls.audio, 0);
  assert.equal(f.calls.greetings, 0);
});

test('microphone setup resolving after cancellation is stopped', async () => {
  const pending = deferred();
  const f = fixture({ startAudio: () => pending.promise });
  const start = f.voice.startCall('test'); await tick();
  f.disallow(); await f.voice.endCall();
  pending.resolve(f.controller); await start;
  assert.equal(f.calls.stops, 1); assert.equal(f.calls.closes, 1);
  assert.equal(f.voice.inCall(), false); assert.equal(f.calls.greetings, 0);
});

test('voice cannot read page tools after Local Only is enabled', async () => {
  const f = fixture(); await f.voice.startCall('test'); f.disallow();
  await assert.rejects(f.handler()([{ id: '1', name: 'page_report' }]), /LOCAL_ONLY/);
  assert.equal(f.calls.tools, 0); await f.voice.endCall();
});

test('page data arriving during a privacy change is not returned to Gemini', async () => {
  const pending = deferred();
  const f = fixture({ sendTool: () => pending.promise });
  await f.voice.startCall('test');
  const tool = f.handler()([{ id: '1', name: 'page_report' }]); await tick();
  f.disallow(); await f.voice.endCall(); pending.resolve({ result: { headline: 'private' } });
  await assert.rejects(tool, /LOCAL_ONLY/);
});

test('audio setup failure closes the opened session', async () => {
  const f = fixture({ startAudio: async () => { throw new Error('microphone denied'); } });
  await f.voice.startCall('test');
  assert.equal(f.calls.closes, 1); assert.equal(f.voice.inCall(), false);
});

test('failed page tool returns an explicit failure instead of dropping voice session', async () => {
  const f = fixture({ sendTool: async () => { throw new Error('tab closed'); } });
  await f.voice.startCall('test');
  const response = await f.handler()([{ id: '1', name: 'page_report' }]);
  assert.equal(response.id, '1');
  assert.match(response.response.error, /failed/);
  assert.equal(f.voice.inCall(), true);
  await f.voice.endCall();
});

test('failed page tool cannot return even an error after privacy changes', async () => {
  const pending = deferred();
  const f = fixture({ sendTool: () => pending.promise });
  await f.voice.startCall('test');
  const response = f.handler()([{ id: '1', name: 'page_report' }]);
  await tick();
  f.disallow();
  await f.voice.endCall();
  pending.resolve(Promise.reject(new Error('tab closed')));
  await assert.rejects(response, /LOCAL_ONLY/);
});

test('rapid duplicate start requests open one audio session and one connection', async () => {
  const f=fixture();await Promise.all([f.voice.startCall(),f.voice.startCall(),f.voice.startCall()]);
  assert.equal(f.calls.connects,1);assert.equal(f.calls.audio,1);await f.voice.endCall();
});
test('replayed action IDs return the recorded result without executing the page tool twice',async()=>{
  const f=fixture();await f.voice.startCall();const handler=f.handler();
  const call={id:'same-id',name:'debait_page',args:{}};
  const [a,b]=await Promise.all([handler([call]),handler([call])]);
  assert.equal(f.calls.tools,1);assert.equal(a.id,b.id);assert.equal(b.response.debait_replayed,true);
  const changed=await handler([{...call,args:{different:true}}]);assert.match(changed.response.error,/Reused/);assert.equal(f.calls.tools,1);
  await f.voice.endCall();
});
function reconnectFixture(overrides={}) {
  const controllers=[],connections=[],states=[],delays=[];let allowed=true,activeAudio=0,maxAudio=0,greetings=0;
  const voice=createVoiceSession({isAllowed:async()=>allowed,
    connect:async(_token,guard,options)=>{await guard();connections.push(options);return{send:async()=>{greetings++;},close:async()=>{}};},
    startAudio:async(_session,options)=>{const d=deferred();activeAudio++;maxAudio=Math.max(maxAudio,activeAudio);options.onResumeHandle('controlled-server-handle');
      const c={handler:options.functionCallingHandler,done:d.promise,drop:()=>d.resolve({reason:'network'}),stop:async()=>{activeAudio--;d.resolve({reason:'stopped'});}};controllers.push(c);return c;},
    sendTool:async()=>({result:{ok:true}}),state:(...s)=>states.push(s),wait:async ms=>{delays.push(ms);},maxRetries:2,...overrides});
  return{voice,controllers,connections,states,delays,disallow:()=>{allowed=false;},maxAudio:()=>maxAudio,greetings:()=>greetings};
}
test('supported server resumption is bounded across the call and never duplicates the microphone',async()=>{
  const f=reconnectFixture();await f.voice.startCall();
  for(let i=0;i<3;i++){f.controllers[i].drop();await tick();await tick();}
  assert.equal(f.connections.length,3);assert.deepEqual(f.delays,[10000,20000]);assert.equal(f.connections[1].handle,'controlled-server-handle');
  assert.equal(f.maxAudio(),1);assert.equal(f.greetings(),1);assert.equal(f.voice.inCall(),false);
  assert.ok(f.states.some(([s,m])=>s==='reconnected'&&m.includes('may be missing')));
});
test('cancellation during backoff prevents a reconnect even after the wait finishes',async()=>{
  const waiting=deferred();const f=reconnectFixture({wait:()=>waiting.promise});await f.voice.startCall();
  f.controllers[0].drop();await tick();f.disallow();await f.voice.endCall();waiting.resolve();await tick();
  assert.equal(f.connections.length,1);assert.equal(f.voice.inCall(),false);
});
test('a dropped connection without a server handle ends honestly instead of silently starting a new conversation',async()=>{
  const d=deferred();const states=[];let connections=0;
  const f=fixture({connect:async()=>{connections++;return{send:async()=>{},close:async()=>{}};},
    startAudio:async()=>({done:d.promise,stop:async()=>{}}),state:(...s)=>states.push(s)});
  await f.voice.startCall();d.resolve({reason:'network'});await tick();await tick();
  assert.equal(connections,1);assert.equal(f.voice.inCall(),false);assert.match(states.at(-1)[1],/new conversation/);
});
test('privacy revocation during backoff fails closed before opening another session',async()=>{
  const f=reconnectFixture({wait:async()=>{f.disallow();}});await f.voice.startCall();f.controllers[0].drop();await tick();await tick();
  assert.equal(f.connections.length,1);assert.equal(f.voice.inCall(),false);
});

test('a tool replay after resumption still cannot execute a page action twice',async()=>{
 let tools=0;const f=reconnectFixture({sendTool:async()=>{tools++;return{result:{ok:true}};}});await f.voice.startCall();
 const request={id:'resume-tool',name:'debait_page',args:{}};
 await f.controllers[0].handler([request]);f.controllers[0].drop();await tick();await tick();
 await f.controllers[1].handler([request]);assert.equal(tools,1);await f.voice.endCall();
});
