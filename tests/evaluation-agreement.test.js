import test from 'node:test';
import assert from 'node:assert/strict';
import { agreement, summarize } from '../dev/evaluation/agreement.js';
const valid = () => ({ status: 'success', reviewStatus: 'agreed', humanLabel: 'Fear', draftLabel: 'Envy', result: { kind: 'fear', source: 'cloud' } });
test('only agreed human references determine agreement, not draft expectations', () => {
  assert.deepEqual(agreement(valid()), { agreement_eligible: true, agreement: true, exclusion_reason: '' });
  assert.equal(agreement({ ...valid(), humanLabel: 'Rage' }).agreement, false);
});
for (const patch of [
  { reviewStatus: 'disputed' }, { reviewStatus: 'reviewed' }, { reviewStatus: '' }, { humanLabel: 'Curiosity Gap' },
  { humanLabel: 'Uncertain' }, { humanLabel: '' }, { status: 'failed' }, { status: 'cancelled' },
  { status: 'interrupted' }, { result: { kind: 'fear', source: 'mock' } }, { duplicateOf: 'first' },
]) test(`excludes indefensible comparison: ${JSON.stringify(patch)}`, () => {
  const result = agreement({ ...valid(), ...patch }); assert.equal(result.agreement_eligible, false); assert.equal(result.agreement, '');
});
test('summary exposes denominator, excluded rows and failures separately', () => {
  const summary = summarize([valid(), { ...valid(), humanLabel: 'Rage' }, { ...valid(), status: 'failed' }, { ...valid(), humanLabel: 'Uncertain' }]);
  assert.equal(summary.completed, 3); assert.equal(summary.failed, 1);
  assert.equal(summary.eligible, 2); assert.equal(summary.matches, 1); assert.equal(summary.agreement, 0.5); assert.equal(summary.excluded, 2);
  assert.equal(summarize([]).agreement, null);
});
