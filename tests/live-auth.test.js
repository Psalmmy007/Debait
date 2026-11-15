import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveConnector } from '../src/offscreen/liveConnector.js';

test('Live authentication failure prevents model creation and connection', async () => {
  let attempts = 0;
  const connect = createLiveConnector({ getAi: async () => { throw { code: 'appCheck/rejected' }; },
    getLiveGenerativeModel: () => { attempts++; }, models: ['a', 'b'] });
  await assert.rejects(connect(undefined, async () => {}), error => error.code === 'debait/app-check');
  assert.equal(attempts, 0);
});

test('Local Only enabled during authentication prevents a new Live connection', async () => {
  let allowed = true, attempts = 0;
  const connect = createLiveConnector({ getAi: async () => { allowed = false; return {}; },
    getLiveGenerativeModel: () => { attempts++; }, models: ['a', 'b'] });
  await assert.rejects(connect(undefined, async () => { if (!allowed) throw new Error('LOCAL_ONLY'); }), /LOCAL_ONLY/);
  assert.equal(attempts, 0);
});

test('a missing Live model can try the next configured model after another privacy check', async () => {
  const attempted = []; let guards = 0;
  const connect = createLiveConnector({ getAi: async () => ({}), models: ['a', 'b'], parameters: {},
    getLiveGenerativeModel: (_ai, { model }) => ({ connect: async () => {
      attempted.push(model);
      if (model === 'a') throw { customData: { httpErrorCode: 404 } };
      return { session: 'test' };
    } }) });
  assert.deepEqual(await connect(undefined, async () => { guards++; }), { session: 'test' });
  assert.deepEqual(attempted, ['a', 'b']); assert.equal(guards, 3);
});

for (const code of [401, 403, 429]) {
  test(`Live does not retry authentication/access/quota failures against every model: ${code}`, async () => {
    let attempts = 0;
    const connect = createLiveConnector({ getAi: async () => ({}), models: ['a', 'b'], parameters: {},
      getLiveGenerativeModel: () => ({ connect: async () => { attempts++; throw { customData: { httpErrorCode: code } }; } }) });
    await assert.rejects(connect(undefined, async () => {}));
    assert.equal(attempts, 1);
  });
}
