// Debait's own audio pipeline for the voice call (replaces the SDK's startAudioConversation):
// - Mic capture: 16 kHz 16-bit PCM in steady 20 ms frames via AudioWorklet (echo cancellation,
//   noise suppression, and auto gain control explicitly enabled).
// - Playback: 24 kHz PCM rendered off the main thread in `debait-player` AudioWorklet backed by a
//   lock-free Float32 circular ring buffer (steady 40 ms pre-buffer, 2 ms anti-click ramps, <1 ms flush on barge-in).
const MIC_RATE = 16000;
const SPEAKER_RATE = 24000;
const MIC_FRAME_SEC = 0.02;      // low-latency 20 ms mic frames (320 samples @ 16 kHz)
// Light residual-echo floor while Debait speaks: keeps room noise out without blocking barge-in.
const ECHO_GATE = 0.018;
// Gentle lift for soft voices, paired with a compressor so louder speech stays clean.
const MIC_BOOST = 1.35;

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * @param onMic      (base64Pcm16k) => void, 50 times a second (20 ms frames)
 * @param onTalking  (bool) => void, when Debait starts / stops speaking
 */
export async function openAudio({ onMic, onTalking }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: { ideal: MIC_RATE },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  // Capture at 16 kHz when Chrome allows it (proper anti-aliasing), otherwise let the worklet resample.
  let micCtx;
  let outCtx;
  let src;
  try {
    try {
      micCtx = new AudioContext({ sampleRate: MIC_RATE, latencyHint: 'interactive' });
      src = micCtx.createMediaStreamSource(stream);
    } catch {
      await micCtx?.close().catch(() => {});
      micCtx = new AudioContext({ latencyHint: 'interactive' });
      src = micCtx.createMediaStreamSource(stream);
    }
    try {
      outCtx = new AudioContext({ sampleRate: SPEAKER_RATE, latencyHint: 'interactive' });
    } catch {
      await outCtx?.close().catch(() => {});
      outCtx = new AudioContext({ latencyHint: 'interactive' });
    }
    const url = chrome.runtime.getURL('voice-worklets.js');
    await Promise.all([micCtx.audioWorklet.addModule(url), outCtx.audioWorklet.addModule(url)]);
    await Promise.all([micCtx.resume(), outCtx.resume()]);
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await Promise.all([micCtx?.close(), outCtx?.close()]).catch(() => {});
    throw err;
  }

  const mic = new AudioWorkletNode(micCtx, 'debait-mic', {
    processorOptions: { targetSampleRate: MIC_RATE, frameSeconds: MIC_FRAME_SEC },
  });
  let muted = false;
  let talking = false;
  let closed = false;
  const silence = new Int16Array(Math.round(MIC_RATE * MIC_FRAME_SEC));
  mic.port.onmessage = (e) => {
    if (muted || closed) return;
    let pcm = e.data;
    if (talking) {
      let sum = 0;
      for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
      if (Math.sqrt(sum / pcm.length) / 32768 < ECHO_GATE) pcm = silence;
    }
    onMic(toBase64(new Uint8Array(pcm.buffer)));
  };
  const boost = micCtx.createGain();
  boost.gain.value = MIC_BOOST;
  const comp = micCtx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 10;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  src.connect(boost).connect(comp).connect(mic);

  // ---------- 24 kHz PCM playback on the dedicated audio render thread ----------
  const player = new AudioWorkletNode(outCtx, 'debait-player', {
    outputChannelCount: [1],
    processorOptions: { inputSampleRate: SPEAKER_RATE },
  });
  player.connect(outCtx.destination);

  function setTalking(next) {
    if (talking === next) return;
    talking = next;
    onTalking?.(next);
  }

  player.port.onmessage = (e) => {
    if (!closed && e.data && typeof e.data.talking === 'boolean') {
      setTalking(e.data.talking);
    }
  };

  function interrupt() {
    if (!closed) {
      try { player.port.postMessage('flush'); } catch { /* worklet closing */ }
    }
    setTalking(false);
  }

  return {
    /** Transfers a base64 16-bit LE PCM chunk (24 kHz) zero-copy to the audio worklet ring buffer. */
    play(b64) {
      if (closed || !b64) return;
      if (outCtx.state === 'suspended') outCtx.resume().catch(() => {});
      let bin;
      try { bin = atob(b64); } catch { return; }
      const n = bin.length >> 1;
      if (!n) return;
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
        if (v >= 0x8000) v -= 0x10000;
        samples[i] = v / 32768;
      }
      player.port.postMessage(samples, [samples.buffer]);
    },
    /** User barged in: flush the ring buffer in < 1 ms. */
    interrupt,
    /** Mute/unmute the microphone immediately (disables live audio tracks and drops PCM frames). */
    setMuted(m) {
      muted = !!m;
      stream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    },
    async close() {
      closed = true;
      muted = false;
      try { player.port.postMessage('flush'); } catch { /* ignore */ }
      mic.port.onmessage = null;
      player.port.onmessage = null;
      try { src.disconnect(); boost.disconnect(); comp.disconnect(); mic.disconnect(); } catch { /* ignore */ }
      try { player.disconnect(); } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop());
      await Promise.all([micCtx.close(), outCtx.close()]).catch(() => {});
    },
  };
}
