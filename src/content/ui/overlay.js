// The floating layer: one Shadow DOM root holding the orb, the card and the settings panel,
// plus a second host for the page-wide wave (it needs its own blend mode to invert the page).
import tokens from '../styles/tokens.css?inline';
import orbCss from '../styles/orb.css?inline';
import cardCss from '../styles/card.css?inline';
import panelCss from '../styles/panel.css?inline';
import tagCss from '../styles/tag.css?inline';
import { SPRING, reducedMotion } from './page.js';
import { createOrbRenderer } from './orb-gl.js';
import { setHTML, adoptCss } from './html.js';
import { load, save } from '../ext.js';

const ORB = 56;          // base size; the user can scale it (settings.orbSize)
const ORB_MAX = 1.6;
const MARGIN = 16;
// visible width, not counting the page's scrollbar
const viewW = () => document.documentElement.clientWidth || innerWidth;

export function createOverlay() {
  const host = document.createElement('debait-root');
  // Inline !important beats any page CSS that might target our host element.
  host.style.cssText =
    'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483646 !important; pointer-events: none !important; display: block !important;';
  const shadow = host.attachShadow({ mode: 'open' });
  adoptCss(shadow, tokens + orbCss + tagCss + cardCss + panelCss);
  setHTML(shadow, `
    <div class="card-layer"></div>
    <div class="panel-layer"></div>
    <div class="orb-wrap" data-state="idle">
      <span class="orb-shadow"></span>
      <svg class="orb-ring" viewBox="0 0 68 68" aria-hidden="true"><circle class="track" cx="34" cy="34" r="32"/><circle class="arc" cx="34" cy="34" r="32"/></svg>
      <button class="orb" aria-label="Debait this page">
        <span class="orb-body"><span class="orb-fallback"></span><canvas class="orb-gl"></canvas></span>
      </button>
      <span class="orb-badge"></span>
      <span class="orb-mic" aria-hidden="true"></span>
      <div class="voice-bubble" role="status" aria-live="polite"></div>
      <span class="orb-tip"></span>
    </div>`);
  document.documentElement.appendChild(host);
  return {
    host,
    shadow,
    cardLayer: shadow.querySelector('.card-layer'),
    panelLayer: shadow.querySelector('.panel-layer'),
    orbWrap: shadow.querySelector('.orb-wrap'),
  };
}

// ============================================================
// ORB: drag anywhere, click = Debait page, double-click = settings
// ============================================================
export function createOrb(overlay, { onClick, onDoubleClick, onTripleClick }) {
  const wrap = overlay.orbWrap;
  const orb = wrap.querySelector('.orb');
  const badge = wrap.querySelector('.orb-badge');
  const tip = wrap.querySelector('.orb-tip');
  const canvas = wrap.querySelector('.orb-gl');

  // drawn once at the largest size, so it stays sharp when scaled up
  const gl = createOrbRenderer(canvas, Math.round(ORB * ORB_MAX));
  let k = 1; // orb scale
  const S = () => ORB * k;
  if (gl) {
    wrap.classList.add('has-gl');
    gl.start();
  }

  // position kept as a fraction of the free space, so it survives window resizes
  let pos = { x: 0, y: 0 };
  let ratio = { x: 1, y: 0.8 };

  const clamp = (p) => ({
    x: Math.min(Math.max(p.x, MARGIN), viewW() - S() - MARGIN),
    y: Math.min(Math.max(p.y, MARGIN), innerHeight - S() - MARGIN),
  });
  const fromRatio = () => clamp({
    x: MARGIN + ratio.x * (viewW() - S() - 2 * MARGIN),
    y: MARGIN + ratio.y * (innerHeight - S() - 2 * MARGIN),
  });
  const toRatio = () => ({
    x: (pos.x - MARGIN) / Math.max(1, viewW() - S() - 2 * MARGIN),
    y: (pos.y - MARGIN) / Math.max(1, innerHeight - S() - 2 * MARGIN),
  });
  const place = () => {
    wrap.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) scale(${k})`;
    wrap.classList.toggle('tip-right', pos.x < 240);
  };

  load('orbPos').then(({ orbPos }) => {
    if (orbPos) ratio = orbPos;
    pos = fromRatio();
    place();
    // entrance: rises in from a blur, then settles
    if (!reducedMotion()) {
      orb.animate(
        [{ transform: 'scale(0.4)', opacity: 0, filter: 'blur(8px)' }, { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' }],
        { duration: 900, easing: SPRING },
      );
    }
  });
  addEventListener('resize', () => { pos = fromRatio(); place(); });

  // First time only: show the label for a few seconds, so double-click isn't a hidden feature.
  load('orbHintSeen').then(({ orbHintSeen }) => {
    if (orbHintSeen) return;
    setTimeout(() => wrap.classList.add('hint'), 1800);
    setTimeout(() => wrap.classList.remove('hint'), 8000);
    save({ orbHintSeen: true });
  });

  // The light on the glass follows your cursor around the page.
  let lightRaf = 0;
  let lastPointer = null;
  addEventListener('pointermove', (e) => {
    lastPointer = e;
    if (lightRaf || !gl) return;
    lightRaf = requestAnimationFrame(() => {
      lightRaf = 0;
      const c = center();
      const dx = (lastPointer.clientX - c.x) / 500;
      const dy = (lastPointer.clientY - c.y) / 500;
      gl.setLight(Math.max(-1, Math.min(1, dx)), Math.max(-1, Math.min(1, -dy)));
    });
  }, { passive: true });

  // Hovering wakes it up: the smoke moves faster.
  wrap.addEventListener('pointerenter', () => gl?.setBoost(2.2));
  wrap.addEventListener('pointerleave', () => gl?.setBoost(1));

  // Save battery: stop drawing when the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (!gl) return;
    if (document.hidden || wrap.hidden) gl.stop();
    else gl.start();
  });

  const cancelJs = () => orb.getAnimations().forEach((a) => { if (!('animationName' in a)) a.cancel(); });

  // ---- drag: the ball leans into the motion and the smoke inside lags behind ----
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
    orb.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.92)' }], { duration: 140, easing: 'ease-out', fill: 'forwards' });
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
    drag.vx = drag.vx * 0.7 + ((e.clientX - drag.lx) / dt) * 0.3;
    drag.vy = drag.vy * 0.7 + ((e.clientY - drag.ly) / dt) * 0.3;
    drag.lx = e.clientX;
    drag.ly = e.clientY;
    drag.lt = now;

    pos = clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy });
    place();

    const speed = Math.min(Math.hypot(drag.vx, drag.vy), 3);
    const s = speed * 0.07;
    const ang = (Math.atan2(drag.vy, drag.vx) * 180) / Math.PI;
    cancelJs();
    orb.style.transform = `rotate(${ang}deg) scale(${0.95 + s}, ${0.95 - s * 0.6}) rotate(${-ang}deg)`;
    gl?.setVelocity(Math.max(-1.5, Math.min(1.5, -drag.vx)), Math.max(-1.5, Math.min(1.5, drag.vy)));
  });

  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const wasDrag = drag.moved;
    drag = null;
    wrap.classList.remove('dragging');
    const from = orb.style.transform || 'scale(0.92)';
    orb.style.transform = '';
    cancelJs();
    gl?.setVelocity(0, 0);
    orb.animate(
      [{ transform: from }, { transform: 'scale(1.06, 0.95)', offset: 0.35 }, { transform: 'scale(0.98, 1.02)', offset: 0.7 }, { transform: 'scale(1)' }],
      { duration: 600, easing: 'ease-out' },
    );
    if (wasDrag) {
      ratio = toRatio();
      save({ orbPos: ratio });
    } else {
      tap();
    }
  };
  orb.addEventListener('pointerup', release);
  orb.addEventListener('pointercancel', release);

  // 1 click = Debait the page, 2 clicks = settings, 3 clicks = talk to Debait (voice call).
  // Waits a moment after the last click to count them.
  let clickTimer = null;
  let clicks = 0;
  function tap() {
    clicks++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      const n = clicks;
      clicks = 0;
      if (n >= 3) onTripleClick?.(center());
      else if (n === 2) onDoubleClick(center());
      else onClick(center());
    }, 260);
  }
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
    return { x: pos.x + S() / 2, y: pos.y + S() / 2 };
  }

  const HINT = '<em><kbd>2×</kbd> settings <kbd>3×</kbd> talk to Debait</em>';
  let lastCount = -1;
  return {
    destroy() { gl?.stop?.(); },
    center,
    /** 0.75 – 1.6 times the normal size; labels next to it keep their size */
    setSize(next) {
      k = Math.min(ORB_MAX, Math.max(0.75, Number(next) || 1));
      wrap.style.setProperty('--inv', String(1 / k));
      pos = fromRatio();
      place();
    },

    setVisible(v) {
      wrap.hidden = !v;
      if (!gl) return;
      if (v && !document.hidden) gl.start();
      else gl.stop();
    },
    /** state: idle | busy | bait | calm */
    update({ state, bait, debaited, scanned, notice }) {
      wrap.dataset.state = state;
      gl?.setMood(state);
      const count = state === 'calm' ? debaited : bait;
      badge.textContent = String(count);
      badge.classList.toggle('show', count > 0);
      if (count !== lastCount && lastCount !== -1 && count > 0 && !reducedMotion()) {
        badge.animate([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 450, easing: SPRING });
      }
      lastCount = count;
      if (notice) {
        tip.replaceChildren();
        const b = document.createElement('span');
        b.textContent = 'Debait is paused';
        const sm = document.createElement('small');
        sm.textContent = notice;
        sm.style.whiteSpace = 'normal';
        sm.style.maxWidth = '240px';
        tip.append(b, sm);
        if (!wrap.dataset.noticeShown) { wrap.dataset.noticeShown = '1'; wrap.classList.add('hint'); setTimeout(() => wrap.classList.remove('hint'), 7000); }
      } else if (state === 'calm') {
        setHTML(tip, `Restore originals<small>${debaited} headline${debaited === 1 ? '' : 's'} debaited</small>${HINT}`);
      } else if (bait > 0) {
        setHTML(tip, `Debait this page<small>${bait} bait of ${scanned} headlines</small>${HINT}`);
      } else if (state === 'busy') {
        setHTML(tip, `Reading headlines…${HINT}`);
      } else {
        setHTML(tip, `Debait<small>${scanned ? `${scanned} headlines, all clean` : 'Looking for headlines'}</small>${HINT}`);
      }
    },
    setPanelOpen(open) { wrap.classList.toggle('panel-open', open); },
    /** voice state: idle | listening | heard | speaking | error */
    setVoice({ mode, text }) {
      const bubble = wrap.querySelector('.voice-bubble');
      wrap.dataset.voice = mode;
      gl?.setBoost(mode === 'speaking' ? 2.6 : mode === 'listening' ? 1.4 : 1);
      if (mode === 'idle') { bubble.classList.remove('show'); return; }
      const label = { listening: 'On a call with Debait', heard: 'You said', speaking: 'Debait', error: 'Voice' }[mode];
      bubble.replaceChildren();
      const b = document.createElement('b');
      b.textContent = label;
      bubble.append(b);
      if (mode === 'listening') {
        const w = document.createElement('span');
        w.className = 'wave';
        for (let i = 0; i < 5; i++) w.append(document.createElement('i'));
        bubble.append(w);
      } else if (text) {
        const p = document.createElement('span');
        p.textContent = mode === 'heard' ? `“${text}”` : text;
        bubble.append(p);
      }
      bubble.classList.add('show');
      clearTimeout(this._vt);
      if (mode === 'heard' || mode === 'error') this._vt = setTimeout(() => bubble.classList.remove('show'), 4000);
    },
    pulse() {
      gl?.pulse();
      if (reducedMotion()) return;
      orb.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(0.86)', offset: 0.2 }, { transform: 'scale(1.08)', offset: 0.55 }, { transform: 'scale(1)' }],
        { duration: 650, easing: 'ease-out' },
      );
    },
  };
}

// ============================================================
// WAVE: thin rings that invert the page as they pass,
// so they show up on any site, light or dark.
// ============================================================
let fxHost = null;
function fxLayer() {
  if (fxHost?.isConnected) return fxHost.shadowRoot.firstElementChild;
  fxHost = document.createElement('debait-fx');
  fxHost.style.cssText =
    'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483645 !important; pointer-events: none !important; display: block !important; mix-blend-mode: difference !important;';
  const root = fxHost.attachShadow({ mode: 'open' });
  setHTML(root, '<div style="position:absolute;inset:0;overflow:hidden"></div>');
  document.documentElement.appendChild(fxHost);
  return root.firstElementChild;
}

export function playRipple(origin, { undo = false } = {}) {
  const R = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y)) + 40;
  const duration = 1250;
  if (reducedMotion()) return { R, duration: 0 };

  const layer = fxLayer();
  const ring = (delay, width, alpha) => {
    const el = document.createElement('div');
    const size = R * 2;
    // a hairline white ring: under "difference" it inverts whatever is beneath it
    const edge = (width / R) * 50;
    el.style.cssText = `position:absolute;left:${origin.x}px;top:${origin.y}px;width:${size}px;height:${size}px;border-radius:50%;` +
      `background:radial-gradient(circle closest-side, transparent ${100 - edge * 2}%, rgba(255,255,255,${alpha}) ${100 - edge}%, transparent 100%);` +
      'transform:translate(-50%,-50%) scale(0);will-change:transform,opacity';
    layer.appendChild(el);
    const frames = [
      { transform: 'translate(-50%, -50%) scale(0.02)', opacity: 1 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.15 },
    ];
    el.animate(undo ? [...frames].reverse() : frames, {
      duration: duration + delay * 0.6,
      delay,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both',
    }).finished.then(() => el.remove());
  };
  ring(0, 2.5, 1);
  ring(120, 1.2, 0.7);
  ring(260, 0.8, 0.45);
  return { R, duration };
}
