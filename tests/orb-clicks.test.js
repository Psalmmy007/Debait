import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let serial = 0;
async function loadOverlayModule(t) {
  const originals = new Map([
    'document', 'chrome', 'matchMedia', 'addEventListener', 'innerWidth', 'innerHeight',
  ].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => {
    for (const [key, desc] of originals) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  });
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.addEventListener = () => {};
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 800;
  globalThis.document = {
    documentElement: { clientWidth: 1280 },
    hidden: false,
    addEventListener() {},
  };
  const storageWrites = [];
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: (patch) => { storageWrites.push(patch); },
      },
    },
  };

  const url = new URL('../src/content/ui/overlay.js', import.meta.url);
  let src = await readFile(url, 'utf8');
  src = src
    .replace(/^import [^\n]+\?inline';\r?\n/gm, '')
    .replace("import { createOrbRenderer } from './orb-gl.js';", 'const createOrbRenderer = () => null;')
    .replace(/from '(\.[^']+)'/g, (_, p) => `from '${new URL(p, url).href}'`);
  const mod = await import(`data:text/javascript,${encodeURIComponent(src)}#overlay-${serial++}`);
  return { ...mod, storageWrites };
}

function createFakeOrbOverlay() {
  const mk = () => {
    const listeners = new Map();
    const classes = new Set();
    return {
      style: {},
      dataset: {},
      hidden: false,
      textContent: '',
      attributes: new Map(),
      listeners,
      classList: {
        add(...c) { c.forEach((x) => classes.add(x)); },
        remove(...c) { c.forEach((x) => classes.delete(x)); },
        toggle(c, on) { if (on) classes.add(c); else classes.delete(c); },
        contains(c) { return classes.has(c); },
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      emit(type, event) {
        for (const fn of listeners.get(type) || []) fn({ type, preventDefault() {}, ...event });
      },
      setAttribute(k, v) { this.attributes.set(k, v); },
      setPointerCapture() {},
      getAnimations() { return []; },
      animate() {},
    };
  };
  const orb = mk();
  const badge = mk();
  const tip = mk();
  const canvas = mk();
  const bubble = mk();
  const orbWrap = {
    ...mk(),
    querySelector(sel) {
      if (sel === '.orb') return orb;
      if (sel === '.orb-badge') return badge;
      if (sel === '.orb-tip') return tip;
      if (sel === '.orb-gl') return canvas;
      if (sel === '.voice-bubble') return bubble;
      return null;
    },
  };
  return { orbWrap, orb, badge, tip };
}

test('single click toggles debait/undebait after snappy debounce; double click opens panel immediately without single-click firing', async (t) => {
  const { createOrbClickController, ORB_CLICK_DELAY_MS } = await loadOverlayModule(t);
  assert.ok(ORB_CLICK_DELAY_MS >= 200 && ORB_CLICK_DELAY_MS <= 260, 'debounce window should stay snappy (200-260ms)');

  let debaited = false;
  let panelOpen = false;
  const events = [];
  const controller = createOrbClickController({
    delayMs: 30,
    onSingleClick: () => { debaited = !debaited; events.push(debaited ? 'debait' : 'undebait'); },
    onDoubleClick: () => { panelOpen = !panelOpen; events.push(panelOpen ? 'panel-open' : 'panel-close'); },
  });

  // 1st single tap -> debait
  controller.tap({ x: 100, y: 100 });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(events, ['debait']);
  assert.equal(debaited, true);
  assert.equal(panelOpen, false);

  // 2nd single tap -> undebait (restore originals)
  controller.tap({ x: 100, y: 100 });
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(events, ['debait', 'undebait']);
  assert.equal(debaited, false);
  assert.equal(panelOpen, false);

  // Double tap -> opens panel immediately without firing single-click debait
  controller.tap({ x: 100, y: 100 });
  controller.tap({ x: 100, y: 100 });
  assert.deepEqual(events, ['debait', 'undebait', 'panel-open'], 'double click must fire immediately without extra wait');
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(events, ['debait', 'undebait', 'panel-open'], 'no delayed single-click after double-click');
  assert.equal(debaited, false);
  assert.equal(panelOpen, true);

  // Double tap again -> closes panel
  controller.tap({ x: 100, y: 100 });
  controller.tap({ x: 100, y: 100 });
  assert.equal(panelOpen, false);
});

test('dragging the orb saves position and never triggers single or double click', async (t) => {
  const { createOrb, storageWrites } = await loadOverlayModule(t);
  const { orbWrap, orb } = createFakeOrbOverlay();
  let singles = 0;
  let doubles = 0;
  createOrb({ orbWrap }, {
    onClick: () => singles++,
    onDoubleClick: () => doubles++,
  });

  // Drag >= 5px
  orb.emit('pointerdown', { button: 0, pointerId: 1, clientX: 500, clientY: 500 });
  orb.emit('pointermove', { pointerId: 1, clientX: 540, clientY: 525 });
  orb.emit('pointerup', { pointerId: 1, clientX: 540, clientY: 525 });

  // Also ensure pointercancel never triggers a click
  orb.emit('pointerdown', { button: 0, pointerId: 2, clientX: 540, clientY: 525 });
  orb.emit('pointercancel', { pointerId: 2, clientX: 540, clientY: 525 });

  await new Promise((r) => setTimeout(r, 300));
  assert.equal(singles, 0, 'drag or pointercancel must never trigger single click');
  assert.equal(doubles, 0, 'drag or pointercancel must never trigger double click');
  assert.equal(storageWrites.filter((w) => 'orbPos' in w).length, 1, 'completed drag persists orb position');
});

test('orb single-click in main.js does not open panel and triple-tap is completely removed', async () => {
  const [mainSrc, overlaySrc] = await Promise.all([
    readFile(new URL('../src/content/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/ui/overlay.js', import.meta.url), 'utf8'),
  ]);
  assert.ok(mainSrc.includes('onClick: (origin) => toggleDebaitPage(origin).catch(report)'));
  assert.ok(!mainSrc.includes('toggleDebaitPage(origin).then(() => panel.open())'));
  assert.ok(!mainSrc.includes('onTripleClick'));
  assert.ok(!overlaySrc.includes('onTripleClick'));
  assert.ok(!overlaySrc.includes('3×'));
  assert.ok(!overlaySrc.includes('talk to Debait'));
});
