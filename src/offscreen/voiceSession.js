// Owns pending connections as well as live audio, so a privacy change cancels both.
export function createVoiceSession({ isAllowed, connect, startAudio, sendTool, state }) {
  let current = null;
  async function close(attempt) {
    const { controller, session } = attempt;
    attempt.controller = null;
    attempt.session = null;
    await Promise.allSettled([
      Promise.resolve().then(() => controller?.stop()),
      Promise.resolve().then(() => session?.close()),
    ]);
  }
  async function endCall() {
    const attempt = current;
    current = null; // Invalidate before waiting for microphone/socket cleanup.
    if (attempt) await close(attempt);
    state('ended');
  }
  async function startCall(debugToken) {
    if (current) return;
    const attempt = { session: null, controller: null };
    current = attempt;
    const assertAllowed = async () => {
      if (current !== attempt || !await isAllowed() || current !== attempt) {
        throw new Error('LOCAL_ONLY: Cloud voice is disabled or the call was cancelled.');
      }
    };
    try {
      await assertAllowed();
      state('connecting');
      attempt.session = await connect(debugToken, assertAllowed);
      await assertAllowed();
      attempt.controller = await startAudio(attempt.session, {
        functionCallingHandler: async (calls) => {
          await assertAllowed();
          const call = calls[0];
          state('working', call.name);
          const res = await sendTool(call);
          await assertAllowed(); // Never return page data after Local Only was enabled.
          state('live');
          return { id: call.id, name: call.name, response: res?.result ?? { error: 'Debait is not running on this page.' } };
        },
      });
      await assertAllowed();
      state('live');
      attempt.session.send('The call just started. Greet me briefly.', true).catch(() => {});
    } catch (err) {
      await close(attempt); // Also closes handles that arrived after endCall().
      if (current === attempt) {
        current = null;
        const appCheck = /app check|401|403|permission/i.test(String(err?.message));
        state('error', appCheck ? 'Voice needs Gemini: check App Check approval in the popup.' : `Could not start the call (${err?.message || err})`);
      }
    }
  }
  return { startCall, endCall, inCall: () => !!current?.controller };
}
