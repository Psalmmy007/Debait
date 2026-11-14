// The floating layer: one Shadow DOM root holding the orb, the ripple and the card.
import css from '../styles/ui.css?inline';
import { SPRING, SOFT, reducedMotion } from './page.js';

const ORB = 60;
const MARGIN = 10;

export function createOverlay() {
  const host = document.createElement('debait-root');
  // Inline !important beats any page CSS that might target our host element.
  host.style.cssText =
    'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483646 !important; pointer-events: none !important; display: block !important;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${css}</style>
    <div class="ripple-layer"></div>
    <div class="card-layer"></div>
    <div class="panel-layer"></div>
    <div class="orb-wrap" data-state="idle">
      <div class="orb-glow"></div>
      <button class="orb" aria-label="Debait this page"><span class="orb-clip">
        <span class="orb-base"></span>
        <span class="orb-swirl"><i class="cloud c1"></i><i class="cloud c2"></i><i class="cloud c3"></i><i class="cloud c4"></i><i class="cloud c5"></i></span>
        <span class="orb-sheen"></span>
        <span class="orb-grain"></span>
        <span class="orb-edge"></span>
      </span></button>
      <span class="orb-badge"></span>
      <span class="orb-tip"></span>
    </div>`;
  document.documentElement.appendChild(host);
  return {
    host,
    shadow,
    rippleLayer: shadow.querySelector('.ripple-layer'),
    cardLayer: shadow.querySelector('.card-layer'),
    panelLayer: shadow.querySelector(".panel-layer"),
    orbWrap: shadow.querySelector('.orb-wrap'),
  };
}

// ============================================================
// ORB: drag anywhere, squishes like liquid, click = Debait page
// ============================================================
export function createOrb(overlay, { onClick, onDoubleClick }) {
  const wrap = overlay.orbWrap;
  const orb = wrap.querySelector('.orb');
  const badge = wrap.querySelector('.orb-badge');
  const tip = wrap.querySelector('.orb-tip');

  // position kept as a fraction of the free space, so it survives window resizes
  let pos = { x: 0, y: 0 };
  let ratio = { x: 1, y: 0.78 };

  const clamp = (p) => ({
    x: Math.min(Math.max(p.x, MARGIN), innerWidth - ORB - MARGIN),
    y: Math.min(Math.max(p.y, MARGIN), innerHeight - ORB - MARGIN),
  });
  const fromRatio = () => clamp({
    x: MARGIN + ratio.x * (innerWidth - ORB - 2 * MARGIN),
    y: MARGIN + ratio.y * (innerHeight - ORB - 2 * MARGIN),
  });
  const toRatio = () => ({
    x: (pos.x - MARGIN) / Math.max(1, innerWidth - ORB - 2 * MARGIN),
    y: (pos.y - MARGIN) / Math.max(1, innerHeight - ORB - 2 * MARGIN),
  });
  const place = () => {
    wrap.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    wrap.classList.toggle('tip-right', pos.x < 220);
  };

  chrome.storage.local.get('orbPos').then(({ orbPos }) => {
    if (orbPos) ratio = orbPos;
    pos = fromRatio();
    place();
    // drop-in entrance
    if (!reducedMotion()) {
      orb.animate(
        [{ transform: 'scale(0.2)', opacity: 0, filter: 'blur(6px)' }, { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }],
        { duration: 900, easing: SPRING },
      );
    }
  });
  addEventListener('resize', () => { pos = fromRatio(); place(); });

  // cancel our own WAAPI animations but keep the CSS wobble running
  const cancelJs = () => orb.getAnimations().forEach((a) => { if (!('animationName' in a)) a.cancel(); });

  // ---- drag with squash & stretch ----
  let drag = null;
  orb.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    orb.setPointerCapture(e.pointerId);
    drag = {
      id: e.pointerId,
      dx: e.clientX - pos.x,
      dy: e.clientY - pos.y,
      sx: e.clientX,
      sy: e.clientY,
      lx: e.clientX,
      ly: e.clientY,
      lt: performance.now(),
      moved: false,
      vx: 0,
      vy: 0,
    };
    orb.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.9)' }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
  });

  orb.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      wrap.classList.add('dragging');
    }
    const now = performance.now();
    const dt = Math.max(1, now - drag.lt);
    // smoothed velocity in px/ms
    drag.vx = drag.vx * 0.7 + ((e.clientX - drag.lx) / dt) * 0.3;
    drag.vy = drag.vy * 0.7 + ((e.clientY - drag.ly) / dt) * 0.3;
    drag.lx = e.clientX;
    drag.ly = e.clientY;
    drag.lt = now;

    pos = clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy });
    place();

    // stretch along the direction of travel, like a drop of water
    const speed = Math.min(Math.hypot(drag.vx, drag.vy), 3);
    const s = speed * 0.09;
    const ang = (Math.atan2(drag.vy, drag.vx) * 180) / Math.PI;
    cancelJs();
    orb.style.transform = `rotate(${ang}deg) scale(${0.92 + s}, ${0.92 - s * 0.7}) rotate(${-ang}deg)`;
  });

  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const wasDrag = drag.moved;
    drag = null;
    wrap.classList.remove('dragging');
    const from = orb.style.transform || 'scale(0.9)';
    orb.style.transform = '';
    cancelJs();
    // jelly settle
    orb.animate(
      [{ transform: from }, { transform: 'scale(1.08, 0.94)', offset: 0.35 }, { transform: 'scale(0.97, 1.03)', offset: 0.65 }, { transform: 'scale(1)' }],
      { duration: 650, easing: 'ease-out' },
    );
    if (wasDrag) {
      ratio = toRatio();
      chrome.storage.local.set({ orbPos: ratio });
    } else {
      tap();
    }
  };
  orb.addEventListener('pointerup', release);
  orb.addEventListener('pointercancel', release);

  // one click = Debait the page, double-click = settings.
  // A single click waits a moment to make sure it isn't the start of a double-click.
  let clickTimer = null;
  function tap() {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      onDoubleClick(center());
    } else {
      clickTimer = setTimeout(() => {
        clickTimer = null;
        onClick(center());
      }, 230);
    }
  }
  // right-click also opens settings
  orb.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    onDoubleClick(center());
  });
  orb.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (e.shiftKey) onDoubleClick(center());
      else onClick(center());
    }
  });

  function center() {
    return { x: pos.x + ORB / 2, y: pos.y + ORB / 2 };
  }

  let lastCount = -1;
  return {
    center,
    setVisible(v) { wrap.hidden = !v; },
    /** state: idle | busy | bait | calm */
    update({ state, bait, debaited, scanned }) {
      wrap.dataset.state = state;
      const count = state === 'calm' ? debaited : bait;
      badge.textContent = String(count);
      badge.classList.toggle('show', state === 'calm' ? debaited > 0 : bait > 0);
      if (count !== lastCount && lastCount !== -1 && !reducedMotion()) {
        badge.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 500, easing: SPRING });
      }
      lastCount = count;
      if (state === 'calm') {
        tip.innerHTML = `Restore originals<small>${debaited} headline${debaited === 1 ? '' : 's'} debaited</small>`;
      } else if (bait > 0) {
        tip.innerHTML = `Debait this page<small>${bait} bait of ${scanned} headlines</small>`;
      } else if (state === 'busy') {
        tip.innerHTML = 'Reading headlines…';
      } else {
        tip.innerHTML = `Debait<small>${scanned ? `${scanned} headlines, all clean` : 'Looking for headlines'}</small>`;
      }
      tip.insertAdjacentHTML('beforeend', '<em>Double-click for settings</em>');
    },
    setPanelOpen(open) { wrap.classList.toggle('panel-open', open); },
    pulse() {
      if (reducedMotion()) return;
      orb.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.18, 0.86)', offset: 0.25 }, { transform: 'scale(0.92, 1.08)', offset: 0.55 }, { transform: 'scale(1)' }],
        { duration: 700, easing: 'ease-out' },
      );
    },
  };
}

// ============================================================
// RIPPLE: a liquid wave + bubbles spreading from the orb
// ============================================================
export function playRipple(layer, origin, { undo = false } = {}) {
  const R = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
  const duration = 1150;
  if (reducedMotion()) return { R, duration: 0 };

  const make = (cls, size) => {
    const el = document.createElement('div');
    el.className = cls;
    el.style.left = `${origin.x}px`;
    el.style.top = `${origin.y}px`;
    el.style.width = el.style.height = `${size}px`;
    layer.appendChild(el);
    return el;
  };

  const grow = [
    { transform: 'translate(-50%, -50%) scale(0)', opacity: 1 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
  ];
  const shrink = [...grow].reverse();
  const frames = undo ? shrink : grow;

  const wash = make('wash', R * 2);
  wash.animate(frames, { duration: duration * 0.9, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' }).finished.then(() => wash.remove());

  [0, 140, 300].forEach((delay, i) => {
    const w = make(undo ? 'wave undo' : 'wave', R * 2.3);
    w.animate(frames, { duration: duration + i * 120, delay, easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'both' })
      .finished.then(() => w.remove());
  });

  // little bubbles floating out
  if (!undo) {
    for (let i = 0; i < 14; i++) {
      const size = 5 + Math.random() * 13;
      const b = make('bubble', size);
      const a = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 220;
      const tx = Math.cos(a) * dist;
      const ty = Math.sin(a) * dist - 40 * Math.random();
      b.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0 },
          { transform: `translate(calc(-50% + ${tx * 0.35}px), calc(-50% + ${ty * 0.35}px)) scale(1)`, opacity: 0.95, offset: 0.3 },
          { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(0.6)`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 700, delay: Math.random() * 180, easing: SOFT, fill: 'both' },
      ).finished.then(() => b.remove());
    }
  }
  return { R, duration };
}
