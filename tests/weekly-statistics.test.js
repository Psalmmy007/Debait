import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeWeek, recommendation, statisticsMode } from '../src/sidepanel/statistics.js';
const day = patch => ({ total: 0, rage: 0, fear: 0, envy: 0, clean: 0, debaited: 0, sources: {}, ...patch });

test('all Clean data never invents Rage or a category-specific recommendation', () => {
  const stats = summarizeWeek([day({ total: 10, clean: 10 })]);
  assert.equal(stats.percentage(stats.bait), 0);
  assert.equal(stats.percentage(stats.sum.clean), 100);
  assert.equal(stats.rates[0], 0);
  assert.match(recommendation(stats), /classified Clean \(10\)/);
  assert.doesNotMatch(recommendation(stats), /Rage|Fear|Envy|automatically|Mute/);
});
test('empty data has a neutral message and no zero-denominator percentages', () => {
  for (const days of [[], [day()], Array.from({ length: 7 }, () => day())]) {
    const stats = summarizeWeek(days);
    assert.equal(stats.percentage(0), null);
    assert.ok(stats.rates.every(rate => rate === null));
    assert.match(recommendation(stats), /No analyzed headlines yet/);
    assert.doesNotMatch(recommendation(stats), /Rage|Fear|Envy/);
  }
});
test('mixed categories use analyzed-headline totals and the actual largest flagged category', () => {
  const stats = summarizeWeek([day({ total: 10, rage: 2, fear: 6, envy: 1, clean: 1 }), day({ total: 10, clean: 10 })]);
  assert.equal(stats.sum.total, 20); assert.equal(stats.bait, 9);
  assert.equal(stats.percentage(stats.bait), 45); assert.equal(stats.percentage(stats.sum.fear), 30);
  assert.match(recommendation(stats), /Fear.*6 of 20 analyzed headlines, 30%/);
});
test('a minority flagged category is not described as the dominant emotion of the whole feed', () => {
  const stats = summarizeWeek([day({ total: 10, fear: 2, clean: 8 })]);
  assert.match(recommendation(stats), /most common flagged category \(2 of 10.*20%/);
  assert.doesNotMatch(recommendation(stats), /feed leans|most of your/);
});
test('ties do not arbitrarily select Rage', () => {
  const two = summarizeWeek([day({ total: 5, fear: 2, envy: 2, clean: 1 })]);
  assert.match(recommendation(two), /Fear and Envy are tied.*2 each out of 5/);
  const three = summarizeWeek([day({ total: 6, rage: 2, fear: 2, envy: 2 })]);
  assert.match(recommendation(three), /Rage, Fear and Envy are tied/);
});
for (const [name, input] of [
  ['total without category evidence', { total: 10 }],
  ['categories exceed denominator', { total: 2, fear: 3 }],
  ['categories below denominator', { total: 10, fear: 1 }],
  ['negative count', { total: 1, fear: -1, clean: 2 }],
  ['fractional count', { total: 1, fear: 0.5, clean: 0.5 }],
  ['string count', { total: 1, fear: '1' }],
  ['nonfinite total', { total: Infinity }],
  ['invalid category', { total: 1, clean: NaN }],
]) {
  test(`inconsistent data stays neutral with unavailable percentages: ${name}`, () => {
    const stats = summarizeWeek([day(input)]);
    assert.equal(stats.complete, false); assert.equal(stats.percentage(stats.bait), null);
    assert.equal(stats.rates[0], null);
    assert.match(recommendation(stats), /incomplete or inconsistent/);
    assert.doesNotMatch(recommendation(stats), /Rage|Fear|Envy|NaN|Infinity/);
  });
}
test('a corrupt day cannot be hidden by aggregating it with a valid day', () => {
  const stats = summarizeWeek([day({ total: 10, fear: 10 }), day({ total: 10 })]);
  assert.equal(stats.sum.total, 20); assert.equal(stats.complete, false);
  assert.equal(stats.percentage(stats.sum.fear), null);
  assert.match(recommendation(stats), /No reliable category recommendation/);
});
test('sample mode is explicitly labeled and never gives personal advice based on made-up data', () => {
  const stats = summarizeWeek([day({ total: 20, rage: 20 })]);
  assert.equal(statisticsMode(true).badge, 'Sample data');
  assert.equal(statisticsMode(false).badge, 'Real numbers');
  assert.match(statisticsMode(true).sampleFoot, /made-up.*never saved/);
  assert.match(recommendation(stats, true), /do not describe your reading/);
  assert.doesNotMatch(recommendation(stats, true), /Rage|Mute|Your feed/);
});
test('calculations never mutate stored input or assign source totals to an emotion', () => {
  const input = [day({ total: 5, rage: 1, fear: 4, sources: { 'fictional.example': 5 }, debaited: 7 })];
  const snapshot = structuredClone(input); const stats = summarizeWeek(input);
  assert.deepEqual(input, snapshot); assert.equal(stats.sum.debaited, 7);
  assert.equal(stats.sum.sources['fictional.example'], 5);
  assert.doesNotMatch(recommendation(stats), /fictional|Mute|served/);
});
