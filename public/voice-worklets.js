// Packaged extension-local processors. No blob URLs, network imports or transcripts.
class DebaitMic extends AudioWorkletProcessor {
  constructor() { super(); this.frame = new ArrayBuffer(1280); this.view = new DataView(this.frame); this.fill = 0; }
  process(inputs) {
    const ch = inputs[0]?.[0]; if (!ch) return true;
    for (const sample of ch) {
      const s = Math.max(-1, Math.min(1, sample));
      this.view.setInt16(this.fill++ * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
      if (this.fill === 640) {
        this.port.postMessage(this.frame, [this.frame]);
        this.frame = new ArrayBuffer(1280); this.view = new DataView(this.frame); this.fill = 0;
      }
    }
    return true;
  }
}
class DebaitPlayer extends AudioWorkletProcessor {
  constructor() {
    super(); this.clear(); this.cushion = Math.round(sampleRate * 0.15);
    this.port.onmessage = ({data}) => {
      if (data === 'clear') { this.clear(); this.port.postMessage({type:'talking', value:false}); return; }
      if (data === 'flush') { this.ending = true; return; }
      if (!(data instanceof Float32Array) || !data.length || data.length + this.buffered > sampleRate * 5) { this.port.postMessage({type:'overflow'}); this.clear(); return; }
      this.queue.push(data); this.buffered += data.length;
    };
  }
  clear() { this.queue=[];this.head=0;this.buffered=0;this.playing=false;this.ending=false;this.gain=0;this.last=0;this.talking=false; }
  process(_inputs, outputs) {
    const out=outputs[0]?.[0];if(!out)return true;
    if (!this.playing && (this.buffered >= this.cushion || (this.ending && this.buffered))) this.playing = true;
    const step=1/(sampleRate*0.006);
    for(let i=0;i<out.length;i++) {
      if(this.playing && this.buffered) {
        const chunk=this.queue[0];this.last=chunk[this.head++];this.buffered--;
        if(this.head===chunk.length){this.queue.shift();this.head=0;}
        this.gain=Math.min(1,this.gain+step);out[i]=this.last*this.gain;
      } else {
        if(this.playing){
          this.playing=false;
          if(!this.ending){this.cushion=Math.min(Math.round(sampleRate*.4),Math.round(this.cushion*1.5));this.port.postMessage({type:'buffering'});}
        }
        this.gain=Math.max(0,this.gain-step);out[i]=this.last*this.gain;
      }
    }
    const talking=this.buffered>0 && this.playing || this.gain>0;
    if(talking!==this.talking){this.talking=talking;this.port.postMessage({type:'talking',value:talking});}
    if(!this.buffered && !this.gain)this.ending=false;
    return true;
  }
}
registerProcessor('debait-mic', DebaitMic);
registerProcessor('debait-player', DebaitPlayer);
