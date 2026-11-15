// Creation of the document does not prove that its module listener is registered.
// Retry only the harmless readiness probe, never replay an inference/voice operation.
export async function waitForEngineReady(send, { attempts = 50, pause = () => new Promise(r => setTimeout(r, 100)) } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const reply = await send({ target: 'offscreen', type: 'debait/engine-ready' });
      if (reply?.ok && reply.ready === true) return;
    } catch { /* The receiver can still be loading. */ }
    if (i + 1 < attempts) await pause();
  }
  throw new Error('The Debait offscreen engine did not become ready. Reload the extension and refresh this page.');
}
