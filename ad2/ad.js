// The Debait ad. Every frame is a pure function of time: render(t) puts the whole stage into the
// state it has at t seconds. The renderer (render.mjs) steps through t frame by frame.
// Open ad/index.html?play to watch it in real time, or ?t=12.5 to freeze on one moment.
import { schedule, wordAt, estimateTiming, SIZE } from './timeline.js';
import { createOrbRenderer } from '../src/content/ui/orb-gl.js';
import { ICON } from '../src/content/ui/icons.js';

// ---------- small helpers ----------
const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const prog = (t, a, dur) => clamp((t - a) / dur);
const outExpo = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));
const outCubic = (p) => 1 - Math.pow(1 - p, 3);
const inOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
// a spring that overshoots a little then settles
const spring = (p) => (p >= 1 ? 1 : 1 - Math.exp(-6.5 * p) * Math.cos(9.5 * p));
/** visible between a and b, with fade in/out (returns 0..1) */
const win = (t, a, b, fi = 0.5, fo = 0.5) => Math.min(prog(t, a, fi), 1 - prog(t, b - fo, fo));

function S(el, { o, x = 0, y = 0, s = 1, blur = 0, rx = 0, color } = {}) {
  if (o !== undefined) el.style.opacity = o.toFixed(4);
  el.style.transform = `${rx ? `perspective(1600px) rotateX(${rx.toFixed(3)}deg) ` : ''}translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(4)})`;
  el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
  if (color) el.style.color = color;
}
/** "enter" motion: rises out of a blur */
function enter(el, t, at, dur = 0.55, { dy = 26, blur = 12, s0 = 1 } = {}) {
  const p = outExpo(prog(t, at, dur));
  S(el, { o: p, y: (1 - p) * dy, blur: (1 - p) * blur, s: lerp(s0, 1, p) });
  return p;
}

// deterministic "random" so every render of a frame is identical
const hash = (a, b) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35);
  h ^= h >>> 15;
  return ((h >>> 0) % 10000) / 10000;
};
const GLYPHS = '░▒▓/\\|=+-_*#<>';
function scramble(from, to, p, seed, t) {
  const len = Math.max(from.length, to.length);
  const frame = Math.floor(t * 30);
  let out = '';
  for (let i = 0; i < len; i++) {
    const at = Math.min(0.97, (i / len) * 0.72 + hash(seed, i) * 0.22);
    if (p >= at) out += to[i] ?? '';
    else if (p >= at - 0.3) out += to[i] === ' ' || from[i] === ' ' ? ' ' : GLYPHS[Math.floor(hash(i + seed * 97, frame) * GLYPHS.length)];
    else out += from[i] ?? '';
  }
  return out;
}

// ---------- content ----------
const POSTS_UNUSED = [
  { who: 'Politics Now', at: '@politicsnow · 2h', av: 'linear-gradient(135deg,#ffb199,#ff0844)', kind: 'rage', score: 91,
    text: "Senator DESTROYS reporter in brutal 30-second clip — you won't believe how it ends",
    bait: ['DESTROYS', 'brutal', "you won't believe"],
    rewrite: "Senator disagrees with a reporter's question in a 30-second exchange" },
  { who: 'Wellness Daily', at: '@wellnessdaily · 4h', av: 'linear-gradient(135deg,#f6d365,#fda085)', kind: 'fear', score: 86,
    text: 'This common breakfast food is silently killing you',
    bait: ['common', 'silently killing you'],
    rewrite: 'Study links very high intake of processed cereals to modest health risks' },
  { who: 'Hustle Hub', at: '@hustlehub · 5h', av: 'linear-gradient(135deg,#d4fc79,#96e6a1)', kind: 'envy', score: 78,
    text: "22-year-old retires as a millionaire while you're still stuck at your 9-to-5",
    bait: ['millionaire', "while you're still stuck"],
    rewrite: '22-year-old says they saved aggressively and invested early' },
  { who: 'Metro Desk', at: '@metrodesk · 3h', av: 'linear-gradient(135deg,#a1c4fd,#c2e9fb)', kind: 'clean', score: 6,
    text: 'City council approves new bike lanes on Main Street', bait: [], rewrite: null },
];
// a made-up news site (BBC-style layout, fictional name)
const POSTS = [
  { section: 'Business', kind: 'fear', score: 88, lead: true,
    text: 'Economy on the brink of TOTAL COLLAPSE as experts PANIC',
    bait: ['brink', 'TOTAL COLLAPSE', 'PANIC'],
    rewrite: 'Economists warn of slower growth as markets dip' },
  { section: 'Politics', kind: 'rage', score: 90,
    text: 'Minister DESTROYS rival in brutal late-night debate',
    bait: ['DESTROYS', 'brutal'],
    rewrite: 'Minister challenges rival in late-night debate' },
  { section: 'Climate', kind: 'fear', score: 84,
    text: 'Deadly heatwave could hit YOUR city next, scientists warn',
    bait: ['Deadly', 'YOUR city next'],
    rewrite: 'Heatwave expected to spread to more cities, scientists say' },
  { section: 'Money', kind: 'envy', score: 79,
    text: "Billionaires don't want you to know this one simple trick",
    bait: ["don't want you to know", 'one simple trick'],
    rewrite: 'An investing habit that wealthy people often use' },
  { section: 'Local', kind: 'clean', score: 4,
    text: 'Council opens a new public library on the high street', bait: [], rewrite: null },
];
const TICKER = 'BREAKING · Markets in FREEFALL · You won\'t BELIEVE what happened next · SHOCKING new study · Experts are TERRIFIED · ';
const LABEL = { rage: 'Rage', fear: 'Fear', envy: 'Envy', clean: 'Clean' };
const WALL = [
  'Senator <b>DESTROYS</b> reporter in brutal clip', 'This common food is <b>silently killing you</b>',
  'Economy on the <b>brink of TOTAL COLLAPSE</b>', '<b>You won\'t believe</b> what she said next',
  '22-year-old retires a <b>millionaire</b> while you work', 'Fans <b>furious</b> as star <b>SLAMS</b> coach',
  '<b>Deadly</b> virus could be in your home <b>RIGHT NOW</b>', 'Billionaires <b>don\'t want you to know</b> this',
  'The radical left\'s <b>WAR</b> on your car', 'Doctors are <b>TERRIFIED</b> of this diet',
  'Your neighbours are getting <b>richer than you</b>', '<b>Shocking</b> footage leaves viewers <b>outraged</b>',
];
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function markBait(text, bait, tag = 'span class="bw"') {
  let html = esc(text);
  for (const w of [...bait].sort((a, b) => b.length - a.length)) {
    html = html.replace(esc(w), (m) => `<${tag}>${m}</${tag.split(' ')[0]}>`);
  }
  return html;
}

// ---------- geometry (stage pixels) ----------
const BROWSER = { x: 320, y: 170, w: 1280, h: 780 };
const VIEW = { x: BROWSER.x, y: BROWSER.y + 54, w: BROWSER.w, h: BROWSER.h - 54 };
const CAM_ORIGIN = { x: BROWSER.x + BROWSER.w / 2, y: BROWSER.y + BROWSER.h * 0.6 };
const ORB_PX = 560; // canvas buffer size
const CORNER = { x: VIEW.x + VIEW.w - 64, y: VIEW.y + VIEW.h - 64, size: 76 }; // orb inside the browser
const RING_C = { x: CORNER.x - VIEW.x, y: CORNER.y - VIEW.y };

// ---------- build the static DOM once ----------
function build() {
  $('A-line').innerHTML = 'You are what you read.'.split(' ').map((w) => `<span>${w} </span>`).join('');
  $('B-wall').innerHTML = [...WALL, ...WALL, ...WALL].map((h) => `<p>${h}</p>`).join('');

  const item = (p, i) => `
    <article class="news ${p.lead ? 'lead' : ''}" id="post${i}">
      ${p.lead ? '<div class="photo"></div>' : ''}
      <div class="sec">${p.section}</div>
      <p class="txt" id="txt${i}">${markBait(p.text, p.bait)}</p>
      <div class="tagrow"><span class="tag ${p.kind === 'clean' ? 'clean' : ''}" id="tag${i}">${tagInner(p, false)}</span></div>
    </article>`;
  $('E-page').innerHTML = `
    <div class="site-head"><span class="logo-box">WORLD</span><span class="logo-box">REPORT</span><nav>Home · News · Business · Climate · Money</nav></div>
    <div class="ticker"><b>LIVE</b><span id="tick">${TICKER.repeat(4)}</span></div>
    <div class="news-grid"><div>${item(POSTS[0], 0)}</div><div class="side">${POSTS.slice(1).map((p, i) => item(p, i + 1)).join('')}</div></div>`;

  const p0 = POSTS[0];
  const C = 2 * Math.PI * 42;
  $('E-card').innerHTML = `
    <div class="head"><div><div class="kick">INGREDIENTS</div><div style="margin-top:12px"><span class="tag" style="opacity:1">${tagInner({ ...p0, score: null }, false)}</span></div></div>
      <div class="gauge"><svg viewBox="0 0 96 96"><circle cx="48" cy="48" r="42" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="5"/><circle id="gfill" cx="48" cy="48" r="42" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><b id="gnum">0</b></div></div>
    <p class="hl">${markBait(p0.text, p0.bait, 'mark')}</p>
    <h4>WHY IT PULLS YOU IN</h4>
    <div class="row" id="row0"><i>01</i><b>brink</b><span>catastrophe framing</span></div>
    <div class="row" id="row1"><i>02</i><b>TOTAL COLLAPSE</b><span>doom exaggeration</span></div>
    <div class="row" id="row2"><i>03</i><b>PANIC</b><span>contagious fear</span></div>
    <h4>WHAT ACTUALLY HAPPENED</h4>
    <div class="slip" id="slip">${esc(p0.rewrite)}</div>`;

  const kinds = [['Rage', 19, '#09090b'], ['Fear', 13, '#52525b'], ['Envy', 8, '#a1a1aa'], ['Clean', 60, 'repeating-linear-gradient(-45deg,#09090b 0 2px,transparent 2px 5px)']];
  const days = [['Sun', 46], ['Mon', 41], ['Tue', 52], ['Wed', 33], ['Thu', 24], ['Fri', 38], ['Sat', 44]];
  $('H-label').innerHTML = `
    <h3>Mind Facts</h3><p class="per">Weekly · Nov 8 – Nov 14</p><div class="rule t"></div>
    <div class="r big"><span>Headlines read</span><b>1,596</b></div><div class="rule m"></div>
    <div class="r h"><span>Bait</span><b>40%</b></div><div class="rule"></div>
    ${kinds.map(([k, v, bg], i) => `<div class="r k"><span><i style="background:${bg}"></i>${k}</span><span class="m"><s id="kbar${i}" style="background:${bg}" data-w="${v}"></s></span><b>${v}%</b></div>`).join('')}
    <div class="rule m"></div><h5>Bait by day</h5>
    <div class="days">${days.map(([d, v]) => `<div class="d ${d === 'Thu' ? 'calm' : ''}"><s data-h="${v}"></s><small>${d}</small></div>`).join('')}</div>
    <div class="rule t"></div>`;
}
function tagInner(p, done) {
  if (done) return `${ICON.check}<span>Debaited</span>`;
  return `${ICON[p.kind]}<span>${LABEL[p.kind]}</span>${p.kind !== 'clean' && p.score != null ? `<span class="sc">${p.score}</span>` : ''}`;
}

// ---------- the timeline ----------
let T = null; // scene times, computed from the voice timing
let orbGl = null;
let geo = null; // measured post positions

function times(sched) {
  const L = sched.lines;
  const W = (id, n, e) => wordAt(L, id, n, e);
  const tr = L.clicks.end + 0.6;
  const tx0 = L.reads.start - 1.0;
  const tClick = W('click', 'click') + 0.05;
  const g0 = L.device.start - 1.1;
  return {
    L, W, duration: sched.duration,
    A: [L.read.start - 0.4, L.feed.start - 0.15],
    B: [L.feed.start - 0.35, L.clicks.start - 0.2],
    C: [L.clicks.start - 0.3, L.clicks.end + 0.45],
    tr, tx0, tx1: tx0 + 1.3,
    e0: tx0 + 0.1,
    scan: W('reads', 'headlines') - 0.2,
    card: [W('reads', 'exactly') - 0.15, L.click.start - 0.2],
    tClick,
    g0, g1: L.label.start - 0.5,
    h0: L.label.start - 0.35, h1: L.end.start - 0.55,
    i0: L.end.start - 0.45,
  };
}

function measure() {
  // post positions inside the viewport (before any transforms)
  geo = POSTS.map((p, i) => {
    const post = $(`post${i}`);
    const tag = $(`tag${i}`);
    const top = post.offsetTop;
    const tagY = tag.parentElement.offsetTop + 16;
    const cx = post.offsetLeft + post.offsetWidth / 2;
    const cy = top + post.offsetHeight / 2;
    return { tagY, cx, cy };
  });
}

// orb position/state at time t
function orbAt(t) {
  const k = T;
  const storm = { bright: 0.05, turb: 1.0 };
  const calm = { bright: 1.0, turb: 0.1 };
  const pc = inOut(prog(t, k.tClick + 0.1, 1.8));
  const mood = { bright: lerp(storm.bright, calm.bright, pc), turb: lerp(storm.turb, calm.turb, pc) };
  const cam = camScale(t);
  const corner = {
    x: CAM_ORIGIN.x + (CORNER.x - CAM_ORIGIN.x) * cam,
    y: CAM_ORIGIN.y + (CORNER.y - CAM_ORIGIN.y) * cam + browserRiseY(t),
    size: CORNER.size * cam,
  };
  const D = { x: 960, y: 420, size: 520 };
  const G = { x: 960, y: 380, size: 460 };
  const I = { x: 960, y: 300, size: 230 };
  let pos = D;
  let o = 0;
  let blur = 0;
  if (t < k.tx0) {
    const p = outCubic(prog(t, k.tr, 1.7));
    o = p;
    blur = (1 - p) * 18;
    pos = { ...D, size: D.size * lerp(0.78, 1, p) };
  } else if (t < k.tx1) {
    const p = inOut(prog(t, k.tx0, k.tx1 - k.tx0));
    o = 1;
    pos = { x: lerp(D.x, corner.x, p), y: lerp(D.y, corner.y, p), size: lerp(D.size, corner.size, p) };
  } else if (t < k.g0 + 0.15) {
    o = 1;
    pos = corner;
  } else if (t < k.g1) {
    const p = inOut(prog(t, k.g0 + 0.15, 1.15));
    o = 1;
    pos = { x: lerp(corner.x, G.x, p), y: lerp(corner.y, G.y, p), size: lerp(corner.size, G.size, p) };
  } else if (t < k.i0) {
    const p = outCubic(prog(t, k.g1, 0.5));
    o = 1 - p;
    pos = { ...G, size: G.size * lerp(1, 0.9, p) };
  } else {
    const p = outCubic(prog(t, k.i0, 1.1));
    o = p;
    blur = (1 - p) * 12;
    pos = { ...I, size: I.size * lerp(0.85, 1, p) };
  }
  // the click: a quick squeeze
  const sq = t > k.tClick && t < k.tClick + 0.6 ? Math.sin(prog(t, k.tClick, 0.6) * Math.PI) * 0.12 : 0;
  pos = { ...pos, size: pos.size * (1 - sq) };
  const pulse = t > k.tClick && t < k.tClick + 0.95 ? (t - k.tClick) / 0.95 : 0;
  // smoke speed: restless before the click, slow and calm after
  const tc = k.tClick;
  const phase = 7 + 0.7 * Math.min(t, tc) + 0.26 * Math.max(0, t - tc);
  return { ...pos, o, blur, ...mood, pulse, phase, lx: 0.35 * Math.sin(t * 0.4), ly: 0.25 * Math.cos(t * 0.33) };
}

function camScale(t) { return 1 + 0.035 * outCubic(prog(t, T.e0, T.g0 - T.e0)); }
function browserRiseY(t) { return (1 - outExpo(prog(t, T.e0, 1.3))) * 150; }

// ---------- render one moment ----------
let lastTxt = [];
function render(t) {
  const k = T;
  const { L, W } = k;

  // A — You are what you read.
  const a = win(t, k.A[0], k.A[1], 0.3, 0.45);
  $('A').style.opacity = a;
  [...$('A-line').children].forEach((span, i) => {
    const w = L.read.words[i];
    const at = w ? L.read.start + w.t0 - 0.06 : L.read.start + i * 0.3;
    enter(span, t, at, 0.6, { dy: 22, blur: 12 });
  });
  S($('A-line'), { s: lerp(1, 1.03, prog(t, k.A[1] - 0.45, 0.45)) });

  // B — angry / afraid / envious
  $('B').style.opacity = win(t, k.B[0], k.B[1], 0.4, 0.3);
  S($('B-wall'), { y: 160 - (t - k.B[0]) * 85, o: 0.9 });
  enter($('B-lede'), t, W('feed', 'feed') - 0.1, 0.6, { dy: 14, blur: 8 });
  const wt = [W('feed', 'angry'), W('feed', 'afraid'), W('feed', 'envious'), k.B[1] + 1];
  for (let i = 0; i < 3; i++) {
    const el = $(`B-w${i}`);
    const pin = outExpo(prog(t, wt[i] - 0.04, 0.4));
    const pout = prog(t, wt[i + 1] - 0.05, 0.18);
    S(el, { o: pin * (1 - pout), s: lerp(0.9, 1, pin) * lerp(1, 1.06, pout), blur: (1 - pin) * 16 + pout * 10 });
  }

  // C — +2.3%
  $('C').style.opacity = win(t, k.C[0], k.C[1], 0.4, 0.45);
  const n0 = W('clicks', 'negative');
  const n1 = W('clicks', 'clicks', 't1');
  const v = 2.3 * outCubic(prog(t, n0, Math.max(0.6, n1 - n0)));
  $('C-num').textContent = `+${v.toFixed(1)}%`;
  enter($('C-num'), t, k.C[0], 0.8, { dy: 0, blur: 14, s0: 0.94 });
  enter($('C-sub'), t, n0 - 0.15, 0.6, { dy: 16, blur: 8 });
  enter($('C-src'), t, W('clicks', 'clicks') + 0.25, 0.6, { dy: 8, blur: 4 });

  // D — Meet Debait
  $('D').style.opacity = t < k.tx0 + 0.6 ? 1 : 0;
  const md = enter($('D-mark'), t, W('meet', 'debait') - 0.05, 0.7, { dy: 30, blur: 14 });
  if (t > k.tx0) $('D-mark').style.opacity = (md * (1 - prog(t, k.tx0, 0.45))).toFixed(3);

  // E/F — the product
  const eOn = t > k.e0 - 0.05 && t < k.g0 + 0.9;
  $('E').style.opacity = eOn ? 1 : 0;
  if (eOn) renderProduct(t);

  // G — on-device, private, free
  $('G').style.opacity = win(t, k.g0 + 0.6, k.g1 + 0.45, 0.3, 0.45);
  enter($('G-nano'), t, W('device', 'gemini') - 0.1, 0.6, { dy: 10, blur: 6 });
  const gt = [W('device', 'device'), W('device', 'private'), W('device', 'free'), 1e9];
  for (let i = 0; i < 3; i++) {
    const el = $(`G-w${i}`);
    const p = outExpo(prog(t, gt[i] - 0.04, 0.5));
    const dim = prog(t, gt[i + 1] - 0.05, 0.4);
    const c = Math.round(lerp(245, 134, dim));
    S(el, { o: p, y: (1 - p) * 22, blur: (1 - p) * 10, color: `rgb(${c},${c},${Math.round(lerp(247, 139, dim))})` });
  }

  // H — the label
  $('H').style.opacity = win(t, k.h0, k.h1 + 0.5, 0.25, 0.5);
  const pl = outExpo(prog(t, k.h0, 1.3));
  S($('H-label'), { o: pl, y: (1 - pl) * 140, rx: (1 - pl) * 24 });
  enter($('H-l0'), t, W('label', 'food') - 0.05, 0.6, { dy: 22, blur: 10 });
  enter($('H-l1'), t, W('label', 'now') - 0.05, 0.6, { dy: 22, blur: 10 });
  document.querySelectorAll('#H-label [data-w]').forEach((s, i) => {
    s.style.width = `${Number(s.dataset.w) * outCubic(prog(t, k.h0 + 0.55 + i * 0.07, 1.1))}%`;
  });
  document.querySelectorAll('#H-label [data-h]').forEach((s, i) => {
    s.style.height = `${Number(s.dataset.h) * 2 * outExpo(prog(t, k.h0 + 0.8 + i * 0.06, 1.0))}%`;
  });

  // I — end card
  $('I').style.opacity = t > k.i0 ? 1 : 0;
  enter($('I-mark'), t, W('end', 'debait') - 0.05, 0.8, { dy: 26, blur: 14 });
  enter($('I-tag'), t, W('end', 'read') - 0.05, 0.7, { dy: 16, blur: 8 });
  enter($('I-foot'), t, L.end.end + 0.3, 0.8, { dy: 8, blur: 4 });

  // the orb
  const o = orbAt(t);
  const canvas = $('orb');
  canvas.style.opacity = o.o.toFixed(4);
  canvas.style.transform = `translate(${(o.x - o.size / 2).toFixed(2)}px, ${(o.y - o.size / 2).toFixed(2)}px) scale(${(o.size / ORB_PX).toFixed(5)})`;
  canvas.style.filter = o.blur > 0.05 ? `blur(${(o.blur * ORB_PX / o.size).toFixed(2)}px)` : 'none';
  if (o.o > 0.001) orbGl?.drawFrame({ t: o.phase, turb: o.turb, bright: o.bright, pulse: o.pulse, lx: o.lx, ly: o.ly });

  // fade to black at the very end
  $('fade').style.opacity = prog(t, k.duration - 0.9, 0.9).toFixed(4);
}

function renderProduct(t) {
  const k = T;
  const { L, W } = k;
  // the browser rises in, then the camera slowly pushes in; it leaves before "on-device"
  const rise = outExpo(prog(t, k.e0, 1.3));
  const leave = outCubic(prog(t, k.g0, 0.7));
  S($('E-browser'), {
    o: rise * (1 - leave),
    y: browserRiseY(t) + leave * 50,
    rx: (1 - rise) * 14,
    s: camScale(t) * lerp(0.96, 1, rise) * lerp(1, 0.94, leave),
  });

  const tick = $('tick');
  if (tick) tick.style.transform = `translateX(${(-(t * 90) % 1400).toFixed(1)}px)`;

  // the scan line sweeps the page
  const sp = prog(t, k.scan, 1.5);
  const scan = $('E-scan');
  scan.style.top = `${lerp(-140, VIEW.h, sp)}px`;
  scan.style.opacity = (sp > 0 && sp < 1 ? Math.min(1, sp * 6, (1 - sp) * 6) : 0).toFixed(3);

  // ring: three thin rings roll out from the orb at the click
  const ring = $('E-ring');
  const R = Math.hypot(Math.max(RING_C.x, VIEW.w - RING_C.x), Math.max(RING_C.y, VIEW.h - RING_C.y)) + 40;
  const rp = prog(t, k.tClick, 1.35);
  if (rp > 0 && rp < 1) {
    const rings = [[0, 4, 1], [0.1, 2, 0.7], [0.22, 1.2, 0.45]];
    ring.style.opacity = 1;
    const r = outCubic(rp) * R;
    ring.style.width = ring.style.height = `${2 * r}px`;
    ring.style.left = `${RING_C.x - r}px`;
    ring.style.top = `${RING_C.y - r}px`;
    ring.style.background = rings.map(([lag, w, a]) => {
      const rr = Math.max(0, r - lag * R * 0.5);
      return `radial-gradient(circle closest-side, transparent ${Math.max(0, rr - w * 2).toFixed(1)}px, rgba(255,255,255,${a * (1 - rp)}) ${Math.max(0, rr - w).toFixed(1)}px, transparent ${rr.toFixed(1)}px)`;
    }).join(',');
    ring.style.backgroundSize = 'auto';
  } else {
    ring.style.opacity = 0;
  }

  // posts: tags appear as the scan passes, then decode after the click
  POSTS.forEach((p, i) => {
    const g = geo[i];
    const tTag = k.scan + 1.5 * ((g.tagY + 140) / (VIEW.h + 140));
    const tag = $(`tag${i}`);
    const pop = prog(t, tTag, 0.5);
    const bait = p.kind !== 'clean';
    const dist = Math.hypot(g.cx - RING_C.x, g.cy - RING_C.y) / R;
    const d0 = k.tClick + dist * 0.95;
    const dp = prog(t, d0, 0.95);
    const flip = bait ? prog(t, d0 + 0.95, 0.5) : 0;

    // tag: pop in, then flip to "Debaited"
    const done = flip >= 0.3;
    if (tag.dataset.done !== String(done)) {
      tag.innerHTML = tagInner(p, done);
      tag.classList.toggle('done', done);
      tag.dataset.done = String(done);
    }
    const flipRot = flip <= 0 || flip >= 1 ? 0 : flip < 0.3 ? (flip / 0.3) * 90 : -90 * (1 - spring((flip - 0.3) / 0.7));
    tag.style.opacity = Math.min(1, pop * 3).toFixed(3);
    tag.style.transform = `perspective(300px) rotateX(${flipRot.toFixed(2)}deg) scale(${(pop > 0 ? lerp(0.5, 1, spring(pop)) : 0.5).toFixed(4)})`;

    // text: highlighted bait -> scrambled -> honest rewrite
    const txt = $(`txt${i}`);
    let state;
    if (!bait || dp <= 0) state = 'orig';
    else if (dp >= 1) state = 'new';
    else state = 'mid';
    if (state === 'orig') {
      if (lastTxt[i] !== 'orig') { txt.innerHTML = markBait(p.text, p.bait); lastTxt[i] = 'orig'; }
      const h = outCubic(prog(t, tTag, 0.4));
      txt.querySelectorAll('.bw').forEach((b) => {
        b.style.background = `rgba(128,128,128,${(0.2 * h).toFixed(3)})`;
        b.style.textDecorationColor = `rgba(15,20,25,${h.toFixed(3)})`;
      });
    } else if (state === 'mid') {
      txt.textContent = scramble(p.text, p.rewrite, dp, i + 1, t);
      lastTxt[i] = 'mid';
    } else if (lastTxt[i] !== 'new') {
      txt.textContent = p.rewrite;
      lastTxt[i] = 'new';
    }
  });

  // the ingredients card
  const [c0, c1] = k.card;
  const cin = outExpo(prog(t, c0, 0.7));
  const cout = outCubic(prog(t, c1 - 0.3, 0.3));
  S($('E-card'), { o: cin * (1 - cout), y: (1 - cin) * 40 - cout * 10, s: lerp(0.92, 1, cin) * lerp(1, 0.97, cout), rx: (1 - cin) * -16, blur: (1 - cin) * 8 + cout * 6 });
  const C = 2 * Math.PI * 42;
  const gp = outCubic(prog(t, c0 + 0.15, 1.0));
  $('gfill').setAttribute('stroke-dashoffset', (C * (1 - (POSTS[0].score / 100) * gp)).toFixed(2));
  $('gnum').textContent = String(Math.round(POSTS[0].score * gp));
  for (let r = 0; r < 3; r++) enter($(`row${r}`), t, c0 + 0.3 + r * 0.12, 0.5, { dy: 10, blur: 4 });
  enter($('slip'), t, c0 + 0.75, 0.6, { dy: 14, blur: 6 });

  // the cursor glides to the orb and clicks it
  const cur = $('E-cursor');
  const from = { x: 1240, y: 600 };
  const cam = camScale(t);
  const target = { x: CAM_ORIGIN.x + (CORNER.x - CAM_ORIGIN.x) * cam, y: CAM_ORIGIN.y + (CORNER.y - CAM_ORIGIN.y) * cam };
  const mv = inOut(prog(t, k.tClick - 1.25, 1.1));
  const press = t > k.tClick && t < k.tClick + 0.22 ? Math.sin(prog(t, k.tClick, 0.22) * Math.PI) : 0;
  const co = Math.min(prog(t, k.tClick - 1.35, 0.3), 1 - prog(t, k.tClick + 0.9, 0.4));
  S(cur, { o: co, x: lerp(from.x, target.x, mv) - 7, y: lerp(from.y, target.y, mv) - 3, s: 1 - press * 0.18 });
}

// ---------- start ----------
async function loadTiming() {
  try {
    const r = await fetch('./out/vo/timing.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch { /* not recorded yet */ }
  const script = await (await fetch('./script.json')).json();
  return estimateTiming(script);
}

async function init() {
  build();
  const timing = await loadTiming();
  T = times(schedule(timing));
  await Promise.all(['600 100px Inter', '700 100px Bricolage', '800 100px Bricolage', '500 30px Newsreader'].map((f) => document.fonts.load(f)));
  await document.fonts.ready;
  measure();
  orbGl = createOrbRenderer($('orb'), ORB_PX, { dpr: 1, preserve: true });
  window.AD = { duration: T.duration, size: SIZE, render, times: T };
  const params = new URLSearchParams(location.search);
  if (params.has('t')) render(Number(params.get('t')));
  else render(0);
  if (params.has('play')) {
    const t0 = performance.now() - (Number(params.get('from')) || 0) * 1000;
    const audio = new Audio('./out/audio.m4a');
    audio.currentTime = (performance.now() - t0) / 1000;
    audio.play().catch(() => {});
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      render(t % T.duration);
      requestAnimationFrame(loop);
    };
    loop();
  }
  // fit the 1920x1080 stage in smaller windows when previewing
  const fit = () => {
    const s = Math.min(innerWidth / SIZE.w, innerHeight / SIZE.h, 1);
    $('stage').style.transform = s < 1 ? `scale(${s})` : '';
    $('stage').style.transformOrigin = '0 0';
  };
  if (!params.has('render')) { fit(); addEventListener('resize', fit); }
  window.adReady = true;
}
init();
