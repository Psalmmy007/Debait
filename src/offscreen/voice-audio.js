// Debait's own audio pipeline for the voice call (runs entirely inside the offscreen document):
// - Single AudioContext for both mic capture and 24 kHz PCM playback (eliminates dual-context
//   Windows WASAPI stalls/glitches and keeps raw PCM off Chrome message-passing).
// - Mic capture: 16 kHz 16-bit PCM in steady 100 ms frames via `debait-mic` AudioWorklet
//   (echoCancellation, noiseSuppression, autoGainControl enabled; zero-copy transfer).
// - Playback: gapless AudioBufferSourceNode scheduling on the AudioContext timeline
//   (`nextPlayTime = Math.max(ctx.currentTime, nextPlayTime)`) with instant <1 ms barge-in flush.
const MIC_RATE = 16000;
const SPEAKER_RATE = 24000;
const MIC_FRAME_SEC = 0.1;       // steady 100 ms mic frames (1600 samples @ 16 kHz -> 10 pkt/s, no WS backpressure)
const START_LEAD_SEC = 0.015;    // 15 ms initial lead-in prevents first-chunk underrun without audible lag
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
 * @param onMic      (base64Pcm16k) => void, 10 times a second (100 ms frames)
 * @param onTalking  (bool) => void, when Debait starts / stops speaking
 * @param startMuted boolean, keep mic silent until the Live session is ready
 */
export async function openAudio({ onMic, onTalking, startMuted = false }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: { ideal: MIC_RATE },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  // Single AudioContext at 24 kHz (exact speaker rate; debait-mic anti-alias resamples to 16 kHz).
  // Falls back to hardware default sampleRate if the OS/device rejects 24 kHz.
  let ctx;
  let src;
  try {
    try {
      ctx = new AudioContext({ sampleRate: SPEAKER_RATE, latencyHint: 'interactive' });
      src = ctx.createMediaStreamSource(stream);
    } catch {
      await ctx?.close().catch(() => {});
      ctx = new AudioContext({ latencyHint: 'interactive' });
      src = ctx.createMediaStreamSource(stream);
    }
    const url = chrome.runtime.getURL('voice-worklets.js');
    await ctx.audioWorklet.addModule(url);
    await ctx.resume();
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx?.close().catch(() => {});
    throw err;
  }

  const mic = new AudioWorkletNode(ctx, 'debait-mic', {
    processorOptions: { targetSampleRate: MIC_RATE, frameSeconds: MIC_FRAME_SEC },
  });
  let muted = !!startMuted;
  let talking = false;
  let closed = false;
  if (muted) stream.getAudioTracks().forEach((t) => { t.enabled = false; });

  const silence = new Int16Array(Math.round(MIC_RATE * MIC_FRAME_SEC));
  mic.port.onmessage = (e) => {
    if (muted || closed) return;
    let pcm = e.data;
    if (!(pcm instanceof Int16Array) || !pcm.length) return;
    if (talking) {
      let sum = 0;
      for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
      if (Math.sqrt(sum / pcm.length) / 32768 < ECHO_GATE) pcm = silence;
    }
    onMic(toBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)));
  };

  const boost = ctx.createGain();
  boost.gain.value = MIC_BOOST;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 10;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  src.connect(boost).connect(comp).connect(mic);

  // ---------- 24 kHz PCM playback on the same AudioContext timeline ----------
  let outGain = ctx.createGain();
  outGain.gain.value = 1;
  outGain.connect(ctx.destination);

  const activeNodes = new Set();
  let nextPlayTime = 0;
  let quietTimer = null;

  function setTalking(next) {
    if (talking === next) return;
    talking = next;
    if (!closed) onTalking?.(next);
  }

  function clearScheduled() {
    clearTimeout(quietTimer);
    quietTimer = null;
    for (const node of activeNodes) {
      node.onended = null;
      try { node.stop(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* ignore */ }
    }
    activeNodes.clear();
    nextPlayTime = 0;
  }

  function interrupt() {
    clearScheduled();
    // Swap output gain node cleanly so any audio tail cuts off immediately without clicks.
    try { outGain.disconnect(); } catch { /* ignore */ }
    if (!closed && ctx.state !== 'closed') {
      outGain = ctx.createGain();
      outGain.gain.value = 1;
      outGain.connect(ctx.destination);
    }
    setTalking(false);
  }

  function stopImmediate() {
    closed = true;
    muted = false;
    clearScheduled();
    mic.port.onmessage = null;
    try { src.disconnect(); boost.disconnect(); comp.disconnect(); mic.disconnect(); } catch { /* ignore */ }
    try { outGain.disconnect(); } catch { /* ignore */ }
    stream.getTracks().forEach((t) => t.stop());
  }

  return {
    /** Decodes base64 16-bit LE 24 kHz PCM and schedules it gaplessly on the AudioContext timeline. */
    play(b64) {
      if (closed || !b64) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      let bin;
      try { bin = atob(b64); } catch { return; }
      const n = bin.length >> 1;
      if (!n) return;

      const buffer = ctx.createBuffer(1, n, SPEAKER_RATE);
      const ch = buffer.getChannelData(0);
      for (let i = 0; i < n; i++) {
        let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
        if (v >= 0x8000) v -= 0x10000;
        ch[i] = v / 32768;
      }

      const now = ctx.currentTime;
      const startAt = nextPlayTime > now ? nextPlayTime : Math.max(now + START_LEAD_SEC, nextPlayTime);
      nextPlayTime = startAt + buffer.duration;

      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(outGain);
      activeNodes.add(node);
      clearTimeout(quietTimer);
      setTalking(true);

      node.onended = () => {
        activeNodes.delete(node);
        try { node.disconnect(); } catch { /* ignore */ }
        if (activeNodes.size === 0 && !closed) {
          if (nextPlayTime <= ctx.currentTime + 0.02) nextPlayTime = 0;
          clearTimeout(quietTimer);
          quietTimer = setTimeout(() => {
            if (activeNodes.size === 0 && !closed) setTalking(false);
          }, 80);
        }
      };
      node.start(startAt);
    },
    /** User barged in: immediately flush all queued playback nodes in < 1 ms. */
    interrupt,
    /** Synchronously stop mic tracks and speaker playback (safe to call before awaiting close). */
    stopImmediate,
    /** Mute/unmute the microphone immediately (disables live audio tracks and drops PCM frames). */
    setMuted(m) {
      muted = !!m;
      stream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    },
    async close() {
      stopImmediate();
      if (ctx.state !== 'closed') await ctx.close().catch(() => {});
    },
  };
}
