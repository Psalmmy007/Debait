import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, importDataset, exportCsv } from '../dev/evaluation/csv.js';

test('CSV handles BOM, CRLF, quoted commas, escaped quotations and embedded newlines', () => {
  const csv = '\uFEFFid,headline\r\nA,"A comma, a ""quote""\nand a newline"\r\n';
  assert.deepEqual(parseCsv(csv), [['id', 'headline'], ['A', 'A comma, a "quote"\nand a newline']]);
});
for (const csv of ['headline\n"unfinished', 'headline\n"a"extra', 'headline\na"b']) {
  test(`malformed quoting is rejected: ${JSON.stringify(csv)}`, () => assert.throws(() => importDataset(csv), /quot/));
}
test('import accepts common existing-dataset headers, preserves labels and generates missing IDs', () => {
  const dataset = importDataset('headline_text,expected_label,human_reviewed_label,review_status\nA headline,Curiosity Gap,Uncertain,disputed');
  assert.equal(dataset.rows[0].id, 'row_1');
  assert.equal(dataset.rows[0].draftLabel, 'Curiosity Gap');
  assert.equal(dataset.rows[0].humanLabel, 'Uncertain');
  assert.equal(dataset.missingReviewColumns, false);
});
test('exact duplicate headlines retain unique IDs and are identified without modifying the headline', () => {
  const dataset = importDataset('id,headline\n1,Same headline\n2,Same headline\n3, Same headline ');
  assert.equal(dataset.uniqueCount, 2);
  assert.equal(dataset.rows[1].duplicateOf, '1');
  assert.equal(dataset.rows[2].text, ' Same headline ');
});
for (const [name, csv] of [
  ['duplicate IDs', 'id,headline\n1,A\n1,B'],
  ['duplicate headers', 'headline,Headline\nA,B'],
  ['missing headline column', 'id,expected\n1,Clean'],
  ['empty dataset', 'headline\n'],
  ['missing CSV fields', 'id,headline\n1'],
  ['extra CSV fields', 'headline\nA,B'],
  ['empty headline', 'id,headline\n1, '],
  ['oversized headline', `headline\n${'x'.repeat(321)}`],
]) test(`invalid import: ${name}`, () => assert.throws(() => importDataset(csv)));

test('missing review columns are reported, never inferred from expected labels', () => {
  const dataset = importDataset('headline,expected_label\nTest,Clean');
  assert.equal(dataset.missingReviewColumns, true);
  assert.equal(dataset.rows[0].humanLabel, ''); assert.equal(dataset.rows[0].reviewStatus, '');
});
test('spreadsheet export protects formulas, controls and every column', () => {
  const payloads = ['=1+1', '+CMD()', '-1+2', '@SUM(A1)', '  =1', '\tformula', '\nformula', '\u0000=1'];
  const csv = exportCsv(['headline', 'id'], payloads.map(value => ({ headline: value, id: value })));
  const records = parseCsv(csv).slice(1);
  assert.ok(records.every(row => row.every(cell => cell.startsWith("'"))));
  assert.equal(parseCsv(exportCsv(['headline'], [{ headline: 'A "quote", and\na newline' }]))[1][0], 'A "quote", and\na newline');
});
