// Renders the Debait toolbar icons (a tiny version of the orb: black glass with white smoke)
// to public/icons/icon-{16,32,48,128}.png. Pure Node, no dependencies. Run: node scripts/make-icons.js
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

// ---------- tiny PNG encoder ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- the same kind of smoke as the live orb (value noise + domain warp) ----------
const fract = (x) => x - Math.floor(x);
const hash = (x, y, z) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
const smooth = (t) => t * t * (3 - 2 * t);
function noise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  const v = (dx, dy, dz) => hash(ix + dx, iy + dy, iz + dz);
  return l(
    l(l(v(0, 0, 0), v(1, 0, 0), fx), l(v(0, 1, 0), v(1, 1, 0), fx), fy),
    l(l(v(0, 0, 1), v(1, 0, 1), fx), l(v(0, 1, 1), v(1, 1, 1), fx), fy),
    fz,
  );
}
function fbm(x, y, z, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x, y, z);
    n += a;
    x = x * 2.03 + 1.7; y = y * 2.03 + 9.2; z = z * 2.03 + 3.1;
    a *= 0.5;
  }
  return s / n;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function shade(u, v, size) {
  // u, v in -1..1 (y up). Returns [grey 0..1, alpha 0..1]
  const r2 = u * u + v * v;
  if (r2 > 1) return null;
  const z = Math.sqrt(1 - r2);
  const lx = -0.42, ly = 0.6, lz = 0.68; // light from top-left
  // smoke, looked at through the glass (one sample at mid-depth is enough at icon size)
  let px = u * 1.1, py = v * 1.1, pz = z * 0.6;
  const wx = fbm(px * 0.9 + 0.3, py * 0.9, pz * 0.9, 3) - 0.5;
  const wy = fbm(px * 0.9 + 4.1, py * 0.9 + 1.7, pz * 0.9, 3) - 0.5;
  px += wx * 1.6; py += wy * 1.6;
  let f = fbm(px * 1.2, py * 1.2, pz * 1.2 + 2.0, size >= 48 ? 4 : 2);
  f = Math.min(1, Math.max(0, (f - 0.5) * 3.2 + 0.5));
  // a band of smoke swirling across the lower middle, like the orb when it's busy
  const band = Math.exp(-Math.pow((v + 0.18 - u * 0.25) * 2.2, 2));
  const smoke = sstep(0.42, 0.8, f * 0.55 + band * 0.55) * (0.6 + 0.4 * (u * lx + v * ly + z * lz));
  let c = 0.035 * (1 - smoke) + smoke * 0.92;
  c *= 0.55 + 0.45 * sstep(0, 0.85, z); // thicker glass at the edge
  // glass: rim light, soft sheen, sharp glint
  const hx = lx, hy = ly, hz = lz + 1;
  const hl = Math.hypot(hx, hy, hz);
  const nh = Math.max(0, (u * hx + v * hy + z * hz) / hl);
  const rim = Math.pow(1 - z, 3) * 0.55;
  const sheen = Math.pow(nh, 12) * 0.22;
  const glint = Math.pow(nh, size >= 48 ? 120 : 40) * 1.0;
  return Math.min(1, c + rim + sheen + glint);
}

function render(size) {
  const SS = 4; // 4x4 supersampling for smooth edges
  const pad = size >= 32 ? 0.04 : 0.02;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0, cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (((x + (sx + 0.5) / SS) / size) * 2 - 1) / (1 - pad);
          const v = -((((y + (sy + 0.5) / SS) / size) * 2 - 1) / (1 - pad));
          const g = shade(u, v, size);
          if (g !== null) { sum += g; cover++; }
        }
      }
      const i = (y * size + x) * 4;
      const a = cover / (SS * SS);
      const g = cover ? sum / cover : 0;
      out[i] = out[i + 1] = out[i + 2] = Math.round(g * 255);
      out[i + 3] = Math.round(a * 255);
    }
  }
  return out;
}

mkdirSync('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`public/icons/icon-${size}.png`, png(size, render(size)));
  console.log(`public/icons/icon-${size}.png`);
}
