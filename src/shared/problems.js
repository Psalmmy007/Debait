// Diagnostics are fixed descriptions, never provider payloads, URLs, tokens or page text.
const descriptions = [
  [/app.?check|exchangedebugtoken/i, 'App Check could not authenticate voice. Check the approved development setup; keep enforcement enabled.'],
  [/401|403|unauthenticated|unauthorized|permission.denied|forbidden/i, 'Firebase denied voice authentication or access. Check App Check and project permissions.'],
  [/microphone.*(denied|blocked)|notallowederror/i, 'Microphone permission was denied. Check Chrome microphone permissions, then start voice again from the popup.'],
  [/notfounderror|find a microphone/i, 'Chrome could not find a microphone. Connect one and start voice again.'],
  [/local_only|local only|voice is off|call was cancelled/i, 'Cloud voice was stopped or blocked by the current privacy/voice settings.'],
  [/429|quota|rate.limit|cooling down|daily.*budget|request slot/i, 'Voice is waiting for a request slot or quota cooldown. Try again later.'],
  [/404|model.*(unavailable|not found|not supported)/i, 'The configured Live model is unavailable. Check project access and model configuration.'],
  [/timeout|timed out|deadline/i, 'Voice connection or audio initialization timed out. Check connectivity and Chrome audio permissions.'],
  [/network|offline|fetch|502|503|overload/i, 'Voice could not reach the service or the service was temporarily unavailable. Check connectivity and retry later.'],
  [/audio|pcm|worklet|playback|microphone/i, 'Voice audio could not start or continue. Check Chrome microphone/playback permissions and reload the extension.'],
  [/reconnect|resumable|recent speech/i, 'Voice could not reconnect safely. Start a new call; recent speech may be missing.'],
];
const genericVoice = 'Voice could not start or continue. Reload the extension and try again; no successful call is implied.';
const generic = 'An extension operation failed. Refresh the page or reload the extension and retry.';
const known = new Set([...descriptions.map(([, message]) => message), genericVoice, generic]);
export function problemEntry(where, error, at = new Date().toISOString()) {
  const phase = ['voice startup', 'voice session', 'voice microphone', 'background'].includes(where) ? where
    : typeof where === 'string' && where.startsWith('content') ? 'content' : 'extension';
  const text = String(error?.message || error || '');
  const message = known.has(text) ? text : phase.startsWith('voice')
    ? descriptions.find(([pattern]) => pattern.test(text))?.[1] || genericVoice : generic;
  return { at, where: phase, message };
}
export function recentProblems(raw, now = Date.now()) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(e => e && typeof e.at === 'string' && Number.isFinite(Date.parse(e.at)) && now - Date.parse(e.at) >= 0 && now - Date.parse(e.at) < 30 * 60 * 1000)
    .slice(0, 15).map(e => problemEntry(e.where, e.message, new Date(e.at).toISOString()));
}
export function createProblemLogger({ read, write }) {
  let pending = Promise.resolve();
  const enqueue = operation => {
    const result = pending.catch(() => {}).then(operation);
    pending = result; return result;
  };
  const log = (where, error) => enqueue(async () => {
    const entries = recentProblems(await read());
    await write([problemEntry(where, error), ...entries].slice(0, 15));
  });
  // Remove raw legacy payloads at worker startup, using the same serialized writer.
  log.sanitize = () => enqueue(async () => write(recentProblems(await read())));
  return log;
}
