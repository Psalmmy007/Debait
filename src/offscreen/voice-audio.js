import { describeAiError } from '../engine/errors.js';
// Public LiveSession methods + extension-local AudioWorklets. No SDK private fields.
const audioError = message => Object.assign(new Error(message), { code: 'debait/audio' });
let busy = false; // Includes permission requests and cleanup, not just resolved controllers.
export async function startVoiceAudio(session, options, dependencies = {}) {
  if (busy) throw audioError('The previous microphone request is still finishing. Close its permission prompt or wait, then call again.');
  busy = true;
  const { assertAllowed, signal, functionCallingHandler, onResumeHandle, onTalking, onTranscript, onBuffering } = options;
  const media = dependencies.media || navigator.mediaDevices;
  const Context = dependencies.AudioContext || AudioContext, Node = dependencies.AudioWorkletNode || AudioWorkletNode;
  const url = dependencies.workletUrl || chrome.runtime.getURL('voice-worklets.js');
  let stream, micCtx, outCtx, mic, player, src, sink, stopped = false, stopping, initTimer;
  let complete; const done = new Promise(resolve => { complete = resolve; });
  const cancelled = options.cancelledToolIds || new Set(); let toolQueue = Promise.resolve(), heard = '', queued = 0, upload = Promise.resolve();
  const guard = async () => { if (stopped || signal.aborted) throw audioError('Voice was stopped.'); await assertAllowed(); if (stopped || signal.aborted) throw audioError('Voice was stopped.'); };
  const stop = () => {
    if (stopping) return stopping;
    stopped = true; // Synchronous: no queued audio frame may send after this point.
    stream?.getTracks().forEach(t=>t.stop());
    for(const n of [src,mic,player,sink])try{n?.disconnect();}catch{}
    if(mic)mic.port.onmessage=null;if(player)player.port.onmessage=null;
    signal.removeEventListener('abort', stop);complete({reason:'stopped'});
    stopping=Promise.allSettled([micCtx?.close(),outCtx?.close()]).then(()=>{busy=false;});
    return stopping;
  };
  const finish = result => { if (!stopped) complete(result); };
  const failed = error => {
    if (error.code === 'debait/voice-limit') return { reason: 'fatal', message: 'Voice action limit reached. Start a new call.' };
    if (error.code === 'debait/audio') return { reason: 'audio', message: error.message };
    const safe = describeAiError(error);
    return { reason: ['debait/network','debait/service','debait/timeout'].includes(safe.code) ? 'network' : 'fatal',
      code: safe.code, message: safe.message, retryAfterMs: safe.retryAfterMs };
  };
  try {
    await guard();
    // getUserMedia itself has no AbortSignal. A late stream is stopped before graph setup.
    stream=await media.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    signal.addEventListener('abort',stop,{once:true});
    await guard();
    micCtx=new Context({sampleRate:16000,latencyHint:'interactive'});
    outCtx=new Context({sampleRate:24000,latencyHint:'interactive'});
    if(micCtx.sampleRate!==16000 || outCtx.sampleRate!==24000)throw audioError('Chrome could not initialize the required 16 kHz microphone / 24 kHz playback. No audio was sent.');
    const initialize = async () => {
      await Promise.all([micCtx.audioWorklet.addModule(url),outCtx.audioWorklet.addModule(url)]);await guard();
      await Promise.all([micCtx.resume(),outCtx.resume()]);await guard();
    };
    try { await Promise.race([initialize(), new Promise((_,reject)=>{initTimer=setTimeout(()=>reject(audioError('Chrome did not start voice audio. Check microphone/autoplay permissions and call again.')),dependencies.initTimeoutMs || 10000);})]); }
    finally { clearTimeout(initTimer); }
    if(micCtx.state!=='running' || outCtx.state!=='running')throw audioError('Chrome suspended voice audio. Start the call from the extension and check audio permissions.');
    src=micCtx.createMediaStreamSource(stream);mic=new Node(micCtx,'debait-mic');
    sink=micCtx.createGain();sink.gain.value=0;src.connect(mic);mic.connect(sink);sink.connect(micCtx.destination);
    player=new Node(outCtx,'debait-player',{outputChannelCount:[1]});player.connect(outCtx.destination);
    const fail = message => finish({reason:'audio',message});
    stream.getTracks().forEach(t=>t.addEventListener?.('ended',()=>fail('The microphone stopped. Check Chrome permissions and start another call.')));
    for(const ctx of [micCtx,outCtx])ctx.onstatechange=()=>{if(!stopped && ctx.state!=='running')fail('Chrome paused voice audio. Start another call after checking audio permissions.');};
    mic.onprocessorerror=player.onprocessorerror=()=>fail('Chrome could not process voice audio. Start another call.');
    player.port.onmessage=({data})=>{
      if(stopped)return;
      if(data.type==='overflow')fail('Voice playback fell too far behind. The call stopped rather than silently skipping speech.');
      else if(data.type==='talking')onTalking?.(data.value);
      else if(data.type==='buffering')onBuffering?.();
    };
    mic.port.onmessage=({data})=>{
      if(stopped || signal.aborted)return;
      // No unbounded queue: a slow SDK send stops the stream rather than leaking old speech.
      if(queued >= 10){fail('Voice upload is falling behind. Check the connection and start another call.');return;}
      queued++;
      upload=upload.then(async()=>{
      try {
        await guard();const bytes=new Uint8Array(data);
        if(bytes.byteLength!==1280)throw audioError('Unexpected microphone audio format.');
        let binary='';for(const value of bytes)binary+=String.fromCharCode(value);
        await guard();await session.sendAudioRealtime({mimeType:'audio/pcm;rate=16000',data:btoa(binary)});
      } catch(error) { if(!stopped && !signal.aborted)finish(failed(error)); }
      finally{queued--;}
      });
    };
    const listen = async () => {
      try {
        for await(const message of session.receive()) {
          await guard();
          if(message.type==='serverContent') {
            if(message.interrupted)player.port.postMessage('clear');
            if(message.inputTranscription?.text){heard=(heard+message.inputTranscription.text).slice(-1000);onTranscript?.(heard);}
            for(const part of message.modelTurn?.parts || [])if(part.inlineData) {
              const {mimeType,data}=part.inlineData;
              if(!/^audio\/pcm(?:;rate=24000)?$/.test(mimeType))throw audioError('Gemini returned an unsupported voice playback format.');
              let binary;try { if(typeof data!=='string')throw new Error();binary=atob(data); } catch { throw audioError('Gemini returned invalid PCM audio.'); }
              if(binary.length%2)throw audioError('Gemini returned incomplete PCM audio.');
              const samples=new Float32Array(binary.length/2);
              for(let i=0;i<samples.length;i++){const v=binary.charCodeAt(2*i)|(binary.charCodeAt(2*i+1)<<8);samples[i]=(v>=32768?v-65536:v)/32768;}
              await guard();player.port.postMessage(samples,[samples.buffer]);
            }
            if(message.turnComplete){player.port.postMessage('flush');heard='';}
          } else if(message.type==='sessionResumptionUpdate')onResumeHandle?.(message.resumable===true && typeof message.newHandle==='string' && message.newHandle.length>0 && message.newHandle.length<=4096 ? message.newHandle : null);
          else if(message.type==='goingAwayNotice'){finish({reason:'network'});return;}
          else if(message.type==='toolCallCancellation'){for(const id of message.functionIds || []){if(cancelled.size>=256)throw audioError('Voice cancellation history limit reached. Start a new call.');cancelled.add(id);}}
          else if(message.type==='toolCall') {
            toolQueue=toolQueue.then(async()=>{
              for(const call of message.functionCalls || []) {
                if(cancelled.has(call.id))continue;await guard();
                const response=await functionCallingHandler([call]);await guard();
                if(!cancelled.has(call.id))await session.sendFunctionResponses([response]);
              }
            }).catch(error=>{if(!stopped && !signal.aborted)finish(failed(error));});
          }
        }
        if(!stopped)finish({reason:'network'});
      } catch(error){if(!stopped && !signal.aborted)finish(failed(error));}
    };
    void listen();return {stop,done};
  } catch(error){
    await stop();
    if (error.code==='debait/audio' || ['NotAllowedError','NotFoundError'].includes(error.name) || /^LOCAL_ONLY/.test(error.message || '')) throw error;
    throw audioError('Chrome could not initialize the microphone or packaged AudioWorklet. Check audio permissions and reload the extension. No audio was sent.');
  }
}
