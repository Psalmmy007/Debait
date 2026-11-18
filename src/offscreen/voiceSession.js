import { aiError } from '../engine/errors.js';

const sleep = (ms, signal) => new Promise(resolve => {
  const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done();
});
// Owns late connections, microphone setup, tool identities and resumption for one consent epoch.
export function createVoiceSession({ isAllowed, connect, startAudio, sendTool, state, wait = sleep, maxRetries = 3, rateLimited = async () => {} }) {
  let current = null, generation = 0, retiring = Promise.resolve();
  const active = a => current === a && !a.abort.signal.aborted;
  async function close(a) {
    const controller = a.controller, session = a.session; a.controller = null; a.session = null;
    await Promise.allSettled([Promise.resolve().then(() => controller?.stop()), Promise.resolve().then(() => session?.close())]);
  }
  async function endCall() {
    generation++;
    const a = current; current = null;
    if (a) { a.abort.abort(); retiring = close(a); await retiring; a.tools.clear(); a.cancelled.clear(); }
    if (a && !current) state('ended');
  }
  async function startCall(debugToken) {
    if (current) return;
    const epoch = generation; await retiring;
    if (epoch !== generation || current) return;
    const a = { session: null, controller: null, abort: new AbortController(), tools: new Map(), cancelled: new Set(), retries: 0, handle: null };
    current = a;
    const guard = async () => {
      if (!active(a) || !await isAllowed() || !active(a)) throw new Error('LOCAL_ONLY: Cloud voice is disabled or the call was cancelled.');
    };
    const notify = (s, message = '') => { if (active(a)) state(s, message); };
    const tool = async calls => {
      await guard(); const call = calls?.[0];
      if (!call || typeof call.id !== 'string' || !call.id || typeof call.name !== 'string') return { id: call?.id, name: call?.name || 'unknown', response: { error: 'The voice action had no valid identity and was not executed.' } };
      const fingerprint = JSON.stringify([call.name, call.args || {}]);
      if (a.tools.has(call.id)) {
        const previous = a.tools.get(call.id);
        if (previous.fingerprint !== fingerprint) return { id: call.id, name: call.name, response: { error: 'Reused action identity with different arguments. No action executed.' } };
        const result = await previous.promise; await guard();
        return { ...result, response: { ...result.response, debait_replayed: true, debait_notice: 'Recorded result only; the action was not executed again and the page may have changed.' } };
      }
      if (a.tools.size >= 128) throw Object.assign(new Error('Voice action limit reached. Start a new call.'), { code: 'debait/voice-limit' });
      const promise = (async () => {
        await guard(); notify('working', call.name); let response;
        try { const res = await sendTool(call); response = res?.result ?? { error: 'Debait is not running on this page. No action completed.' }; }
        catch { response = { error: 'The page action failed. Tell the user it did not complete.' }; }
        await guard();
        if (response.error || response.ok === false) notify('tool-error', 'The page action did not complete. You can keep talking or refresh the page.');
        else notify('live');
        return { id: call.id, name: call.name, response };
      })();
      a.tools.set(call.id, { fingerprint, promise });
      return promise;
    };
    const fail = async error => {
      await close(a);
      if (active(a)) { a.abort.abort(); current = null; a.tools.clear(); a.cancelled.clear(); state('error', error); }
    };
    const open = async resume => {
      await guard();
      a.session = await connect(debugToken, guard, resume ? { handle: a.handle, previousSession: a.previousSession } : {});
      await guard();
      a.controller = await startAudio(a.session, { assertAllowed: guard, signal: a.abort.signal, cancelledToolIds: a.cancelled, functionCallingHandler: tool,
        onResumeHandle: handle => { if (active(a)) a.handle = handle; },
        onTalking: talking => notify(talking ? 'talking' : 'live'),
        onTranscript: text => notify('heard', text),
        onBuffering: () => notify('buffering', 'Waiting for the next audio chunk…'),
      });
      await guard();
      if (resume) notify('reconnected', 'Reconnected using a server handle. Recent speech may be missing; repeat your last request if needed.');
      else {
        notify('live'); await guard();
        await a.session.send('The call just started. Greet me briefly.', true);
      }
      // SDK convenience controller had no completion/error channel. Our adapter supplies it.
      if (a.controller.done) void a.controller.done.then(result => disconnected(result), () => disconnected({ reason: 'fatal', message: 'Voice audio stopped unexpectedly. Start a new call.' }));
    };
    const disconnected = async result => {
      if (!active(a) || result?.reason === 'stopped') return;
      a.previousSession = a.session;
      await close(a); if (!active(a)) return;
      if (result?.code === 'debait/quota') await rateLimited(result.retryAfterMs).catch(() => {});
      if (result?.reason !== 'network' || !a.handle) {
        if (result?.reason === 'fatal') { await fail(result.message || 'The voice session ended. Check the setup before calling again.'); return; }
        if (result?.reason === 'audio') { await fail(result.message || 'Voice audio stopped. Check microphone/playback permissions and call again.'); return; }
        await fail('The call ended. No safe resumable context is available. Start a new call for a new conversation.'); return;
      }
      while (active(a) && a.retries < maxRetries) {
        const delay = 10000 * 2 ** a.retries++; // bounded across the entire call, not reset after brief reconnects
        notify('reconnecting', 'Connection interrupted. Microphone released while reconnecting…');
        await wait(delay, a.abort.signal); if (!active(a)) return;
        try { await guard(); await open(true); return; }
        catch (error) {
          await close(a); if (!active(a)) return;
          if (!['debait/network', 'debait/service', 'debait/timeout', 'debait/quota-pacing'].includes(error.code)) break;
        }
      }
      if (active(a)) await fail('The call could not reconnect safely. Start a new call; recent speech may not have been preserved.');
    };
    try { await guard(); notify('connecting'); await open(false); }
    catch (error) {
      await close(a);
      if (active(a)) {
        const message = /^LOCAL_ONLY/.test(error.message || '') ? 'Cloud voice is off or Local Only is enabled. No further audio will be sent.' : error.name === 'NotFoundError' ? 'Chrome could not find a microphone. Connect one and start voice again.' : error.code === 'debait/audio' ? error.message : /NotAllowedError|permission|microphone denied/i.test(`${error.name} ${error.message}`)
          ? 'Microphone access was denied. Allow it in Chrome, then start voice again.'
          : error.code?.startsWith('debait/quota') ? error.message : aiError(error).message;
        await fail(`Could not start the call: ${message}`);
      }
    }
  }
  return { startCall, endCall, inCall: () => !!current?.controller };
}
