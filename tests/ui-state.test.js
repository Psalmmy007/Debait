import test from 'node:test';
import assert from 'node:assert/strict';
import { orbFeedback, LIVE_KINDS } from '../src/shared/uiState.js';
import { INGREDIENTS } from '../src/shared/ingredients.js';
const result = (kind, source = 'cloud') => ({ kind, source });
test('orb reflects the single most common verified category, not the highest score', () => {
  assert.equal(orbFeedback({ results: [result('rage'), result('fear'), result('rage', 'on-device')] }).category, 'rage');
});
for (const kind of LIVE_KINDS) test(`orb supports verified ${kind} without changing AI results`, () => {
  const results = [Object.freeze(result(kind))];
  assert.equal(orbFeedback({ results }).category, kind);
  assert.equal(results[0].kind, kind);
});
test('orb ties do not invent a dominant emotion', () => {
  const feedback = orbFeedback({ results: [result('rage'), result('fear')] });
  assert.equal(feedback.category, null); assert.equal(feedback.state, 'mixed');
});
test('orb remains neutral for empty, mock, unknown-source and unsupported categories', () => {
  for (const results of [[], [result('envy', 'mock')], [result('fear', 'unknown')], [result('curiosity-gap')], [result('uncertain')]]) {
    assert.equal(orbFeedback({ results }).state, 'empty');
    assert.equal(orbFeedback({ results }).category, null);
  }
});
for (const [flag, state] of [['busy', 'busy'], ['error', 'error'], ['unavailable', 'unavailable'], ['disabled', 'disabled']]) test(`orb ${state} status never implies a classification`, () => {
  const feedback = orbFeedback({ [flag]: true, results: [result('rage')] });
  assert.equal(feedback.state, state); assert.equal(feedback.category, null);
});
test('orb Clean majority is distinct from empty or tied data', () => {
  assert.equal(orbFeedback({ results: [result('clean'), result('clean'), result('fear')] }).category, 'clean');
  assert.equal(orbFeedback({ results: [result('clean'), result('fear')] }).category, null);
});
test('guide has exactly four current categories and two explicitly future entries', () => {
  assert.deepEqual(INGREDIENTS.filter(i => i.status === 'Current category').map(i => i.key), LIVE_KINDS);
  for (const entry of INGREDIENTS.filter(i => i.key.endsWith('-preview'))) {
    assert.match(entry.status, /Future.*not active/);
    assert.ok(!LIVE_KINDS.includes(entry.key));
  }
  assert.equal(INGREDIENTS.length, 6);
});
test('guide distinguishes uncertainty from framing and Clean from verification', () => {
  assert.match(INGREDIENTS.find(i => i.key === 'uncertain-preview').definition, /abstention/);
  assert.match(INGREDIENTS.find(i => i.key === 'uncertain-preview').explanation, /not interchangeable with Curiosity Gap/);
  assert.match(INGREDIENTS.find(i => i.key === 'clean').explanation, /does not mean true/);
  for (const entry of INGREDIENTS) for (const key of ['definition', 'example', 'explanation']) assert.ok(entry[key].trim());
});
