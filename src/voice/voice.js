import '@fontsource-variable/plus-jakarta-sans';
// Permission tab only: never sends captured audio and releases every late stream.
const msg = document.getElementById('msg'), btn = document.getElementById('allow');
let pending = false, closed = false;
const allowed = async () => {
  const result = await chrome.runtime.sendMessage({ type: 'debait/voice-allowed' });
  return result?.ok === true && result.allowed === true;
};
async function ask() {
  if (pending || closed) return;
  pending = true; btn.disabled = true;
  try {
    if (!await allowed()) { msg.textContent = 'Voice is off or Local Only is enabled. Return to the popup before starting a cloud call.'; return; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    if (closed) return;
    if (!await allowed()) { msg.textContent = 'Voice permission changed. No call was started.'; return; }
    const result = await chrome.runtime.sendMessage({ type: 'debait/mic-granted' });
    if (!result?.ok) { msg.textContent = 'Microphone permission was granted, but the call could not start. Check the popup and start voice again.'; return; }
    msg.textContent = 'Microphone permission is granted. The connection is starting; check the orb for the actual call status.';
    btn.hidden = true; setTimeout(() => { if (!closed) window.close(); }, 1600);
  } catch (error) {
    if (error.name === 'NotAllowedError' && !closed) await chrome.runtime.sendMessage({ type: 'debait/mic-denied' }).catch(() => {});
    msg.textContent = error.name === 'NotAllowedError'
      ? 'Microphone access was blocked. Allow it using Chrome’s microphone/site controls, then start voice again from the popup.'
      : 'The microphone or extension connection is unavailable. Check Chrome and start voice again.';
  } finally { pending = false; btn.disabled = false; }
}
btn.addEventListener('click', ask);
addEventListener('pagehide', () => { closed = true; });
ask();
