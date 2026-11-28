// Renders the 24s 60fps 1920x1080 Debait kinetic promo ad via Chrome CDP + FFmpeg.
// Usage:
//   node ad-kinetic/render.mjs                  -> ad-kinetic/debait-kinetic-ad.mp4
//   node ad-kinetic/render.mjs --stills 1.8,4.6 -> ad-kinetic/out/stills/*.png
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const OUT = path.join(DIR, 'out');
const FINAL_MP4 = path.join(DIR, 'debait-kinetic-ad.mp4');

const SIZE = { w: 1920, h: 1080 };
const FPS = 60;
const DURATION = 24.0;

const args = process.argv.slice(2);
const stills = args.includes('--stills') ? args[args.indexOf('--stills') + 1].split(',').map(Number) : null;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.resolve(ROOT, '.' + url);
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

async function launchChrome() {
  let exe = null;
  for (const c of CHROME) if (await exists(c)) { exe = c; break; }
  if (!exe) throw new Error('Chrome/Edge binary not found');
  const port = 9400 + Math.floor(Math.random() * 450);
  const proc = spawn(exe, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(tmpdir(), `debait-kinetic-chrome-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    `--window-size=${SIZE.w},${SIZE.h}`,
    '--force-device-scale-factor=1',
    '--enable-unsafe-swiftshader',
    'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return { proc, ws: page.webSocketDebuggerUrl };
    } catch { /* waiting for CDP */ }
    await sleep(120);
  }
  try { proc.kill(); } catch { /* ignore */ }
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
  if (!(await exists(path.join(ROOT, 'public', 'fonts', 'jakarta.woff2')))) {
    execFileSync('node', ['scripts/copy-fonts.js'], { cwd: ROOT, stdio: 'inherit' });
  }

  // Synthesize 120 BPM kinetic audio track first (unless --stills only)
  const audioWav = path.join(OUT, 'audio.wav');
  if (!stills) {
    console.log('Synthesizing 120 BPM kinetic audio...');
    execFileSync('python', [path.join(DIR, 'audio.py')], { stdio: 'inherit' });
  }

  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/ad-kinetic/index.html?render`;
  const timeout = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`${what} timed out`); })]);

  let session = null;
  async function openSession() {
    const { proc, ws } = await launchChrome();
    const c = cdp(ws);
    await timeout(c.ready, 10000, 'connect');
    await c.send('Emulation.setDeviceMetricsOverride', { width: SIZE.w, height: SIZE.h, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url });
    for (let i = 0; i < 200 && !(await timeout(c.evaluate('window.adReady === true'), 3000, 'ready').catch(() => false)); i++) {
      await sleep(80);
    }
    if (!(await c.evaluate('window.adReady === true'))) throw new Error('ad-kinetic page did not load');
    session = { proc, c };
    return session;
  }
  function closeSession() {
    if (!session) return;
    try { session.c.close(); } catch { /* ignore */ }
    try { session.proc.kill(); } catch { /* ignore */ }
    session = null;
  }

  try {
    await openSession();

    const shotOnce = async (t) => {
      const { c } = session;
      await c.evaluate(`AD.render(${t}); new Promise((r) => requestAnimationFrame(() => r(true)))`);
      const { data } = await c.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
      return Buffer.from(data, 'base64');
    };
    const shot = async (t) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return await timeout(shotOnce(t), 15000, 'frame');
        } catch (err) {
          console.warn(`frame at ${t.toFixed(3)}s failed (${err.message}); restarting Chrome...`);
          closeSession();
          await openSession();
        }
      }
      throw new Error(`frame at ${t}s failed 4 times`);
    };

    if (stills) {
      const stillsDir = path.join(OUT, 'stills');
      await mkdir(stillsDir, { recursive: true });
      for (const t of stills) {
        const file = path.join(stillsDir, `t${t.toFixed(2).padStart(5, '0')}.png`);
        await writeFile(file, await shot(t));
        console.log('still:', file);
      }
      return;
    }

    const totalFrames = Math.round(DURATION * FPS); // 1440 frames
    const ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-i', audioWav,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
      '-r', String(FPS), '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-shortest',
      FINAL_MP4,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });

    const done = new Promise((resolve, reject) => {
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    });

    const started = Date.now();
    for (let f = 0; f < totalFrames; f++) {
      if (f > 0 && f % 360 === 0) {
        closeSession();
        await openSession();
      }
      const png = await shot(f / FPS);
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 120 === 0 || f === totalFrames - 1) {
        const el = (Date.now() - started) / 1000;
        const pct = Math.round(((f + 1) / totalFrames) * 100);
        console.log(`frame ${f + 1}/${totalFrames} (${pct}%)  ${el.toFixed(1)}s elapsed`);
      }
    }
    ff.stdin.end();
    await done;
    console.log(`RENDER COMPLETE -> ${FINAL_MP4}`);
  } finally {
    closeSession();
    server.close();
  }
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
