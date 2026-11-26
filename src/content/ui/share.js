// Share card: a clean 1200x675 image of a headline, bait vs honest, in black and white.
const KIND = { rage: 'Rage bait', fear: 'Fear bait', envy: 'Envy bait', clean: 'Clean' };
const FONT = '"Debait Inter", "Inter Variable", -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// the page declares Debait's font; make sure it is loaded before drawing with it
async function fontReady() {
  try { await Promise.all([document.fonts.load(`700 40px "Debait Inter"`), document.fonts.load(`500 40px "Debait Inter"`)]); } catch { /* system font */ }
}

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** Text block that shrinks until it fits maxLines. Draws from baseline y; returns the last baseline. */
function block(ctx, text, x, y, maxW, { size, weight, color, maxLines, strike = false, tracking = 0, lineHeight = 1.16 }) {
  let s = size;
  let lines;
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    ctx.letterSpacing = `${tracking * s}px`;
    lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines) break;
    s -= 2;
  } while (s > 22);
  lines = lines.slice(0, maxLines);
  const lh = Math.round(s * lineHeight);
  ctx.fillStyle = color;
  lines.forEach((l, i) => {
    ctx.fillText(l, x, y + i * lh);
    if (strike) ctx.fillRect(x, y + i * lh - s * 0.3, ctx.measureText(l).width, Math.max(2, s / 16));
  });
  ctx.letterSpacing = '0px';
  return y + (lines.length - 1) * lh;
}

function pill(ctx, text, rightX, cy) {
  ctx.font = `600 22px ${FONT}`;
  const w = ctx.measureText(text).width + 40;
  const h = 44;
  const x = rightX - w;
  ctx.fillStyle = '#1d1d1f';
  ctx.beginPath();
  ctx.roundRect(x, cy - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x + 20, cy + 8);
}

export async function makeShareImage({ bait, honest, kind, score }) {
  await fontReady();
  const W = 1200, H = 675, P = 80;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = '#f5f5f7'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.roundRect(40, 40, W - 80, H - 80, 36); ctx.fill();

  // header: wordmark left, verdict right
  ctx.fillStyle = '#1d1d1f';
  ctx.font = `700 40px ${FONT}`; ctx.letterSpacing = '-1.2px';
  ctx.fillText('Debait', P, P + 38);
  ctx.letterSpacing = '0px';
  pill(ctx, `${KIND[kind] || 'Bait'} · ${score}`, W - P, P + 24);

  let y = P + 120;
  ctx.font = `600 20px ${FONT}`; ctx.fillStyle = '#8e8e93';
  ctx.fillText('The bait', P, y);
  y = block(ctx, bait, P, y + 46, W - 2 * P, { size: 32, weight: 500, color: '#8e8e93', maxLines: 2, strike: true, tracking: -0.01 });

  y += 64;
  ctx.font = `600 20px ${FONT}`; ctx.fillStyle = '#1d1d1f';
  ctx.fillText('The news', P, y);
  block(ctx, honest, P, y + 64, W - 2 * P, { size: 54, weight: 700, color: '#1d1d1f', maxLines: 3, tracking: -0.025, lineHeight: 1.1 });

  ctx.font = `500 19px ${FONT}`; ctx.fillStyle = '#8e8e93';
  ctx.fillText('Read the news. Not the bait.', P, H - P + 6);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

/** Copies the image to the clipboard; falls back to downloading it. Returns 'copied' | 'saved'. */
export async function shareHeadline(data) {
  const blob = await makeShareImage(data);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  } catch {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'debait-headline.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return 'saved';
  }
}
