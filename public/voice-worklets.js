// Debait voice call audio, running on the audio thread.
//
// debait-mic: microphone -> 16 kHz 16-bit PCM in 40 ms frames.
//   Anti-aliased (averages every input sample in each output step, not just one), keeps its
//   position across blocks so there are no clicks at block edges, and sends 25 frames a second
//   instead of hundreds of tiny ones.
//
// debait-player: 24 kHz PCM from Gemini -> speakers, through a jitter buffer.
//   Waits for a small cushion before speaking, rides out late network packets instead of
//   cracking, fades in/out on gaps, grows the cushion if the network keeps stalling, and
//   reports when Gemini starts and stops talking.

class DebaitMic extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / options.processorOptions.targetSampleRate; // input samples per output sample
    this.frame = new Int16Array(Math.round(options.processorOptions.targetSampleRate * 0.04)); // 40 ms
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
  constructor() {
    super();
    this.queue = [];       // Float32Array chunks
    this.head = 0;         // read position in queue[0]
    this.buffered = 0;     // samples waiting
    this.cushion = Math.round(sampleRate * 0.22);   // start speaking once this much is buffered (fewer mid-word stalls)
    this.maxCushion = Math.round(sampleRate * 0.6);
    this.playing = false;
    this.talking = false;
    this.gain = 0;         // for short fades, so gaps never click
    this.quiet = 0;        // samples of silence since the last audio
    this.last = 0;         // last sample played, faded out on a gap instead of cutting to 0
    this.port.onmessage = (e) => {
      if (e.data === 'clear') {
        this.queue = []; this.head = 0; this.buffered = 0; this.playing = false;
        return;
      }
      this.queue.push(e.data);
      this.buffered += e.data.length;
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!this.playing && this.buffered >= this.cushion) this.playing = true;
    const fadeStep = 1 / (sampleRate * 0.006); // 6 ms fades
    for (let i = 0; i < out.length; i++) {
      let s = 0;
      if (this.playing && this.buffered > 0) {
        const chunk = this.queue[0];
        s = chunk[this.head++];
        this.last = s;
        this.buffered--;
        if (this.head >= chunk.length) { this.queue.shift(); this.head = 0; }
        this.gain = Math.min(1, this.gain + fadeStep);
        this.quiet = 0;
      } else {
        if (this.playing) {
          // ran dry mid-sentence: the network is slow, so keep a bigger cushion from now on
          this.playing = false;
          this.cushion = Math.min(this.maxCushion, Math.round(this.cushion * 1.5));
        }
        this.gain = Math.max(0, this.gain - fadeStep);
        s = this.last;
        this.quiet++;
      }
      out[i] = s * this.gain;
    }
    const talking = this.quiet < sampleRate * 0.35;
    if (talking !== this.talking) { this.talking = talking; this.port.postMessage({ talking }); }
    return true;
  }
}

registerProcessor('debait-mic', DebaitMic);
registerProcessor('debait-player', DebaitPlayer);
