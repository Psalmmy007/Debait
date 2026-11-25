// Debait voice call audio, running on the audio render thread.
//
// debait-mic: microphone -> 16 kHz 16-bit PCM in steady 20 ms frames.
//   Anti-aliased (averages every input sample in each output step), keeps its fractional position
//   across blocks so there are no clicks at block edges.
//
// debait-player: 24 kHz PCM from Gemini -> speakers via a lock-free Float32 circular ring buffer.
//   Runs 100% off the main thread so page loads/jank never cause crackling or popping.
//   Uses a steady 40 ms pre-buffer on initial start/underrun, 2 ms anti-click ramps, and <1 ms flush on barge-in.

class DebaitMic extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const targetRate = options.processorOptions?.targetSampleRate || 16000;
    const frameSeconds = options.processorOptions?.frameSeconds || 0.02;
    this.ratio = sampleRate / targetRate; // input samples per output sample
    this.frame = new Int16Array(Math.round(targetRate * frameSeconds)); // steady 20 ms frames
    this.fill = 0;
    this.acc = 0;   // sum of input samples in the current output step
    this.n = 0;     // how many
    this.pos = 0;   // progress through the current output step, in input samples
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.n++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const s = Math.max(-1, Math.min(1, this.acc / this.n));
        this.frame[this.fill++] = s < 0 ? s * 32768 : s * 32767;
        this.acc = 0;
        this.n = 0;
        if (this.fill === this.frame.length) {
          this.port.postMessage(this.frame.slice());
          this.fill = 0;
        }
      }
    }
    return true;
  }
}

class DebaitPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const inputRate = options?.processorOptions?.inputSampleRate || sampleRate;
    this.ratio = inputRate / sampleRate;
    this.exactRate = Math.abs(this.ratio - 1) < 1e-4;

    // Power-of-two circular Float32 ring buffer (~10.9 s @ 24 kHz), zero per-frame allocations.
    this.capacity = 1 << 18;
    this.mask = this.capacity - 1;
    this.ring = new Float32Array(this.capacity);
    this.readIdx = 0;
    this.writeIdx = 0;
    this.buffered = 0;

    // Minimal steady 40 ms pre-buffer on initial start or underrun; 2 ms soft ramp eliminates clicks.
    this.prebuffer = Math.round(inputRate * 0.04);
    this.fadeStep = 1 / Math.max(1, Math.round(sampleRate * 0.002));
    this.quietHold = Math.round(sampleRate * 0.06);

    this.playing = false;
    this.talking = false;
    this.gain = 0;
    this.lastSample = 0;
    this.curSample = 0;
    this.frac = 0;
    this.quietSamples = this.quietHold;

    this.port.onmessage = (e) => {
      const data = e.data;
      if (data === 'flush' || data === 'clear') {
        // Instant barge-in (< 1 ms): clear ring buffer immediately and drop talking state.
        this.readIdx = 0;
        this.writeIdx = 0;
        this.buffered = 0;
        this.playing = false;
        this.curSample = 0;
        this.frac = 0;
        this.quietSamples = this.quietHold;
        if (this.talking) {
          this.talking = false;
          this.port.postMessage({ talking: false });
        }
        return;
      }
      if (!(data instanceof Float32Array) || !data.length) return;
      const len = data.length;
      const free = this.capacity - this.buffered;
      if (len > free) {
        // Overflow guard: advance read pointer to keep newest audio.
        const drop = Math.min(this.buffered, len - free);
        this.readIdx = (this.readIdx + drop) & this.mask;
        this.buffered -= drop;
      }
      const n = Math.min(len, this.capacity);
      const start = len - n;
      for (let i = start; i < len; i++) {
        this.ring[this.writeIdx] = data[i];
        this.writeIdx = (this.writeIdx + 1) & this.mask;
      }
      this.buffered += n;
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;

    const ring = this.ring;
    const mask = this.mask;
    const step = this.fadeStep;

    if (!this.playing && this.buffered >= this.prebuffer) {
      this.playing = true;
      if (!this.exactRate && this.buffered > 0) {
        this.curSample = ring[this.readIdx];
        this.readIdx = (this.readIdx + 1) & mask;
        this.buffered--;
        this.frac = 0;
      }
    }

    for (let i = 0; i < out.length; i++) {
      let haveSample = false;
      let s = 0;
      if (this.playing) {
        if (this.exactRate) {
          if (this.buffered > 0) {
            s = ring[this.readIdx];
            this.readIdx = (this.readIdx + 1) & mask;
            this.buffered--;
            haveSample = true;
          }
        } else {
          while (this.frac >= 1 && this.buffered > 0) {
            this.curSample = ring[this.readIdx];
            this.readIdx = (this.readIdx + 1) & mask;
            this.buffered--;
            this.frac -= 1;
          }
          if (this.buffered > 0) {
            const nextSample = ring[this.readIdx];
            s = this.curSample + (nextSample - this.curSample) * this.frac;
            this.frac += this.ratio;
            haveSample = true;
          }
        }
      }

      if (haveSample) {
        this.lastSample = s;
        if (this.gain < 1) this.gain = Math.min(1, this.gain + step);
        out[i] = s * this.gain;
        this.quietSamples = 0;
      } else {
        this.playing = false;
        this.frac = 0;
        if (this.gain > 0) {
          this.gain = Math.max(0, this.gain - step);
          out[i] = this.lastSample * this.gain;
          if (this.gain === 0) this.lastSample = 0;
        } else {
          out[i] = 0;
        }
        this.quietSamples++;
      }
    }

    const isTalking = this.playing || this.buffered > 0 || this.gain > 0.001 || this.quietSamples < this.quietHold;
    if (isTalking !== this.talking) {
      this.talking = isTalking;
      this.port.postMessage({ talking: isTalking });
    }
    return true;
  }
}

registerProcessor('debait-mic', DebaitMic);
registerProcessor('debait-player', DebaitPlayer);
