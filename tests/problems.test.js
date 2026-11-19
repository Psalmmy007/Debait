import test from 'node:test';
import assert from 'node:assert/strict';
import { problemEntry, recentProblems, createProblemLogger } from '../src/shared/problems.js';

test('diagnostics never echo credential URLs, headers, page text, stack traces or hostile phase names', () => {
  const secret = 'PRIVATE_TEST_SECRET';
  for (const where of ['voice startup', 'voice session', 'voice microphone', `content private.example/${secret}`, secret]) {
    const result = problemEntry(where, new Error(`App Check https://private.example/?token=${secret}\nAuthorization: Bearer ${secret}\nprivate headline ${secret}`));
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!JSON.stringify(result).includes('private.example'));
    assert.ok(!result.message.includes('\n'));
  }
});
test('known failure descriptions remain useful and stable when read again', () => {
  for (const raw of ['microphone denied', '403 unauthorized', '404 model not found', '429 quota', 'network offline', 'audio worklet unavailable', 'LOCAL_ONLY']) {
    const entry = problemEntry('voice startup', raw);
    assert.deepEqual(problemEntry(entry.where, entry.message, entry.at), entry);
  }
});
test('legacy malformed, expired and future diagnostics cannot break or leak from the popup', () => {
  const now = Date.now(), at = new Date(now - 1000).toISOString();
  assert.deepEqual(recentProblems(null, now), []);
  const entries = recentProblems([null, {}, {at,where:'voice session',message:{secret:'PRIVATE'}},
    {at,message:'PRIVATE headline'}, {at:new Date(now+1000).toISOString()}, {at:new Date(now-1800001).toISOString()}], now);
  assert.equal(entries.length, 2); assert.ok(!JSON.stringify(entries).includes('PRIVATE'));
});
test('concurrent diagnostics are serialized and bounded without losing simultaneous voice errors', async () => {
  let data = []; const logger = createProblemLogger({read:async()=>structuredClone(data),write:async entries=>{data=entries;}});
  await Promise.all([logger('voice startup','microphone denied'),logger('voice session','network offline')]);
  assert.deepEqual(data.map(e=>e.where), ['voice session','voice startup']);
  await Promise.all(Array.from({length:20},()=>logger('background','PRIVATE')));
  assert.equal(data.length,15); assert.ok(!JSON.stringify(data).includes('PRIVATE'));
});
test('a failed storage write does not permanently block later diagnostics', async () => {
  let calls = 0, data=[];
  const logger=createProblemLogger({read:async()=>data,write:async entries=>{if(!calls++)throw new Error('storage unavailable');data=entries;}});
  await assert.rejects(logger('voice startup','network offline'));
  await logger('voice session','microphone denied'); assert.equal(data.length,1);
});
test('legacy stored diagnostics are scrubbed even before any new error occurs',async()=>{
  let data=[{at:new Date().toISOString(),where:'content private.example',message:'PRIVATE_TEST_SECRET'}];
  const logger=createProblemLogger({read:async()=>data,write:async entries=>{data=entries;}});
  await logger.sanitize();assert.equal(data.length,1);assert.ok(!JSON.stringify(data).includes('PRIVATE_TEST_SECRET'));
  assert.equal(data[0].where,'content');
});
