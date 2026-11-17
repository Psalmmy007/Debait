// Debait's own audio pipeline for the voice call (replaces the SDK's startAudioConversation):
// clean 16 kHz mic capture in 40 ms frames, and jitter-buffered 24 kHz playback.
// The processors live in public/voice-worklets.js (extensions can't load worklets from blob: URLs).
const MIC_RATE = 16000;
const SPEAKER_RATE = 24000;

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * @param onMic      (base64Pcm16k) => void, 25 times a second
 * @param onTalking  (bool) => void, when Gemini starts / stops speaking
 */
export async function openAudio({ onMic, onTalking }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const micCtx = new AudioContext({ latencyHint: 'interactive' });
  const outCtx = new AudioContext({ sampleRate: SPEAKER_RATE, latencyHint: 'interactive' });
  const url = chrome.runtime.getURL('voice-worklets.js');
  await Promise.all([micCtx.audioWorklet.addModule(url), outCtx.audioWorklet.addModule(url)]);
  await Promise.all([micCtx.resume(), outCtx.resume()]);

  const src = micCtx.createMediaStreamSource(stream);
  const mic = new AudioWorkletNode(micCtx, 'debait-mic', { processorOptions: { targetSampleRate: MIC_RATE } });
  let muted = false;
  let talking = false;
  const silence = new Int16Array(Math.round(MIC_RATE * 0.04));
  mic.port.onmessage = (e) => {
    if (muted) return;
    let pcm = e.data;
    if (talking) {
      // echo gate: while Debait speaks, its own voice leaks back into the mic and makes it
      // interrupt itself. Only let the mic through if someone is clearly talking over it.
      let sum = 0;
      for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
      if (Math.sqrt(sum / pcm.length) / 32768 < 0.05) pcm = silence;
    }
    onMic(toBase64(new Uint8Array(pcm.buffer)));
  };
  src.connect(mic);

  const player = new AudioWorkletNode(outCtx, 'debait-player', { outputChannelCount: [1] });
  player.port.onmessage = (e) => { talking = e.data.talking; onTalking?.(talking); };
  player.connect(outCtx.destination);

  return {
    /** base64 16-bit PCM at 24 kHz from Gemini */
    play(b64) {
      const bin = atob(b64);
      const n = bin.length >> 1;
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
        if (v >= 0x8000) v -= 0x10000;
        f[i] = v / 32768;
      }
      player.port.postMessage(f, [f.buffer]);
    },
    /** the user talked over Gemini: drop what it was saying */
    interrupt() { player.port.postMessage('clear'); },
    /** stop sending mic audio (e.g. while reconnecting) */
    setMuted(m) { muted = m; },
    async close() {
      stream.getTracks().forEach((t) => t.stop());
      await Promise.all([micCtx.close(), outCtx.close()]).catch(() => {});
    },
  };
}
