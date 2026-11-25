// Debait's own audio pipeline for the voice call (replaces the SDK's startAudioConversation):
// - Mic capture: 16 kHz 16-bit PCM in steady 30 ms frames via AudioWorklet (echo cancellation,
//   noise suppression, and auto gain control explicitly enabled).
// - Playback: 24 kHz PCM scheduled via monotonic `nextPlayTime` AudioBufferSourceNodes with a
//   40 ms jitter buffer for zero-crackle stitching and instant mid-sentence barge-in.
const MIC_RATE = 16000;
const SPEAKER_RATE = 24000;
const MIC_FRAME_SEC = 0.03;      // steady 30 ms mic frames (480 samples @ 16 kHz)
const JITTER_BUFFER_SEC = 0.04;  // 40 ms jitter cushion before starting a new utterance
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
 * @param onMic      (base64Pcm16k) => void, ~33 times a second (30 ms frames)
 * @param onTalking  (bool) => void, when Gemini starts / stops speaking
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
  let src;
  try {
    micCtx = new AudioContext({ sampleRate: MIC_RATE, latencyHint: 'interactive' });
    src = micCtx.createMediaStreamSource(stream);
  } catch {
    await micCtx?.close().catch(() => {});
    micCtx = new AudioContext({ latencyHint: 'interactive' });
    src = micCtx.createMediaStreamSource(stream);
  }
  const outCtx = new AudioContext({ sampleRate: SPEAKER_RATE, latencyHint: 'interactive' });
  const url = chrome.runtime.getURL('voice-worklets.js');
  await micCtx.audioWorklet.addModule(url);
  await Promise.all([micCtx.resume(), outCtx.resume()]);

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

  // ---------- 24 kHz PCM playback: monotonic nextPlayTime scheduler + instant barge-in ----------
  const outGain = outCtx.createGain();
  outGain.gain.value = 1;
  outGain.connect(outCtx.destination);

  const activeSources = new Set();
  let nextPlayTime = 0;
  let talkEndTimer = null;

  function setTalking(next) {
    if (talking === next) return;
    talking = next;
    onTalking?.(next);
  }

  function interrupt() {
    clearTimeout(talkEndTimer);
    talkEndTimer = null;
    for (const node of activeSources) {
      node.onended = null;
      try { node.stop(0); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    activeSources.clear();
    nextPlayTime = 0;
    if (!closed && outCtx.state !== 'closed') {
      // Brief 8 ms ramp prevents a speaker click when cutting mid-waveform.
      const now = outCtx.currentTime;
      outGain.gain.cancelScheduledValues(now);
      outGain.gain.setValueAtTime(0.0001, now);
      outGain.gain.linearRampToValueAtTime(1, now + 0.008);
    }
    setTalking(false);
  }

  return {
    /** Schedules a base64 16-bit little-endian PCM chunk at 24 kHz seamlessly on the hardware clock. */
    play(b64) {
      if (closed || !b64) return;
      if (outCtx.state === 'suspended') outCtx.resume().catch(() => {});
      const bin = atob(b64);
      const n = bin.length >> 1;
      if (!n) return;
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
        if (v >= 0x8000) v -= 0x10000;
        samples[i] = v / 32768;
      }
      const now = outCtx.currentTime;
      const wasDry = nextPlayTime <= now;
      if (wasDry) {
        // Fresh utterance or real network underrun: seed with a 40 ms jitter buffer and apply a
        // 2 ms fade-in on the opening samples to eliminate any startup click.
        nextPlayTime = now + JITTER_BUFFER_SEC;
        const fadeLen = Math.min(48, n);
        for (let i = 0; i < fadeLen; i++) samples[i] *= i / fadeLen;
      }
      const buf = outCtx.createBuffer(1, n, SPEAKER_RATE);
      buf.copyToChannel(samples, 0);

      const node = outCtx.createBufferSource();
      node.buffer = buf;
      node.connect(outGain);

      const startAt = nextPlayTime;
      nextPlayTime += buf.duration;

      clearTimeout(talkEndTimer);
      talkEndTimer = null;
      activeSources.add(node);
      setTalking(true);

      node.onended = () => {
        activeSources.delete(node);
        try { node.disconnect(); } catch { /* already disconnected */ }
        if (activeSources.size === 0 && !closed) {
          clearTimeout(talkEndTimer);
          talkEndTimer = setTimeout(() => {
            if (activeSources.size === 0) setTalking(false);
          }, 80);
        }
      };
      node.start(startAt);
    },
    /** User barged in: stop and disconnect every active/queued node immediately. */
    interrupt,
    /** Stop sending mic audio (e.g. while reconnecting). */
    setMuted(m) { muted = m; },
    async close() {
      closed = true;
      interrupt();
      mic.port.onmessage = null;
      try { src.disconnect(); boost.disconnect(); comp.disconnect(); mic.disconnect(); } catch { /* ignore */ }
      try { outGain.disconnect(); } catch { /* ignore */ }
      stream.getTracks().forEach((t) => t.stop());
      await Promise.all([micCtx.close(), outCtx.close()]).catch(() => {});
    },
  };
}
