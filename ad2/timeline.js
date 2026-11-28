// Shared by the ad page (browser) and the renderer (Node): when each voice line starts.
// Everything on screen is timed from these, so swapping the voice re-times the whole ad.

export const FPS = 30;
export const SIZE = { w: 1920, h: 1080 };

// pause before each line, in seconds (the dramatic beats live here)
const GAP = { read: 1.0, feed: 0.9, clicks: 0.8, meet: 2.2, reads: 1.4, click: 1.2, device: 2.0, label: 1.2, end: 1.4 };
const TAIL = 3.2; // hold on the end card

export function schedule(timing) {
  const lines = {};
  let t = 0;
  for (const line of timing) {
    t += GAP[line.id] ?? 1;
    lines[line.id] = { ...line, start: t, end: t + line.dur };
    t += line.dur;
  }
  return { lines, duration: t + TAIL };
}

/** Absolute time a word is spoken (first word containing `needle`). Falls back to an estimate. */
export function wordAt(lines, id, needle, edge = 't0') {
  const line = lines[id];
  const n = needle.toLowerCase();
  const w = line.words?.find((x) => x.w.toLowerCase().replace(/[^a-z0-9'-]/g, '').includes(n));
  if (w) return line.start + w[edge];
  const i = Math.max(0, line.text.toLowerCase().indexOf(n));
  return line.start + (i / line.text.length) * line.dur;
}

/** Rough timing for previewing before the voice is recorded (~2.6 words per second). */
export function estimateTiming(script) {
  return script.lines.map((l) => {
    const words = l.text.split(/\s+/);
    const per = 1 / 2.6;
    return {
      id: l.id,
      text: l.text,
      dur: words.length * per + 0.2,
      words: words.map((w, i) => ({ w: w.replace(/[^\w'-]/g, ''), t0: i * per, t1: (i + 1) * per })),
    };
  });
}

/** Moments the music hits on. */
export function cues(sched) {
  const L = sched.lines;
  return {
    duration: sched.duration,
    reveal: L.clicks.end + 0.6, // the orb appears
    meet: L.meet.start,
    click: wordAt(L, 'click', 'click') + 0.05,
    label: L.label.start,
    end: L.end.start,
  };
}
