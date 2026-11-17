// Share card: a clean 1200x675 image of a headline, bait vs honest, drawn on a canvas.
const LABEL = { rage: 'Rage bait', fear: 'Fear bait', envy: 'Envy bait', clean: 'Clean' };
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

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

/** Text block that shrinks until it fits maxLines. Returns the height used. */
function block(ctx, text, x, y, maxW, { size, weight, color, maxLines = 3, strike = false }) {
  let s = size;
  let lines;
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    lines = wrap(ctx, text, maxW);
    s -= 2;
  } while (lines.length > maxLines && s > 22);
  const lh = Math.round((s + 2) * 1.18);
  ctx.fillStyle = color;
  lines.slice(0, maxLines).forEach((l, i) => {
    ctx.fillText(l, x, y + i * lh);
    if (strike) {
      const w = ctx.measureText(l).width;
      ctx.fillRect(x, y + i * lh - (s + 2) * 0.32, w, Math.max(2, s / 16));
    }
  });
  return Math.min(lines.length, maxLines) * lh;
}

function orb(ctx, cx, cy, r) {
  const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.35, r * 0.1, cx, cy + r * 0.2, r);
  g.addColorStop(0, '#d9d9de');
  g.addColorStop(0.45, '#4a4a50');
  g.addColorStop(1, '#050506');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5; ctx.stroke();
}

export async function makeShareImage({ bait, honest, kind, score }) {
  const W = 1200, H = 675, P = 72;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, -60, 10, W * 0.85, -60, 700);
  glow.addColorStop(0, 'rgba(255,255,255,0.12)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // header: orb + wordmark, kind + score on the right
  orb(ctx, P + 18, P + 4, 18);
  ctx.fillStyle = '#fff'; ctx.font = `700 30px ${FONT}`; ctx.fillText('Debait', P + 48, P + 15);
  ctx.font = `600 22px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.6)';
  const right = `${LABEL[kind] || 'Bait'} · ${score}/100`;
  ctx.fillText(right, W - P - ctx.measureText(right).width, P + 12);

  let y = P + 110;
  ctx.font = `600 20px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillText('THE BAIT', P, y);
  y += 50;
  y += block(ctx, bait, P, y, W - 2 * P, { size: 40, weight: 600, color: 'rgba(255,255,255,0.5)', strike: true });
  y += 44;
  ctx.font = `600 20px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillText('THE NEWS', P, y);
  y += 58;
  block(ctx, honest, P, y, W - 2 * P, { size: 52, weight: 700, color: '#fff' });

  ctx.font = `500 20px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('Read the news. Not the bait.', P, H - P + 12);
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
