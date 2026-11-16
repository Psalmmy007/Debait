import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvaluationService, evaluationError } from '../src/background/evaluation.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const sender = { documentId: 'document-A' };
const answer = (source = 'cloud') => ({ results: [{ kind: 'clean', score: 0, triggers: [], honest_rewrite: 'Headline', source }],
  evaluationMetadata: { configuredModel: 'test-model', sdkVersion: 'test-sdk', secret: 'must-not-escape', resolvedModelVersion: 'untrusted' } });
function fixture({ infer = async () => answer() } = {}) {
  let localOnly = false, revision = 0, calls = 0, gates = 0;
  const service = createEvaluationService({ authorize: async () => {}, settings: async () => ({ localOnly }), revision: () => revision,
    gate: { run: operation => { gates++; return operation(); } }, infer: opts => { calls++; return infer(opts); }, metadata: { gitSha: 'test-sha', policyVersion: 'test-policy' }, uuid: () => 'run-A' });
  return { service, counts: () => ({ calls, gates }), privacy(value) { localOnly = value; revision++; },
    begin: () => service.handle({ type: 'debait/evaluation-begin' }, sender),
    score: () => service.handle({ type: 'debait/evaluation-score', runId: 'run-A', texts: ['Headline'] }, sender) };
}
test('fresh inference uses the gate and whitelists provenance, not raw provider metadata', async () => {
  const f = fixture(); const begin = await f.begin(); assert.equal(begin.gitSha, 'test-sha');
  const result = await f.score(); await f.score();
  assert.deepEqual(f.counts(), { calls: 2, gates: 2 }); // no cache hits masquerading as fresh
  assert.deepEqual(result.evaluationMetadata, { configuredModel: 'test-model', sdkVersion: 'test-sdk', resolvedModelVersion: 'unknown' });
});
test('Local Only uses device inference without entering the cloud request gate', async () => {
  const f = fixture({ infer: async opts => { assert.equal(opts.localOnly, true); return answer('on-device'); } });
  f.privacy(true); await f.begin(); assert.equal((await f.score()).results[0].source, 'on-device');
  assert.deepEqual(f.counts(), { calls: 1, gates: 0 });
});
for (const source of ['mock', 'guessed', 'cloud']) {
  test(`Local Only rejects ${source} output`, async () => {
    const f = fixture({ infer: async () => answer(source) }); f.privacy(true); await f.begin(); await assert.rejects(f.score());
  });
}
test('privacy changes before dispatch prevent any inference', async () => {
  const f = fixture(); await f.begin(); f.privacy(true); await assert.rejects(f.score(), { code: 'debait/evaluation-privacy' });
  assert.equal(f.counts().calls, 0);
});
test('privacy revision changes during inference discard even a later-returned cloud result', async () => {
  const pending = deferred(); const f = fixture({ infer: () => pending.promise }); await f.begin();
  const operation = f.score(); await new Promise(r => setImmediate(r)); f.privacy(true); f.privacy(false);
  pending.resolve(answer()); await assert.rejects(operation, { code: 'debait/evaluation-privacy' });
});
test('cancellation discards pending results and prevents further dispatch; busy runs cannot overlap', async () => {
  const pending = deferred(); const f = fixture({ infer: () => pending.promise }); await f.begin();
  const operation = f.score(); await new Promise(r => setImmediate(r));
  await assert.rejects(f.score(), { code: 'debait/evaluation-busy' });
  await assert.rejects(f.begin(), { code: 'debait/evaluation-busy' });
  await f.service.handle({ type: 'debait/evaluation-cancel', runId: 'run-A' }, sender);
  pending.resolve(answer()); await assert.rejects(operation, { code: 'debait/evaluation-cancelled' });
  await assert.rejects(f.score(), { code: 'debait/evaluation-cancelled' }); assert.equal(f.counts().calls, 1);
});
test('worker restart or different document cannot resume a run', async () => {
  const f = fixture(); await assert.rejects(f.score(), { code: 'debait/evaluation-interrupted' });
  await f.begin();
  await assert.rejects(f.service.handle({ type: 'debait/evaluation-score', runId: 'run-A', texts: ['Headline'] }, { documentId: 'other' }), { code: 'debait/evaluation-interrupted' });
});
test('unknown errors cannot leak dataset or provider text into exports', () => {
  const result = evaluationError({ code: 'secret-code', message: 'private headline token', retryAt: 100, autoRetry: true });
  assert.ok(!JSON.stringify(result).includes('private')); assert.ok(!JSON.stringify(result).includes('secret-code'));
});
