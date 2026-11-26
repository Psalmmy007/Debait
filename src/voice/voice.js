import '@fontsource-variable/inter/opsz.css';
// Asks for the microphone once for the whole extension, then starts the call.
const msg = document.getElementById('msg');
const btn = document.getElementById('allow');
let granted = false;

async function ask() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    granted = true;
    msg.innerHTML = '<b>All set.</b> Debait is joining the call. You can close this tab and start talking.';
    btn.hidden = true;
    await chrome.runtime.sendMessage({ type: 'debait/mic-granted' });
    setTimeout(() => window.close(), 1600);
  } catch {
    msg.innerHTML = 'Microphone access was blocked. Click the camera/mic icon in the address bar to allow it, then press the button again.';
    chrome.runtime.sendMessage({ type: 'debait/mic-denied' }).catch(() => {});
  }
}
btn.addEventListener('click', ask);
ask();
window.addEventListener('beforeunload', () => {
  if (!granted) chrome.runtime.sendMessage({ type: 'debait/mic-denied' }).catch(() => {});
});
