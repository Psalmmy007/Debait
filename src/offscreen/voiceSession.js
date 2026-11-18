import { aiError } from '../engine/errors.js';

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
          let response;
          try {
            const res = await sendTool(call);
            response = res?.result ?? { error: 'Debait is not running on this page.' };
          } catch {
            // A page-tool failure must not end the live conversation or invent a successful action.
            // Recheck permission before returning even an error to the cloud model.
            response = { error: 'The page action failed. Tell the user it did not complete.' };
          }
          await assertAllowed(); // Never return page data after Local Only was enabled.
          state('live');
          return { id: call.id, name: call.name, response };
        },
      });
      await assertAllowed();
      state('live');
      attempt.session.send('The call just started. Greet me briefly.', true).catch(() => {});
    } catch (err) {
      await close(attempt); // Also closes handles that arrived after endCall().
      if (current === attempt) {
        current = null;
        state('error', `Could not start the call: ${aiError(err).message}`);
      }
    }
  }
  return { startCall, endCall, inCall: () => !!current?.controller };
}
