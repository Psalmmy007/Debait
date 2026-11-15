// Renders the Debait ad to video. No extra packages: it drives your installed Chrome over the
// DevTools protocol, steps the ad frame by frame, and streams the frames into ffmpeg.
//
//   node ad/render.mjs                 full video  -> ad/out/debait-ad.mp4
//   node ad/render.mjs --stills 2,9,30 still frames at those seconds -> ad/out/stills/
//   node ad/render.mjs --audio-only    just rebuild the music + voice mix
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schedule, cues, FPS, SIZE } from './timeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'ad', 'out');
const args = process.argv.slice(2);
const stills = args.includes('--stills') ? args[args.indexOf('--stills') + 1].split(',').map(Number) : null;
const audioOnly = args.includes('--audio-only');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- audio: music bed + voiceover, voice ducks the music ----------
async function buildAudio() {
  const timing = JSON.parse((await readFile(path.join(OUT, 'vo', 'timing.json'), 'utf8')).replace(/^FEFF/, ''));
  const sched = schedule(timing);
  await writeFile(path.join(OUT, 'cues.json'), JSON.stringify(cues(sched), null, 1));
  console.log('music…');
  execFileSync('python', [path.join(ROOT, 'ad', 'music.py')], { stdio: 'inherit' });

  const inputs = ['-i', path.join(OUT, 'music.wav')];
  const parts = [];
  let n = 1;
  for (const line of timing) {
    const mp3 = path.join(OUT, 'vo', `${line.id}.mp3`);
    const file = (await exists(mp3)) ? mp3 : path.join(OUT, 'vo', `${line.id}.wav`);
    inputs.push('-i', file);
    const ms = Math.round(sched.lines[line.id].start * 1000);
    parts.push(`[${n}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=delays=${ms}:all=1[v${n}]`);
    n++;
  }
  const vo = Array.from({ length: n - 1 }, (_, i) => `[v${i + 1}]`).join('');
  const graph = [
    ...parts,
    `${vo}amix=inputs=${n - 1}:normalize=0,asplit=2[voA][voB]`,
    '[0:a]aresample=48000,volume=0.55[m]',
    '[m][voB]sidechaincompress=threshold=0.02:ratio=5:attack=30:release=500[md]',
    '[md][voA]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[out]',
  ].join(';');
  console.log('mixing…');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[out]',
    '-t', sched.duration.toFixed(2), '-c:a', 'aac', '-b:a', '192k', path.join(OUT, 'audio.m4a')], { stdio: 'inherit' });
}

// ---------- a tiny static server for the repo ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, url);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ---------- Chrome over the DevTools protocol ----------
async function launchChrome() {
  let exe = null;
  for (const c of CHROME) if (await exists(c)) { exe = c; break; }
  if (!exe) throw new Error('Chrome not found');
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(exe, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(tmpdir(), `debait-ad-chrome-${Date.now()}`)}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    `--window-size=${SIZE.w},${SIZE.h}`, '--force-device-scale-factor=1', '--enable-unsafe-swiftshader', 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return { proc, ws: page.webSocketDebuggerUrl };
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('Chrome did not start');
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  const ready = new Promise((r) => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
    return r.result.value;
  };
  return { ready, send, evaluate, close: () => ws.close() };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  if (!(await exists(path.join(ROOT, 'public', 'fonts', 'inter.woff2')))) execFileSync('node', ['scripts/copy-fonts.js'], { cwd: ROOT, stdio: 'inherit' });

  const haveVo = await exists(path.join(OUT, 'vo', 'timing.json'));
  if (!stills && haveVo) await buildAudio();
  if (audioOnly) return;

  const server = await serve();
  const { proc, ws } = await launchChrome();
  const c = cdp(ws);
  await c.ready;
  try {
    await c.send('Emulation.setDeviceMetricsOverride', { width: SIZE.w, height: SIZE.h, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/ad/index.html?render` });
    for (let i = 0; i < 200 && !(await c.evaluate('window.adReady === true').catch(() => false)); i++) await sleep(100);
    if (!(await c.evaluate('window.adReady === true'))) throw new Error('ad page did not load');
    const gl = await c.evaluate("document.getElementById('orb').width === 560");
    if (!gl) console.warn('warning: WebGL unavailable, the orb will be missing');
    const duration = await c.evaluate('AD.duration');
    const shot = async (t) => {
      await c.evaluate(`AD.render(${t}); new Promise((r) => requestAnimationFrame(() => r(true)))`);
      const { data } = await c.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
      return Buffer.from(data, 'base64');
    };

    if (stills) {
      await mkdir(path.join(OUT, 'stills'), { recursive: true });
      for (const t of stills) {
        const file = path.join(OUT, 'stills', `t${t.toFixed(1).padStart(5, '0')}.png`);
        await writeFile(file, await shot(t));
        console.log(file);
      }
      console.log(`duration ${duration.toFixed(1)}s`);
      return;
    }

    const frames = Math.ceil(duration * FPS);
    const haveAudio = await exists(path.join(OUT, 'audio.m4a'));
    const outFile = path.join(OUT, 'debait-ad.mp4');
    const ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      ...(haveAudio ? ['-i', path.join(OUT, 'audio.m4a')] : []),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      ...(haveAudio ? ['-c:a', 'copy', '-shortest'] : []),
      outFile,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((r, j) => ff.on('close', (code) => (code === 0 ? r() : j(new Error(`ffmpeg exited ${code}`)))));
    const started = Date.now();
    for (let f = 0; f < frames; f++) {
      const png = await shot(f / FPS);
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 60 === 0) {
        const el = (Date.now() - started) / 1000;
        console.log(`frame ${f}/${frames}  (${el.toFixed(0)}s elapsed, ~${((el / Math.max(1, f)) * (frames - f)).toFixed(0)}s left)`);
      }
    }
    ff.stdin.end();
    await done;
    console.log(`\n${outFile}  (${duration.toFixed(1)}s${haveAudio ? ', with sound' : ', silent'})`);
  } finally {
    c.close();
    proc.kill();
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
