import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const cleanWeek = () => Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-${11 + i}`, total: i === 6 ? 10 : 0,
  rage: 0, fear: 0, envy: 0, clean: i === 6 ? 10 : 0, debaited: 0, sources: {} }));
let serial = 0;
async function fixture(t, read = async () => cleanWeek()) {
  const nodes = new Map(); const classes = new Set(); let storageListener, writes = 0;
  const element = () => ({ textContent: '', innerHTML: '', hidden: false, style: {}, dataset: {}, nextElementSibling: { hidden: false },
    querySelector(selector) { return this[selector] ||= element(); },
    addEventListener(type, listener) { this[type] = listener; },
    replaceChildren(...children) { this.textContent = children.map(child => child.textContent).join(''); } });
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); };
  node('.foot').textContent = 'Original real-statistics footnote';
  t.mock.method(globalThis, 'setTimeout', fn => { queueMicrotask(fn); return 0; });
  const originals = new Map(['document', 'chrome', 'requestAnimationFrame', '__weeklyRead'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  globalThis.document = { querySelector: node, querySelectorAll: () => [], createElement: element, createTextNode: text => ({ textContent: text }),
    body: { classList: { toggle(key, on) { if (on) classes.add(key); else classes.delete(key); } } } };
  globalThis.requestAnimationFrame = fn => fn();
  globalThis.chrome = { storage: { onChanged: { addListener(fn) { storageListener = fn; } }, local: { set() { writes++; } } } };
  globalThis.__weeklyRead = read;
  const url = new URL('../src/sidepanel/sidepanel.js', import.meta.url);
  let source = await readFile(url, 'utf8');
  source = source.replace(/^import '@fontsource-variable[^\n]+\n/gm, '')
    .replace("import { getRecentStats, dayKey } from '../shared/storage.js';", "const getRecentStats = (...args) => globalThis.__weeklyRead(...args); const dayKey = d => d.toISOString().slice(0,10);")
    .replace(/from '(\.[^']+)'/g, (_, path) => `from '${new URL(path, url).href}'`);
  await import(`data:text/javascript,${encodeURIComponent(source)}#weekly-${serial++}`);
  await tick();
  return { node, classes, writes: () => writes, change: () => storageListener({ stats: {} }, 'local') };
}
test('real panel switches sample badge, footnote and advice, then restores real data without saving sample values', async t => {
  const f = await fixture(t);
  assert.equal(f.node('#realChip').textContent, 'Real numbers');
  assert.match(f.node('#tip').textContent, /classified Clean \(10\)/);
  assert.equal(f.node('#baitPct').textContent, 0);
  f.node('#seed').click(); await tick();
  assert.equal(f.node('#realChip').textContent, 'Sample data'); assert.ok(f.classes.has('sample'));
  assert.match(f.node('.foot').textContent, /made-up.*never saved/);
  assert.match(f.node('#tip').textContent, /do not describe your reading/);
  f.node('#seed').click(); await tick();
  assert.equal(f.node('#realChip').textContent, 'Real numbers'); assert.ok(!f.classes.has('sample'));
  assert.equal(f.node('.foot').textContent, 'Original real-statistics footnote');
  assert.equal(f.node('#total').textContent, '10'); assert.equal(f.writes(), 0);
});
test('an older real storage response cannot overwrite a later sample selection', async t => {
  const pending = deferred(); const f = await fixture(t, () => pending.promise);
  f.node('#seed').click(); await tick();
  const sampleTotal = f.node('#total').textContent;
  pending.resolve(cleanWeek()); await tick();
  assert.equal(f.node('#realChip').textContent, 'Sample data');
  assert.equal(f.node('#total').textContent, sampleTotal);
  assert.match(f.node('#tip').textContent, /Sample statistics only/);
});
test('latest real storage response wins even when earlier requests finish later', async t => {
  const older = deferred(), newer = deferred(); let calls = 0;
  const f = await fixture(t, () => ++calls === 1 ? older.promise : newer.promise);
  f.change(); newer.resolve(cleanWeek()); await tick();
  older.resolve(cleanWeek().map(day => ({ ...day, total: 0, clean: 0 }))); await tick();
  assert.equal(f.node('#total').textContent, '10'); assert.match(f.node('#tip').textContent, /classified Clean/);
});
test('empty or inconsistent data renders unavailable percentages rather than NaN or invented emotions', async t => {
  const week = cleanWeek().map(day => ({ ...day, total: 0, clean: 0 }));
  const f = await fixture(t, async () => week);
  assert.equal(f.node('#baitPct').textContent, '—'); assert.equal(f.node('#baitPct').nextElementSibling.hidden, true);
  assert.match(f.node('#tip').textContent, /No analyzed headlines/);
  week[6].total = 10; f.change(); await tick();
  assert.equal(f.node('#baitPct').textContent, '—'); assert.match(f.node('#tip').textContent, /incomplete or inconsistent/);
});
