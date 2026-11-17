import test from 'node:test';
import assert from 'node:assert/strict';
import { swapToRewrite, swapToOriginal } from '../src/content/ui/page.js';
function fixture() {
  const nodes = [{ data: 'Click to find out: ' }, { data: "Doctors say treatment may cause pain" }];
  const anchor = { href: 'https://fictional.example/article', listener: () => 42 };
  const el = { contains: node => nodes.includes(node), get textContent() { return nodes.map(n => n.data).join(''); },
    replaceChildren() { throw new Error('Must preserve DOM element/listener identity'); } };
  globalThis.matchMedia = () => ({ matches: true }); globalThis.NodeFilter = { SHOW_TEXT: 4 };
  globalThis.document = { createTreeWalker: () => { let i = 0; return { nextNode: () => nodes[i++] || null }; } };
  return { nodes, anchor, rec: { state: 'scored', el, text: el.textContent, result: { kind: 'fear', honest_rewrite: nodes[1].data, source: 'cloud' } } };
}
test('safe rewrite and restore preserve nested link/text-node identities and exact original text', async () => {
  const { nodes, anchor, rec } = fixture(); const original = rec.text;
  assert.equal(await swapToRewrite(rec), true); assert.equal(nodes[0].data, '');
  assert.equal(rec.el.textContent, rec.result.honest_rewrite); assert.equal(anchor.href, 'https://fictional.example/article'); assert.equal(anchor.listener(), 42);
  assert.equal(await swapToRewrite(rec), false);
  assert.equal(await swapToOriginal(rec), true); assert.equal(rec.el.textContent, original);
  assert.equal(rec.state, 'scored');
});
test('a changed permission prevents a DOM rewrite and produces no successful change', async () => {
  const { rec } = fixture(); const original = rec.text;
  assert.equal(await swapToRewrite(rec, { canApply: () => false }), false); assert.equal(rec.el.textContent, original);
});
test('restoring never overwrites text replaced by the host site', async () => {
  const { nodes, rec } = fixture(); await swapToRewrite(rec); nodes[1].data = 'The site has published a new headline';
  assert.equal(await swapToOriginal(rec), false); assert.ok(rec.el.textContent.includes('new headline'));
});

test('a host edit during an animation is not overwritten by later animation frames', async () => {
  const { nodes, rec } = fixture();
  globalThis.matchMedia = () => ({ matches: false });
  const frames = []; globalThis.requestAnimationFrame = frame => { frames.push(frame); };
  const operation = swapToRewrite(rec);
  nodes[1].data = 'The host changed this headline during the animation';
  frames.shift()(performance.now() + 5000);
  assert.equal(await operation, false);
  assert.equal(nodes[1].data, 'The host changed this headline during the animation');
  assert.equal(rec.state, 'scored'); assert.equal(rec.animating, false);
});

test('an external edit during restoration keeps the new headline without animation debris', async () => {
  const { nodes, rec } = fixture(); await swapToRewrite(rec);
  globalThis.matchMedia = () => ({ matches: false });
  const frames = []; globalThis.requestAnimationFrame = frame => { frames.push(frame); };
  const operation = swapToOriginal(rec);
  nodes[1].data = 'The host published a different headline';
  frames.shift()(performance.now() + 5000);
  assert.equal(await operation, false);
  assert.equal(rec.el.textContent, 'The host published a different headline');
});
