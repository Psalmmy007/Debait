import test from 'node:test';
import assert from 'node:assert/strict';

test('the real offscreen entry loads with runtime messaging only and acknowledges readiness', async () => {
  let listener;
  globalThis.chrome = { runtime: {
    sendMessage: async () => ({ ok: false }),
    onMessage: { addListener: fn => { listener = fn; } },
  } };
  // Loads the actual SDK-backed entry, without getManifest, management or storage APIs.
  // No inference is requested and no credentials are supplied.
  await import('../src/offscreen/offscreen.js');
  assert.equal(typeof listener, 'function');
  const response = await new Promise(resolve => {
    assert.equal(listener({ target: 'offscreen', type: 'debait/engine-ready' }, {}, resolve), true);
  });
  assert.deepEqual(response, { ok: true, ready: true });
  let answered = false;
  assert.equal(listener({ type: 'debait/installation-type' }, {}, () => { answered = true; }), false);
  assert.equal(answered, false);
});
