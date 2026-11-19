// Debait's own call sounds, made on the fly (no audio files):
// "start" is a bright two-note rise, "end" the same two notes falling, each with a soft shimmer
// and a short echo, like a tap on glass.
let ctx = null;

const NOTES = { start: [659.25, 987.77], end: [987.77, 659.25] }; // E5 and B5

export function chime(kind = 'start') {
  try {
    ctx ||= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + 0.02;

    const out = ctx.createGain();
    out.gain.value = 0.16;
    out.connect(ctx.destination);
    // short echo: a little space around the notes
    const echo = ctx.createDelay();
    echo.delayTime.value = 0.13;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    echo.connect(feedback).connect(echo);
    echo.connect(wet).connect(out);

    (NOTES[kind] || NOTES.start).forEach((f, i) => {
      const at = t0 + i * 0.1;
      // body, a quiet octave above (the "glass"), and a slightly detuned layer for width
      for (const [type, mult, vol, len] of [['sine', 1, 1, 0.7], ['sine', 2, 0.22, 0.35], ['triangle', 1.004, 0.28, 0.5]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        o.connect(g);
        g.connect(out);
        g.connect(echo);
        o.start(at);
        o.stop(at + len + 0.05);
      }
    });
  } catch { /* no audio on this page: stay silent */ }
}
