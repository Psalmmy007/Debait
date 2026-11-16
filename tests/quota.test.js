import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestGate } from '../src/background/requestGate.js';
import { retryDelayMs, quotaError, planAnalysisRetry } from '../src/shared/quota.js';
import { aiError } from '../src/engine/errors.js';

function fixture(config = {}) {
  let time = Date.UTC(2026, 10, 15), stored;
  const options = { read: async () => stored, write: async value => { stored = structuredClone(value); }, now: () => time, random: () => 0, ...config };
  return { gate: createRequestGate(options), restart: () => createRequestGate(options), advance: ms => { time += ms; }, now: () => time, state: () => stored };
}
const quota = () => quotaError('rate limited', 0);

test('pacing allows one start per ten seconds and no concurrent distinct batch', async () => {
  const f = fixture(); let release, calls = 0;
  const pending = f.gate.run(async () => { calls++; await new Promise(resolve => { release = resolve; }); });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.gate.run(async () => { calls++; }), error => error.code === 'debait/quota-pacing');
  release(); await pending;
  await assert.rejects(f.gate.run(async () => { calls++; }), error => error.retryAt >= f.now() + 10000);
  f.advance(10000); await f.gate.run(async () => { calls++; }); assert.equal(calls, 2);
});

test('pacing and active reservation survive a worker restart', async () => {
  const f = fixture(); let release;
  const pending = f.gate.run(() => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  f.advance(10000);
  await assert.rejects(f.restart().run(async () => {}), error => error.retryAt >= f.state().busyUntil);
  release(); await pending;
});

test('429 backoff grows, stops automatic retries, and clears after a later success', async () => {
  const f = fixture();
  for (const [index, delay] of [30000, 60000, 120000].entries()) {
    await assert.rejects(f.gate.run(async () => { throw quota(); }), error => {
      assert.equal(error.retryAt, f.now() + delay); assert.equal(error.autoRetry, index < 2); return true;
    });
    await assert.rejects(f.gate.run(async () => { throw new Error('must not dispatch during cooldown'); }), /cooldown/);
    f.advance(delay);
  }
  await f.gate.run(async () => 'success'); assert.equal(f.state().failures, 0); assert.equal(f.state().retryAt, 0);
});

test('server retry guidance is a lower bound, including across a worker restart', async () => {
  const f = fixture();
  await assert.rejects(f.gate.run(async () => { throw Object.assign(quota(), { retryAfterMs: 180000 }); }), error => error.retryAt === f.now() + 180000);
  f.advance(60000);
  await assert.rejects(f.restart().run(async () => {}), /cooldown/);
  f.advance(120000); await f.restart().run(async () => {});
});

test('conservative daily budget never dispatches excess requests and resets next UTC day', async () => {
  const f = fixture({ dailyLimit: 2 }); let calls = 0;
  await f.gate.run(async () => calls++); f.advance(10000); await f.gate.run(async () => calls++);
  f.advance(10000); await assert.rejects(f.restart().run(async () => calls++), error => error.code === 'debait/quota-daily' && error.autoRetry === false);
  assert.equal(calls, 2); f.advance(86400000); await f.restart().run(async () => calls++); assert.equal(calls, 3);
});

test('quota status detection supports the actual Firebase SDK customData.status field', () => {
  const error = aiError({ code: 'ai/fetch-error', customData: { status: 429, errorDetails: [
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '75.5s' },
  ] } });
  assert.equal(error.code, 'debait/quota'); assert.equal(error.retryAfterMs, 75500);
  assert.ok(!error.message.includes('errorDetails'));
});

test('Retry-After accepts seconds and HTTP dates; invalid guidance falls back safely', () => {
  assert.equal(retryDelayMs({ headers: { get: () => '12' } }), 12000);
  const now = Date.UTC(2026, 10, 15);
  assert.equal(retryDelayMs({ response: { headers: { get: () => new Date(now + 90000).toUTCString() } } }, now), 90000);
  assert.equal(retryDelayMs({ headers: { get: () => 'invalid' }, customData: { errorDetails: {} } }), 0);
  assert.equal(retryDelayMs({ customData: { errorDetails: [{ '@type': 'google.rpc.RetryInfo', retryDelay: { seconds: '5', nanos: 500000000 } }] } }), 5500);
});

test('each headline gets at most two automatic retries, respecting cooldown and no-retry instructions', () => {
  const records = [{}, {}]; const error = { retryAt: 90000 };
  assert.equal(planAnalysisRetry(records, error, 0, () => 0).at, 90000);
  assert.equal(planAnalysisRetry(records, error, 0, () => 0).records.length, 2);
  assert.equal(planAnalysisRetry(records, error, 0, () => 0), null);
  assert.ok(records.every(record => record.retryStopped));
  assert.equal(planAnalysisRetry([{}], { autoRetry: false }, 0), null);
});

test('non-quota failures are not retried inside the centralized gate', async () => {
  const f = fixture(); let calls = 0;
  await assert.rejects(f.gate.run(async () => { calls++; throw new Error('authentication failed'); }), /authentication failed/);
  assert.equal(calls, 1); assert.equal(f.state().failures, 0);
});

test('normal pacing waits have a separate bounded budget and do not consume 429 retries', () => {
  const record = {};
  for (let i = 0; i < 30; i++) assert.ok(planAnalysisRetry([record], { code: 'debait/quota-pacing', retryAt: 10000 }, 0, () => 0));
  assert.equal(record.analysisRetries, undefined); assert.equal(record.pacingDeferrals, 30);
  assert.equal(planAnalysisRetry([record], { code: 'debait/quota-pacing' }, 0), null);
});

test('long server delays are not converted to an overflowing browser timer', () => {
  assert.equal(planAnalysisRetry([{}], { retryAt: 3e9 }, 0), null);
});

test('local budgets are configurable and reject invalid values', async () => {
  const { quotaConfig } = await import('../src/shared/quotaConfig.js');
  assert.deepEqual(quotaConfig({}), { rpm: 6, intervalMs: 10000, dailyLimit: 240 });
  assert.deepEqual(quotaConfig({ VITE_DEBAIT_QUOTA_RPM: '3', VITE_DEBAIT_QUOTA_RPD: '100' }), { rpm: 3, intervalMs: 20000, dailyLimit: 100 });
  for (const value of ['0', '-1', 'abc', '1.5', 'Infinity']) assert.throws(() => quotaConfig({ VITE_DEBAIT_QUOTA_RPM: value }), /positive integer/);
});

test('configured budgets really change pacing and distinguish local waiting from server cooldown', async () => {
  const { quotaConfig } = await import('../src/shared/quotaConfig.js');
  const f = fixture(quotaConfig({ VITE_DEBAIT_QUOTA_RPM: '3' }));
  await f.gate.run(async () => {}); f.advance(10000);
  await assert.rejects(f.gate.run(async () => {}), error => error.code === 'debait/quota-pacing' && /local request slot/.test(error.message));
  f.advance(10000);
  await assert.rejects(f.gate.run(async () => { throw quota(); }), error => error.code === 'debait/quota' && /server rate limit/.test(error.message));
});
