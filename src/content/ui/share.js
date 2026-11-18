// Share card: a 1200x675 image of a headline, bait vs honest, printed like a Debait label.
const KIND = { rage: 'Rage bait', fear: 'Fear bait', envy: 'Envy bait', clean: 'Clean' };
const COLOR = { rage: '#e0362c', fear: '#e08600', envy: '#7c5ce0', clean: '#16a058' };
const SANS = '"Debait Inter", "Inter Variable", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const DISPLAY = `"Debait Bricolage", ${SANS}`;
const SERIF = '"Debait Newsreader", Georgia, "Times New Roman", serif';
const INK = '#111111';

// the page declares Debait's fonts; make sure they are loaded before drawing with them
async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`800 40px "Debait Bricolage"`),
      document.fonts.load(`600 40px "Debait Inter"`),
      document.fonts.load(`600 40px "Debait Newsreader"`),
    ]);
  } catch { /* fall back to system fonts */ }
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
function block(ctx, text, x, y, maxW, { size, weight, family, color, maxLines, strike, lineHeight = 1.18 }) {
  let s = size;
  let lines;
  do {
    ctx.font = `${weight} ${s}px ${family}`;
    lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines) break;
    s -= 2;
  } while (s > 22);
  lines = lines.slice(0, maxLines);
  const lh = Math.round(s * lineHeight);
  ctx.fillStyle = color;
  lines.forEach((l, i) => {
    ctx.fillText(l, x, y + i * lh);
    if (strike) {
      ctx.fillStyle = strike;
      ctx.fillRect(x, y + i * lh - s * 0.32, ctx.measureText(l).width, Math.max(3, s / 12));
      ctx.fillStyle = color;
    }
  });
  return y + (lines.length - 1) * lh;
}

function micro(ctx, text, x, y, color = '#737373') {
  ctx.font = `700 17px ${SANS}`;
  ctx.letterSpacing = '2.5px';
  ctx.fillStyle = color;
  ctx.fillText(text.toUpperCase(), x, y);
  ctx.letterSpacing = '0px';
}

export async function makeShareImage({ bait, honest, kind, score }) {
  await fontsReady();
  const W = 1200, H = 675, M = 40, P = 40;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  // paper, and the label printed on it
  ctx.fillStyle = '#f3f2ee'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(M, M, W - 2 * M, H - 2 * M);
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(M + 1.5, M + 1.5, W - 2 * M - 3, H - 2 * M - 3);
  const L = M + P;
  const R = W - M - P;
  const maxW = R - L;

  // header: wordmark left, verdict right
  ctx.fillStyle = INK; ctx.font = `800 46px ${DISPLAY}`; ctx.letterSpacing = '-1.5px';
  ctx.fillText('Debait', L, M + P + 36);
  ctx.letterSpacing = '0px';
  ctx.font = `700 21px ${SANS}`;
  ctx.letterSpacing = '1.5px';
  const verdict = `${(KIND[kind] || 'Bait').toUpperCase()}  ·  ${score}/100`;
  const vw = ctx.measureText(verdict).width;
  ctx.fillText(verdict, R - vw, M + P + 30);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = COLOR[kind] || INK;
  ctx.fillRect(R - vw - 30, M + P + 13, 16, 16);

  // thick rule
  let y = M + P + 62;
  ctx.fillStyle = INK; ctx.fillRect(L, y, maxW, 12);
  y += 12;

  micro(ctx, 'The bait', L, y + 46);
  y = block(ctx, bait, L, y + 92, maxW, { size: 34, weight: 600, family: SANS, color: '#8a8a8a', maxLines: 2, strike: COLOR[kind] || INK });

  // medium rule
  y += 28;
  ctx.fillStyle = INK; ctx.fillRect(L, y, maxW, 5);
  y += 5;

  micro(ctx, 'The news', L, y + 44);
  block(ctx, honest, L, y + 102, maxW, { size: 54, weight: 600, family: SERIF, color: INK, maxLines: 3, lineHeight: 1.12 });

  // footer
  const fy = H - M - P;
  ctx.fillStyle = 'rgba(17,17,17,0.14)'; ctx.fillRect(L, fy - 34, maxW, 1);
  ctx.font = `500 19px ${SANS}`; ctx.fillStyle = '#555555';
  ctx.fillText('Read the news. Not the bait.', L, fy);
  const tag = 'Nutrition facts for your feed';
  ctx.fillText(tag, R - ctx.measureText(tag).width, fy);

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
