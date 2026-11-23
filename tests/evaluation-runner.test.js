import test from 'node:test';
import assert from 'node:assert/strict';
import { importDataset, parseCsv } from '../dev/evaluation/csv.js';
import { createRun } from '../dev/evaluation/session.js';
const dataset = () => importDataset('id,headline,human_reference_label,review_status\nA,Headline,Clean,agreed\nB,Headline,Clean,agreed').rows;
const begin = { ok: true, runId: 'run', startedAt: '2026-11-16T12:00:00Z', gitSha: 'controlled-test-sha', policyVersion: 'test-policy', localOnly: false };
const response = () => ({ ok: true, results: [{ kind: 'clean', score: 0, triggers: [], honest_rewrite: 'Headline', source: 'cloud' }], evaluationMetadata: { configuredModel: 'test-model', sdkVersion: 'test-sdk', resolvedModelVersion: 'unknown' } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

test('CSV rows reuse one fresh result per identical headline and export complete provenance', async () => {
  const messages = [];
  const run = createRun(dataset(), { send: async msg => { messages.push(msg); return msg.type.endsWith('begin') ? begin : msg.type.endsWith('score') ? response() : { ok: true }; } });
  await run.start();
  assert.equal(messages.filter(m => m.type.endsWith('score')).length, 1);
  assert.deepEqual(messages.find(m => m.type.endsWith('score')).texts, ['Headline']);
  assert.ok(!JSON.stringify(messages).includes('human_reference')); // references never enter the model path
  const [headers, ...records] = parseCsv(run.csv());
  const first = Object.fromEntries(headers.map((h, i) => [h, records[0][i]]));
  assert.equal(first.git_sha, 'controlled-test-sha'); assert.equal(first.policy_version, 'test-policy');
  assert.equal(first.model_classification, 'clean'); assert.equal(first.inference_source, 'cloud');
  assert.equal(first.resolved_model_version, 'unknown'); assert.equal(first.agreement, 'true');
  assert.equal(records[1][headers.indexOf('evaluation_origin')], 'same_run_duplicate');
  assert.equal(records[1][headers.indexOf('exclusion_reason')], 'duplicate_headline');
});
test('quota cooldown and pacing are awaited before a bounded resubmission', async () => {
  const waits = []; let calls = 0;
  const run = createRun(dataset(), { now: () => 0, random: () => 0, wait: async ms => { waits.push(ms); }, send: async msg => {
    if (msg.type.endsWith('begin')) return begin;
    if (!msg.type.endsWith('score')) return { ok: true };
    calls++;
    if (calls === 1) return { ok: false, code: 'debait/quota-pacing', retryAt: 5000, autoRetry: true };
    if (calls === 2) return { ok: false, code: 'debait/quota', retryAt: 60000, autoRetry: true };
    return response();
  } });
  await run.start(); assert.deepEqual(waits, [5000, 60000]); assert.equal(calls, 3); assert.equal(run.rows[0].status, 'success');
});
test('server rate limits stop after two retries, never an unlimited retry loop', async () => {
  let calls = 0;
  const run = createRun(dataset(), { wait: async () => {}, send: async msg => {
    if (msg.type.endsWith('begin')) return begin;
    if (!msg.type.endsWith('score')) return { ok: true };
    calls++; return { ok: false, code: 'debait/quota', retryAt: Date.now() + 1000, autoRetry: true };
  } });
  await run.start(); assert.equal(calls, 3); assert.equal(run.rows[0].status, 'failed'); assert.equal(run.rows[0].result, undefined);
});
test('daily budget exhaustion stops without retries or fake Clean output', async () => {
  let calls = 0;
  const run = createRun(dataset(), { send: async msg => {
    if (msg.type.endsWith('begin')) return begin;
    if (!msg.type.endsWith('score')) return { ok: true };
    calls++; return { ok: false, code: 'debait/quota-daily', autoRetry: false, error: 'Daily budget reached' };
  } });
  await run.start(); assert.equal(calls, 1); assert.equal(run.rows[0].status, 'failed'); assert.equal(run.rows[0].result, undefined);
});
test('cancellation discards late responses, stops new batches and remains exportable', async () => {
  const pending = deferred(); let calls = 0; const signals = [];
  const rows = importDataset('headline\nOne\nTwo\nThree\nFour\nFive').rows;
  const run = createRun(rows, { send: async msg => {
    signals.push(msg.type);
    if (msg.type.endsWith('begin')) return begin;
    if (!msg.type.endsWith('score')) return { ok: true };
    calls++; return pending.promise;
  } });
  const operation = run.start(); await new Promise(r => setImmediate(r)); run.cancel();
  assert.ok(run.rows.every(r => r.status === 'cancelled'));
  pending.resolve({ ok: true, results: Array.from({ length: 4 }, () => response().results[0]) }); await operation;
  assert.equal(calls, 1); assert.ok(run.rows.every(r => !r.result)); assert.ok(signals.includes('debait/evaluation-cancel'));
  assert.ok(run.csv().includes('cancelled'));
});
test('cancellation during cooldown interrupts the wait without submitting again', async () => {
  let calls = 0; const waiting = deferred();
  const run = createRun(dataset(), { wait: async (_ms, signal) => { waiting.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); },
    send: async msg => {
      if (msg.type.endsWith('begin')) return begin;
      if (!msg.type.endsWith('score')) return { ok: true };
      calls++; return { ok: false, code: 'debait/quota', retryAt: Date.now() + 60000, autoRetry: true };
    } });
  const operation = run.start(); await waiting.promise; run.cancel(); await operation;
  assert.equal(calls, 1); assert.equal(run.rows[0].status, 'cancelled');
});
for (const code of ['debait/evaluation-privacy', 'debait/evaluation-interrupted']) {
  test(`privacy/worker interruption is explicit: ${code}`, async () => {
    const run = createRun(dataset(), { send: async msg => msg.type.endsWith('begin') ? begin : { ok: false, code } });
    await run.start(); assert.equal(run.rows[0].status, 'failed'); assert.equal(run.rows[0].result, undefined);
  });
}
test('transport failures export interrupted rows without private transport details', async () => {
  const run = createRun(dataset(), { send: async () => { throw new Error('private token'); } });
  await run.start(); assert.ok(run.rows.every(r => r.status === 'interrupted')); assert.ok(!run.csv().includes('private token'));
});
test('a mocked response cannot enter a real evaluation export', async () => {
  const supplied = response(); supplied.results[0].source = 'mock';
  const run = createRun(dataset(), { send: async msg => msg.type.endsWith('begin') ? begin : supplied });
  await run.start(); assert.equal(run.rows[0].status, 'interrupted'); assert.equal(run.rows[0].result, undefined);
});

test('identical headlines with conflicting agreed human labels are excluded on both rows', async () => {
  const rows = dataset(); rows[1].humanLabel = 'Fear';
  const run = createRun(rows, { send: async msg => msg.type.endsWith('begin') ? begin : msg.type.endsWith('score') ? response() : { ok: true } });
  await run.start();
  const [headers, ...records] = parseCsv(run.csv());
  assert.ok(records.every(row => row[headers.indexOf('exclusion_reason')] === 'conflicting_duplicate_references'));
});

test('an interruption before session creation still exports every provenance column', async () => {
  const run = createRun(dataset(), { send: async () => { throw new Error('Worker unavailable'); } });
  await run.start(); const [headers, record] = parseCsv(run.csv());
  for (const field of ['run_id', 'run_timestamp', 'git_sha', 'git_dirty', 'policy_version', 'local_only']) assert.ok(headers.includes(field));
  assert.equal(record[headers.indexOf('git_sha')], 'unknown');
});

test('cancelling before the worker begins a session cannot submit a batch later', async () => {
  const pending = deferred(); const messages = [];
  const run = createRun(dataset(), { send: async message => {
    messages.push(message.type);
    return message.type.endsWith('begin') ? pending.promise : { ok: true };
  } });
  const operation = run.start(); run.cancel(); pending.resolve(begin); await operation;
  assert.ok(!messages.includes('debait/evaluation-score'));
  assert.ok(messages.includes('debait/evaluation-cancel'));
  assert.ok(run.rows.every(row => row.status === 'cancelled'));
});

test('failed cancellation acknowledgement never claims that remote work stopped',async()=>{
 const messages=[];const pending=deferred();
 const run=createRun([{id:'cancel',text:'Synthetic headline'}],{send:async msg=>{
  if(msg.type==='debait/evaluation-begin')return{ok:true,runId:'controlled-run'};
  if(msg.type==='debait/evaluation-score')return pending.promise;
  return{ok:false,code:'debait/evaluation-cancel-pending'};
 },changed:(_rows,message)=>{if(message)messages.push(message);}});
 const work=run.start();await new Promise(r=>setImmediate(r));run.cancel();await new Promise(r=>setImmediate(r));
 assert.ok(messages.some(m=>m.includes('could not be confirmed')));
 pending.resolve({ok:false});await work;assert.ok(run.rows.every(r=>r.status==='cancelled'));
});

test('a run stays busy until its cancellation acknowledgement settles',async()=>{
 const inference=deferred(),ack=deferred();
 const run=createRun([{id:'wait',text:'Synthetic headline'}],{send:async msg=>{
  if(msg.type==='debait/evaluation-begin')return{ok:true,runId:'wait-run'};
  if(msg.type==='debait/evaluation-score')return inference.promise;
  if(msg.type==='debait/evaluation-cancel')return ack.promise;
  return{ok:true};
 }});
 const work=run.start();await new Promise(r=>setImmediate(r));run.cancel();inference.resolve({ok:false});
 await new Promise(r=>setImmediate(r));assert.equal(run.running,true);
 ack.resolve({ok:true});await work;assert.equal(run.running,false);
});
