// Frame-accurate 60fps, 120 BPM kinetic promo choreography for Debait (24.0s, 1920x1080).
// Pure function of time `t` so CDP frame-stepping produces identical deterministic output.
import { createOrbRenderer } from '../src/content/ui/orb-gl.js';

export const DURATION = 24.0;
export const FPS = 60;
export const BPM = 120;
const BEAT = 60 / BPM; // 0.500s

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const norm = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

// Critically/under-damped spring curve: snappy overshoot + fast settle.
function spring(p, freq = 9.5, decay = 7.2) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return 1 - Math.exp(-decay * p) * Math.cos(freq * p);
}
function easeOutExpo(p) {
  return p >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(p));
}
function easeOutCubic(p) {
  const q = 1 - clamp(p);
  return 1 - q * q * q;
}
function easeInOutCubic(p) {
  const x = clamp(p);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
// 120 BPM beat envelope: sharp peak on every beat (0.5s), fast decay.
function beatPulse(t) {
  const frac = ((t % BEAT) + BEAT) % BEAT / BEAT;
  return Math.exp(-frac * 6.5);
}

const $ = (id) => document.getElementById(id);

const scenes = {
  s1: $('s1'), s2: $('s2'), s3: $('s3'), s4: $('s4'), s5: $('s5'), s6: $('s6'),
};
const flashEl = $('flash');

// Scene 2 waveform canvas
const waveCanvas = $('s2-wave');
const wCtx = waveCanvas.getContext('2d');

// Scene 6 real Debait WebGL liquid-smoke glass orb
const orbCanvas = $('s6-orb');
const orbGL = createOrbRenderer(orbCanvas, 480, { dpr: 1, preserve: true });

function setActive(name) {
  for (const [k, el] of Object.entries(scenes)) {
    el.classList.toggle('active', k === name);
  }
}

function drawWaveform(t, intensity) {
  const W = waveCanvas.width;
  const H = waveCanvas.height;
  const mid = H / 2;
  wCtx.clearRect(0, 0, W, H);
  const pulse = beatPulse(t);
  const amp = (42 + pulse * 68) * intensity;

  const layers = [
    { color: 'rgba(255, 90, 31, 0.32)', blur: 26, width: 10, phase: 0, mult: 1.15 },
    { color: 'rgba(255, 122, 51, 0.85)', blur: 10, width: 4, phase: 0.4, mult: 1.0 },
    { color: 'rgba(255, 255, 255, 0.95)', blur: 2, width: 1.8, phase: 0.8, mult: 0.72 },
  ];

  for (const L of layers) {
    wCtx.save();
    wCtx.beginPath();
    wCtx.strokeStyle = L.color;
    wCtx.lineWidth = L.width;
    wCtx.shadowColor = '#FF5A1F';
    wCtx.shadowBlur = L.blur;
    for (let x = 0; x <= W; x += 8) {
      const u = x / W;
      const env = Math.sin(u * Math.PI) ** 1.4;
      const w1 = Math.sin(u * 24 - t * 14 + L.phase);
      const w2 = Math.sin(u * 54 + t * 22 - L.phase * 1.3) * 0.45;
      const w3 = Math.sin(u * 108 - t * 34) * 0.22 * (0.4 + pulse);
      const y = mid + (w1 + w2 + w3) * amp * env * L.mult;
      if (x === 0) wCtx.moveTo(x, y);
      else wCtx.lineTo(x, y);
    }
    wCtx.stroke();
    wCtx.restore();
  }
}

function setFlash(t) {
  // Sharp 2-3 frame flash transitions on key hard cuts
  const flashes = [
    { at: 3.00, dur: 0.14, color: '#FF5A1F', peak: 0.85 },
    { at: 4.25, dur: 0.08, color: '#FFFFFF', peak: 0.35 },
    { at: 5.50, dur: 0.08, color: '#FFFFFF', peak: 0.35 },
    { at: 6.75, dur: 0.09, color: '#FF7A33', peak: 0.45 },
    { at: 8.00, dur: 0.13, color: '#FFFFFF', peak: 0.72 },
    { at: 10.00, dur: 0.13, color: '#FF5A1F', peak: 0.55 },
    { at: 17.00, dur: 0.18, color: '#FFFFFF', peak: 1.0 },
    { at: 19.60, dur: 0.10, color: '#FF5A1F', peak: 0.45 },
    { at: 21.00, dur: 0.16, color: '#FFFFFF', peak: 0.92 },
  ];
  let best = 0;
  let col = '#FFFFFF';
  for (const f of flashes) {
    const dt = t - f.at;
    if (dt >= -0.025 && dt <= f.dur) {
      const p = dt < 0 ? 1 + dt / 0.025 : 1 - dt / f.dur;
      const a = clamp(p) * f.peak;
      if (a > best) { best = a; col = f.color; }
    }
  }
  flashEl.style.background = col;
  flashEl.style.opacity = best.toFixed(3);
}

// ==================== SCENE 1 (0:00 – 0:03) ====================
function renderS1(t) {
  setActive('s1');
  const frames = Math.floor(t * FPS);
  const sec = Math.floor(t);
  const fRem = frames % FPS;
  $('s1-tc').textContent = `00:0${sec}:${String(fRem).padStart(2, '0')}`;

  const words = [
    { id: 's1-w0', start: 0.08, dur: 0.48 },
    { id: 's1-w1', start: 0.36, dur: 0.50 },
    { id: 's1-w2', start: 1.05, dur: 0.46 },
    { id: 's1-w3', start: 1.24, dur: 0.46 },
    { id: 's1-w4', start: 1.50, dur: 0.58 },
  ];
  for (const w of words) {
    const p = norm(t, w.start, w.start + w.dur);
    const s = spring(p, 9.2, 7.6);
    const y = (1 - s) * 145;
    const blur = (1 - easeOutExpo(p)) * 10;
    const el = $(w.id);
    el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0) scale(${lerp(0.92, 1, s).toFixed(4)})`;
    el.style.opacity = clamp(p * 4).toFixed(3);
    el.style.filter = blur > 0.25 ? `blur(${blur.toFixed(2)}px)` : 'none';
  }

  // Accent bar sweep under "attention."
  const barP = easeOutExpo(norm(t, 1.62, 2.25));
  $('s1-bar').style.transform = `scaleX(${barP.toFixed(4)})`;

  // Subtle kinetic push-in toward the Beat 6 hard cut
  const zoom = 1 + easeInOutCubic(norm(t, 1.8, 3.0)) * 0.14;
  const pushBlur = norm(t, 2.84, 3.0) * 8;
  const stack = document.querySelector('.s1-stack');
  stack.style.transform = `scale(${zoom.toFixed(4)})`;
  stack.style.filter = pushBlur > 0.2 ? `blur(${pushBlur.toFixed(2)}px)` : 'none';
}

// ==================== SCENE 2 (0:03 – 0:08) ====================
function renderS2(t) {
  setActive('s2');
  const local = t - 3.0; // 0 .. 5.0
  const pulse = beatPulse(t);

  drawWaveform(t, 0.85 + 0.25 * easeOutCubic(norm(local, 0, 0.4)));

  // Curved 3D barrel viewport tilts slightly with beat & snap rhythm
  const snapIdx = local < 1.25 ? 0 : local < 2.5 ? 1 : local < 3.75 ? 2 : 3;
  const snapStart = snapIdx * 1.25;
  const sp = norm(local, snapStart, snapStart + 0.34);
  const sEase = spring(sp, 10.5, 8.0);

  const rx = Math.sin(local * 1.5) * 3.2;
  const ry = (snapIdx % 2 === 0 ? -1 : 1) * lerp(8.5, 2.8, easeOutCubic(sp));
  const sc = lerp(0.88, 1.0, sEase) + pulse * 0.012;
  const barrel = $('s2-barrel');
  barrel.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${sc.toFixed(4)})`;

  const ids = ['s2-badge-0', 's2-badge-1', 's2-badge-2', 's2-feed'];
  ids.forEach((id, i) => {
    const el = $(id);
    if (i !== snapIdx) {
      el.style.opacity = '0';
      el.style.transform = 'scale(0.82)';
      return;
    }
    const enter = spring(norm(local, snapStart, snapStart + 0.38), 10.2, 7.8);
    const exit = norm(local, snapStart + 1.12, snapStart + 1.25);
    const tx = (1 - enter) * (i % 2 === 0 ? -90 : 90) - exit * 70;
    const scale = lerp(0.84, 1, enter) * lerp(1, 1.07, exit);
    const blur = (1 - easeOutExpo(norm(local, snapStart, snapStart + 0.2))) * 10 + exit * 8;
    el.style.opacity = String((clamp(enter * 3) * (1 - exit)).toFixed(3));
    el.style.transform = `translate3d(${tx.toFixed(1)}px, 0, 0) scale(${scale.toFixed(4)})`;
    el.style.filter = blur > 0.25 ? `blur(${blur.toFixed(2)}px)` : 'none';
  });

  // Staggered rows in the feed mockup during the final 1.25s
  if (snapIdx === 3) {
    const fl = local - 3.75;
    for (let r = 0; r < 4; r++) {
      const rp = norm(fl, 0.06 + r * 0.14, 0.34 + r * 0.14);
      const rs = spring(rp, 10, 8);
      const row = $(`fr-${r}`);
      row.style.opacity = clamp(rp * 3).toFixed(3);
      row.style.transform = `translate3d(${((1 - rs) * 60).toFixed(1)}px, 0, 0)`;
    }
  }
}

// ==================== SCENE 3 (0:08 – 0:10) ====================
function renderS3(t) {
  setActive('s3');
  const local = t - 8.0; // 0 .. 2.0
  const p = norm(local, 0, 2.0);

  // Dramatic diagonal warm light sweep slashing across dark background
  const sweepX = lerp(-260, 2050, easeInOutCubic(p));
  $('s3-sweep').style.transform = `translate3d(${sweepX.toFixed(1)}px, 0, 0) rotate(28deg)`;
  const sweep2X = lerp(-120, 2280, easeInOutCubic(clamp(p * 1.12 - 0.04)));
  $('s3-sweep-2').style.transform = `translate3d(${sweep2X.toFixed(1)}px, 0, 0) rotate(28deg)`;

  for (let i = 0; i < 7; i++) {
    const wp = norm(local, 0.08 + i * 0.11, 0.44 + i * 0.11);
    const ws = spring(wp, 9.6, 7.6);
    const blur = (1 - easeOutExpo(wp)) * 9;
    const el = $(`s3-w${i}`);
    el.style.opacity = clamp(wp * 3.5).toFixed(3);
    el.style.transform = `translate3d(0, ${((1 - ws) * 58).toFixed(1)}px, 0) scale(${lerp(0.9, 1, ws).toFixed(4)})`;
    el.style.filter = blur > 0.25 ? `blur(${blur.toFixed(2)}px)` : 'none';
  }

  const copyScale = lerp(0.96, 1.06, easeOutCubic(p));
  $('s3-copy').style.transform = `scale(${copyScale.toFixed(4)})`;
}

// ==================== SCENE 4 (0:10 – 0:17): 3D FLOATING, FANNING & STACKING UI CARDS ====================
function placeCard(el, cfg) {
  const { x, y, z, rx, ry, rz, s, o, blur = 0 } = cfg;
  el.style.opacity = clamp(o).toFixed(3);
  el.style.transform = `translate3d(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px), ${z.toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${s.toFixed(4)})`;
  el.style.filter = blur > 0.25 ? `blur(${blur.toFixed(2)}px)` : 'none';
}

function interpPose(a, b, p) {
  return {
    x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), z: lerp(a.z, b.z, p),
    rx: lerp(a.rx, b.rx, p), ry: lerp(a.ry, b.ry, p), rz: lerp(a.rz, b.rz, p),
    s: lerp(a.s, b.s, p), o: lerp(a.o, b.o, p), blur: lerp(a.blur || 0, b.blur || 0, p),
  };
}

function renderS4(t) {
  setActive('s4');
  const local = t - 10.0; // 0 .. 7.0
  const pulse = beatPulse(t);
  const float1 = Math.sin(local * 2.2) * 10;
  const float2 = Math.cos(local * 1.9 + 1.1) * 11;
  const float3 = Math.sin(local * 2.1 + 2.2) * 9;
  const float4 = Math.cos(local * 2.4 + 0.5) * 10;

  // Ambient glow breathes with 120 BPM
  $('s4-glow').style.transform = `scale(${(1 + pulse * 0.08).toFixed(4)})`;
  $('s4-cap').style.opacity = easeOutCubic(norm(local, 0.05, 0.45)).toFixed(3);

  // Animate Fear 88 ring meter during Card 1 entrance
  const ringP = easeOutCubic(norm(local, 0.15, 1.05));
  const scoreVal = Math.round(ringP * 88);
  $('c-ring-num').textContent = String(scoreVal);
  $('c-ring-f').style.strokeDashoffset = (144.5 * (1 - (scoreVal / 100))).toFixed(2);

  // Animate Mind Facts 40% count-up during Card 3 entrance
  const mfP = easeOutCubic(norm(local, 3.45, 4.35));
  $('mf-pct').textContent = String(Math.round(mfP * 40));

  // Keyframed 3D choreography across 4 phases:
  // Phase 0 (0.00–1.75): Card 1 (Ingredients Fear 88) hero center
  // Phase 1 (1.75–3.50): Card 2 (Debaited Rewrite) snaps center, Card 1 fans left
  // Phase 2 (3.50–5.25): Card 3 (Mind Facts 40% Bait) sweeps center, Cards 1-2 fan left/right back
  // Phase 3 (5.25–7.00): Card 4 (Gemini Nano) enters foreground, all 4 fan in an iconic 3D spread
  const p0 = spring(norm(local, 0.0, 0.62), 8.6, 7.2);
  const p1 = easeInOutCubic(norm(local, 1.65, 2.25));
  const p2 = easeInOutCubic(norm(local, 3.40, 4.00));
  const p3 = easeInOutCubic(norm(local, 5.10, 5.75));
  const outro = norm(local, 6.72, 7.00);

  // Card 1: Ingredients Fear 88
  let c1 = interpPose(
    { x: 0, y: 260, z: -260, rx: 18, ry: -18, rz: -6, s: 0.78, o: 0, blur: 10 },
    { x: 0, y: 12 + float1, z: 60, rx: 4, ry: -6, rz: -1.5, s: 1.18, o: 1, blur: 0 },
    p0,
  );
  c1 = interpPose(c1, { x: -470, y: 26 + float1, z: -140, rx: 5, ry: 22, rz: -6, s: 0.88, o: 0.86, blur: 1.2 }, p1);
  c1 = interpPose(c1, { x: -610, y: 48 + float1, z: -260, rx: 4, ry: 28, rz: -9, s: 0.78, o: 0.72, blur: 2.0 }, p2);
  c1 = interpPose(c1, { x: -690, y: 36 + float1, z: -180, rx: 3, ry: 22, rz: -6, s: 0.72, o: 0.90, blur: 0.4 }, p3);

  // Card 2: Debaited Clean Rewrite
  let c2 = interpPose(
    { x: 460, y: 220, z: -280, rx: 14, ry: -28, rz: 8, s: 0.72, o: 0, blur: 10 },
    { x: 110, y: 8 + float2, z: 75, rx: 3, ry: -5, rz: 1.2, s: 1.14, o: 1, blur: 0 },
    spring(norm(local, 1.65, 2.28), 8.8, 7.4),
  );
  c2 = interpPose(c2, { x: 540, y: 34 + float2, z: -180, rx: 5, ry: -24, rz: 7, s: 0.84, o: 0.82, blur: 1.4 }, p2);
  c2 = interpPose(c2, { x: -245, y: 54 + float2, z: -90, rx: 2, ry: 10, rz: -2.2, s: 0.76, o: 0.94, blur: 0.1 }, p3);

  // Card 3: Weekly Mind Facts (40% Bait)
  let c3 = interpPose(
    { x: -320, y: 290, z: -320, rx: 16, ry: 20, rz: -8, s: 0.72, o: 0, blur: 10 },
    { x: 0, y: 12 + float3, z: 95, rx: 3, ry: 4, rz: -0.8, s: 1.14, o: 1, blur: 0 },
    spring(norm(local, 3.40, 4.02), 8.8, 7.4),
  );
  c3 = interpPose(c3, { x: 205, y: -14 + float3, z: -30, rx: 2, ry: -8, rz: 1.8, s: 0.79, o: 0.98, blur: 0 }, p3);

  // Card 4: Chrome On-Device Badge (Gemini Nano) — hero foreground right in the final 4-card fan
  const c4 = interpPose(
    { x: 560, y: 260, z: -180, rx: 16, ry: -26, rz: 8, s: 0.76, o: 0, blur: 10 },
    { x: 645, y: 32 + float4, z: 65, rx: 3, ry: -18, rz: 4.5, s: 0.84, o: 1, blur: 0 },
    spring(norm(local, 5.10, 5.78), 9.0, 7.5),
  );

  // Subtle push into the white flash at 17.0s
  const cards = [
    [$('c-ing'), c1],
    [$('c-rewrite'), c2],
    [$('c-facts'), c3],
    [$('c-nano'), c4],
  ];
  for (const [el, pose] of cards) {
    pose.z += outro * 240;
    pose.blur = (pose.blur || 0) + outro * 7;
    placeCard(el, pose);
  }
}

// ==================== SCENE 5 (0:17 – 0:21): WHITE FLASH + RAPID WORD-BY-WORD SLAM ====================
function renderS5(t) {
  setActive('s5');
  const local = t - 17.0; // 0 .. 4.0

  // Group 0 (0.00–1.40): "Read" -> "the" -> "news."
  // Group 1 (1.40–2.60): "Not" -> "the"
  // Group 2 (2.60–4.00): "bait." (blazing accent slam + shockwave ring)
  const g0 = $('s5-g0');
  const g1 = $('s5-g1');
  const g2 = $('s5-g2');

  const show0 = local < 1.40;
  const show1 = local >= 1.40 && local < 2.60;
  const show2 = local >= 2.60;

  g0.style.opacity = show0 ? '1' : '0';
  g1.style.opacity = show1 ? '1' : '0';
  g2.style.opacity = show2 ? '1' : '0';

  if (show0) {
    const items = [
      ['s5-r0', 0.04], ['s5-r1', 0.42], ['s5-r2', 0.80],
    ];
    for (const [id, st] of items) {
      const p = norm(local, st, st + 0.30);
      const s = spring(p, 11.5, 8.2);
      const blur = (1 - easeOutExpo(p)) * 12;
      const el = $(id);
      el.style.opacity = clamp(p * 5).toFixed(3);
      el.style.transform = `translate3d(0, ${((1 - s) * 90).toFixed(1)}px, 0) scale(${lerp(1.24, 1, s).toFixed(4)})`;
      el.style.filter = blur > 0.25 ? `blur(${blur.toFixed(2)}px)` : 'none';
    }
    const gExit = norm(local, 1.26, 1.40);
    g0.style.transform = `scale(${lerp(1, 0.9, gExit).toFixed(4)})`;
  }

  if (show1) {
    const gl = local - 1.40;
    const items = [['s5-n0', 0.02], ['s5-n1', 0.48]];
    for (const [id, st] of items) {
      const p = norm(gl, st, st + 0.28);
      const s = spring(p, 11.5, 8.2);
      const blur = (1 - easeOutExpo(p)) * 12;
      const el = $(id);
      el.style.opacity = clamp(p * 5).toFixed(3);
      el.style.transform = `translate3d(${((1 - s) * -70).toFixed(1)}px, 0, 0) scale(${lerp(1.28, 1, s).toFixed(4)})`;
      el.style.filter = blur > 0.25 ? `blur(${blur.toFixed(2)}px)` : 'none';
    }
    const gExit = norm(gl, 1.08, 1.20);
    g1.style.transform = `scale(${lerp(1, 1.12, gExit).toFixed(4)})`;
  }

  const shock = $('s5-shock');
  if (show2) {
    const gl = local - 2.60; // 0 .. 1.40
    const p = norm(gl, 0, 0.34);
    const s = spring(p, 10.5, 7.0);
    const blur = (1 - easeOutExpo(p)) * 14;
    const zoom = lerp(1.55, 1.0, s) + easeInOutCubic(norm(gl, 0.5, 1.4)) * 0.12;
    const b0 = $('s5-b0');
    b0.style.opacity = clamp(p * 6).toFixed(3);
    b0.style.transform = `scale(${zoom.toFixed(4)})`;
    b0.style.filter = blur > 0.25 ? `blur(${blur.toFixed(2)}px)` : 'none';

    // Expanding shockwave ring behind "bait."
    const sp = easeOutCubic(norm(gl, 0, 0.95));
    shock.style.opacity = ((1 - sp) * 0.85).toFixed(3);
    shock.style.transform = `scale(${lerp(0.6, 5.2, sp).toFixed(3)})`;
  } else {
    shock.style.opacity = '0';
  }
}

// ==================== SCENE 6 (0:21 – 0:24): BLACK + GLOWING DEBAIT ORB + END LOCKUP ====================
function renderS6(t) {
  setActive('s6');
  const local = t - 21.0; // 0 .. 3.0
  const pulse = beatPulse(t);

  // Drive real Debait WebGL liquid-smoke glass orb
  const orbP = spring(norm(local, 0, 0.65), 8.2, 7.0);
  const orbScale = lerp(0.55, 1.0, orbP) + pulse * 0.022;
  $('s6-orb-shell').style.opacity = clamp(orbP * 3).toFixed(3);
  $('s6-orb-shell').style.transform = `scale(${orbScale.toFixed(4)})`;

  if (orbGL) {
    const shock = clamp(local / 1.1);
    orbGL.drawFrame({
      t: 14.0 + local * 1.15,
      turb: lerp(0.85, 0.22, easeOutCubic(norm(local, 0, 1.6))),
      bright: lerp(0.28, 0.92, easeOutCubic(norm(local, 0, 1.5))),
      pulse: local < 1.1 ? shock : 0,
      lx: Math.sin(local * 1.2) * 0.35,
      ly: 0.25 + Math.cos(local * 0.9) * 0.15,
      vx: 0,
      vy: 0,
    });
  }

  // Halo + ring pulse
  $('s6-halo').style.opacity = (0.65 + 0.35 * easeOutCubic(norm(local, 0, 0.7)) + pulse * 0.15).toFixed(3);
  const ringP = easeOutCubic(norm(local, 0.05, 1.3));
  $('s6-ring').style.opacity = ((1 - ringP * 0.62) * clamp(local * 6)).toFixed(3);
  $('s6-ring').style.transform = `scale(${lerp(0.75, 1.08, ringP).toFixed(4)})`;

  // "Debait." wordmark
  const bp = norm(local, 0.32, 0.82);
  const bs = spring(bp, 9.2, 7.6);
  const bBlur = (1 - easeOutExpo(bp)) * 10;
  const brand = $('s6-brand');
  brand.style.opacity = clamp(bp * 4).toFixed(3);
  brand.style.transform = `translate3d(0, ${((1 - bs) * 56).toFixed(1)}px, 0) scale(${lerp(0.9, 1, bs).toFixed(4)})`;
  brand.style.filter = bBlur > 0.25 ? `blur(${bBlur.toFixed(2)}px)` : 'none';

  // "On-device. · Private. · Free." sequential beat snaps
  const triad = [
    ['s6-t0', 0.92], ['s6-p0', 1.14], ['s6-t1', 1.26], ['s6-p1', 1.48], ['s6-t2', 1.60],
  ];
  for (const [id, st] of triad) {
    const tp = norm(local, st, st + 0.34);
    const ts = spring(tp, 10.0, 8.0);
    const el = $(id);
    el.style.opacity = clamp(tp * 4).toFixed(3);
    el.style.transform = `translate3d(0, ${((1 - ts) * 28).toFixed(1)}px, 0)`;
  }

  $('s6-sub').style.opacity = (easeOutCubic(norm(local, 1.85, 2.35)) * 0.65).toFixed(3);
}

// ==================== MASTER FRAME RENDERER ====================
export function render(t) {
  const time = clamp(t, 0, DURATION);
  if (time < 3.0) renderS1(time);
  else if (time < 8.0) renderS2(time);
  else if (time < 10.0) renderS3(time);
  else if (time < 17.0) renderS4(time);
  else if (time < 21.0) renderS5(time);
  else renderS6(time);
  setFlash(time);
}

window.AD = { duration: DURATION, fps: FPS, render };

// Wait for bundled fonts before signaling adReady to CDP renderer.
Promise.resolve(document.fonts?.ready).finally(() => {
  render(0);
  window.adReady = true;
});

// Live browser preview when opened without ?render
if (!location.search.includes('render')) {
  const start = performance.now();
  const loop = (now) => {
    render(((now - start) / 1000) % DURATION);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
