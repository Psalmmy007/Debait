// The orb's surface: a tiny WebGL shader that draws a glass sphere with living smoke inside.
// Everything is black and white. The smoke is ray-marched through the ball, so it has real depth
// and parallax as it turns. Returns null if WebGL isn't available (the CSS fallback shows instead).

/** How the orb feels in each state. speed = how fast it moves, turb = how wild, bright = dark storm → calm pearl. */
export const MOODS = {
  idle: { speed: 0.34, turb: 0.3, bright: 0.3 },
  busy: { speed: 1.5, turb: 0.6, bright: 0.22 },
  bait: { speed: 0.62, turb: 1.0, bright: 0.04 },
  calm: { speed: 0.24, turb: 0.1, bright: 1.0 },
};

const VERT = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }';

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uT;       // flowing time
uniform float uTurb;    // 0 calm .. 1 storm
uniform float uBright;  // 0 dark .. 1 bright
uniform float uPulse;   // 0..1 click shockwave travelling out from the centre
uniform vec2 uLight;    // where the light comes from (follows the cursor)
uniform vec2 uVel;      // drag velocity: the smoke lags behind

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s / 0.875;
}
float fbm4(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s / 0.9375;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// how much smoke there is at a point inside the ball
float density(vec3 p) {
  float t = uT;
  p.xy += uVel * 0.45;
  p.xz *= rot(t * 0.19);
  p.xy *= rot(t * 0.11 + 0.7);
  // bend the space so the smoke curls instead of just drifting
  vec3 w = vec3(
    fbm3(p * 0.85 + vec3(0.0, t * 0.31, 0.0)),
    fbm3(p * 0.85 + vec3(4.1, -t * 0.27, 1.7)),
    fbm3(p * 0.85 + vec3(-2.3, 7.7, t * 0.23)));
  p += (w - 0.5) * (1.4 + 2.2 * uTurb);
  float f = fbm4(p * 1.15 + vec3(0.0, 0.0, t * 0.12));
  f = clamp((f - 0.5) * 3.2 + 0.5, 0.0, 1.0);   // stretch the noise to use the full range
  // big bold shapes read well even when the orb is small
  float lo = mix(0.84, 0.36, uBright);
  float cloud = smoothstep(lo, lo + 0.32, f);
  return cloud * cloud * 1.6;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / min(uRes.x, uRes.y);
  uv *= 1.03;
  float r = length(uv);
  float px = 2.0 / min(uRes.x, uRes.y);
  float mask = 1.0 - smoothstep(1.0 - px * 1.6, 1.0, r);
  if (mask <= 0.0) { gl_FragColor = vec4(0.0); return; }

  float z = sqrt(max(1.0 - r * r, 0.0));
  vec3 n = vec3(uv, z);
  vec3 l = normalize(vec3(-0.46 + uLight.x * 0.6, 0.6 + uLight.y * 0.6, 0.66));

  // march through the ball, front to back
  const int STEPS = 12;
  float stepLen = 2.0 * z / float(STEPS);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float T = 1.0;   // how much we can still see through
  float L = 0.0;   // light gathered from the smoke
  for (int i = 0; i < STEPS; i++) {
    vec3 p = vec3(uv, z - (float(i) + 0.42 + jitter * 0.16) * stepLen);
    float d = density(p * 0.92);
    // click shockwave: a shell of light expanding from the centre
    d += exp(-pow((length(p) - uPulse * 1.25) * 6.5, 2.0)) * (1.0 - uPulse) * step(0.001, uPulse) * 2.2;
    float a = 1.0 - exp(-d * stepLen * mix(2.6, 1.5, uBright));
    float lit = 0.62 + 0.38 * dot(normalize(p + vec3(0.0, 0.0, 0.35)), l);
    L += T * a * lit;
    T *= 1.0 - a;
  }

  // dark glass when stormy, milky pearl when calm
  float base = mix(0.012, 0.6, uBright);
  float smoke = mix(1.0, 0.97, uBright);
  float c = base * T + L * smoke;
  c = mix(c, 1.0 - (1.0 - c) * (1.0 - c), uBright * 0.35);
  // thicker glass toward the edge
  c *= mix(0.5, 1.0, smoothstep(0.0, 0.8, z));

  // the glass shell
  vec3 h = normalize(l + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(n, h), 0.0);
  float fres = pow(1.0 - z, 3.2);
  float rim = fres * mix(0.5, 0.3, uBright);
  float glint = pow(nh, 140.0) * 0.95;
  float sheen = pow(nh, 10.0) * 0.16;
  // light collecting on the far inner edge, like a real glass ball
  float exitLight = pow(max(dot(normalize(uv + 0.0001), -normalize(l.xy)), 0.0), 2.5) * smoothstep(0.5, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r)) * 0.3;

  float col = c + rim + glint + sheen + exitLight;
  col += (jitter - 0.5) / 128.0;   // dither away banding
  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(vec3(col) * mask, mask);
}`;

export function createOrbRenderer(canvas, size = 56, { dpr: forcedDpr, preserve = false } = {}) {
  let gl = null;
  try {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: preserve });
  } catch { /* no WebGL */ }
  if (!gl) return null;

  const dpr = forcedDpr || Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(size * dpr);

  let u = null;
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[Debait] orb shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  function init() {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    u = {};
    for (const name of ['uRes', 'uT', 'uTurb', 'uBright', 'uPulse', 'uLight', 'uVel']) u[name] = gl.getUniformLocation(prog, name);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    return true;
  }
  if (!init()) return null;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cur = { ...MOODS.idle, lx: 0, ly: 0, vx: 0, vy: 0 };
  const tgt = { ...cur };
  let phase = Math.random() * 60;
  let pulse = 0;
  let pulsing = false;
  let boost = 1;
  let raf = 0;
  let lastDraw = 0;
  let lost = false;

  function draw(now) {
    const dt = Math.min(0.05, (now - (lastDraw || now)) / 1000);
    lastDraw = now;
    const slow = 1 - Math.exp(-dt * 2.4);
    const fast = 1 - Math.exp(-dt * 9);
    cur.speed += (tgt.speed - cur.speed) * slow;
    cur.turb += (tgt.turb - cur.turb) * slow;
    cur.bright += (tgt.bright - cur.bright) * slow;
    cur.lx += (tgt.lx - cur.lx) * fast;
    cur.ly += (tgt.ly - cur.ly) * fast;
    cur.vx += (tgt.vx - cur.vx) * fast;
    cur.vy += (tgt.vy - cur.vy) * fast;
    phase += dt * cur.speed * boost * (reduced ? 0.15 : 1);
    if (pulsing) {
      pulse += dt / 0.95;
      if (pulse >= 1) { pulse = 0; pulsing = false; }
    }
    gl.uniform1f(u.uT, phase);
    gl.uniform1f(u.uTurb, cur.turb);
    gl.uniform1f(u.uBright, cur.bright);
    gl.uniform1f(u.uPulse, pulse);
    gl.uniform2f(u.uLight, cur.lx, cur.ly);
    gl.uniform2f(u.uVel, cur.vx, cur.vy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (lost) return;
    // full speed while something is happening, ~30fps when just idling (kinder to the battery)
    const lively = pulsing || boost > 1 || tgt.speed > 1 || Math.abs(cur.bright - tgt.bright) > 0.01 || Math.abs(cur.vx) + Math.abs(cur.vy) > 0.01;
    if (!lively && now - lastDraw < 30) return;
    draw(now);
  }

  // Chrome allows only about 16 WebGL contexts per process.
  // release() frees ours on teardown; resume() only restores when we lost it and Chrome allowed restoration.
  const loser = gl.getExtension('WEBGL_lose_context');
  let lostByUs = false;
  let canRestore = false;
  let onLostChange = null;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    if (lostByUs) canRestore = true;
    else onLostChange?.(true); // Chrome took it: show the CSS orb meanwhile
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = !init();
    lostByUs = false;
    canRestore = false;
    onLostChange?.(lost);
  });

  return {
    start() { if (!raf) raf = requestAnimationFrame(frame); },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    release() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (lost || lostByUs || !loser || gl.isContextLost()) return;
      lostByUs = true;
      canRestore = false;
      try { loser.loseContext(); } catch { lostByUs = false; }
    },
    resume() {
      if (!lostByUs || !canRestore || !loser || !gl.isContextLost()) return;
      canRestore = false;
      try { loser.restoreContext(); } catch { lostByUs = false; }
    },
    /** cb(lost) when the context is taken away by Chrome or comes back */
    onLostChange(cb) { onLostChange = cb; },
    /** Draws a single frame right now (used by the demo lab and for reduced motion). */
    drawOnce() { if (!lost) draw(performance.now()); },
    setMood(name) { Object.assign(tgt, MOODS[name] || MOODS.idle); },
    setBoost(b) { boost = b; },
    setLight(x, y) { tgt.lx = x; tgt.ly = y; },
    setVelocity(x, y) { tgt.vx = x; tgt.vy = y; },
    pulse() { pulse = 0.0001; pulsing = true; },
    /** Draws one frame from explicit values, with no smoothing (used to render the video ad). */
    drawFrame({ t, turb, bright, pulse: p = 0, lx = 0, ly = 0, vx = 0, vy = 0 }) {
      if (lost) return;
      gl.uniform1f(u.uT, t);
      gl.uniform1f(u.uTurb, turb);
      gl.uniform1f(u.uBright, bright);
      gl.uniform1f(u.uPulse, p);
      gl.uniform2f(u.uLight, lx, ly);
      gl.uniform2f(u.uVel, vx, vy);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
