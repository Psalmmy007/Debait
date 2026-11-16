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
