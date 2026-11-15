import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForEngineReady } from '../src/offscreen/readiness.js';
import { sendRuntimeMessage } from '../src/shared/messaging.js';
import { deviceAvailability } from '../src/engine/device.js';
import { aiError } from '../src/engine/errors.js';

test('engine startup waits for the module listener, not just document creation', async () => {
  let probes = 0, pauses = 0;
  await waitForEngineReady(async message => {
    assert.equal(message.type, 'debait/engine-ready');
    probes++;
    if (probes === 1) throw new Error('Receiving end does not exist');
    return probes === 2 ? undefined : { ok: true, ready: true };
  }, { attempts: 3, pause: async () => { pauses++; } });
  assert.equal(probes, 3); assert.equal(pauses, 2);
});

test('an engine which never becomes ready fails honestly without replaying analysis', async () => {
  let calls = 0;
  await assert.rejects(waitForEngineReady(async message => {
    assert.equal(message.type, 'debait/engine-ready'); calls++; return { ok: false };
  }, { attempts: 2, pause: async () => {} }), /did not become ready/);
  assert.equal(calls, 2);
});

for (const api of [undefined, {}, { runtime: {} }]) {
  test(`missing content-script runtime produces a refresh error, not a sendMessage TypeError: ${JSON.stringify(api)}`, async () => {
    await assert.rejects(sendRuntimeMessage({}, api), error => error.code === 'debait/context-unavailable' && /Refresh/.test(error.message));
  });
}

test('Chrome context invalidation after reload produces a refresh error', async () => {
  await assert.rejects(sendRuntimeMessage({}, { runtime: { sendMessage: async () => { throw new Error('Extension context invalidated.'); } } }),
    error => error.code === 'debait/context-unavailable');
});

test('transport failures are not mistaken for a stale context or replaced with fake results', async () => {
  await assert.rejects(sendRuntimeMessage({}, { runtime: { sendMessage: async () => { throw new Error('worker failed'); } } }), /worker failed/);
});

test('Nano availability includes both input and output languages', async () => {
  const availability = await deviceAvailability({ availability: async options => {
    assert.deepEqual(options.expectedInputs, [{ type: 'text', languages: ['en'] }]);
    assert.deepEqual(options.expectedOutputs, [{ type: 'text', languages: ['en'] }]);
    return 'available';
  } });
  assert.equal(availability, 'available');
});

test('execution configuration failures are categorized separately from App Check', () => {
  const error = aiError(new Error('The model was available but there was not an execution config available for the feature.'));
  assert.equal(error.code, 'debait/device-config'); assert.equal(error.needsAppCheck, false);
  assert.match(error.message, /Local Only will not use cloud/);
});
