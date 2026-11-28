import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dedupeHeadlines } from '../src/content/sites/index.js';

function makeNode(tagName, parent = null) {
  const node = {
    tagName: tagName.toUpperCase(),
    parentElement: parent,
    children: [],
    dataset: {},
    style: { cssText: '', setProperty(k, v) { this[k] = v; } },
    attributes: new Map(),
    classes: new Set(),
    listeners: new Map(),
    textContent: '',
    title: '',
    get isConnected() {
      let cur = this;
      while (cur.parentElement) cur = cur.parentElement;
      return cur.tagName === 'DOCUMENT-ROOT';
    },
    get nextElementSibling() {
      if (!this.parentElement) return null;
      const idx = this.parentElement.children.indexOf(this);
      return idx >= 0 ? this.parentElement.children[idx + 1] || null : null;
    },
    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentElement;
      }
      return false;
    },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    insertAdjacentElement(pos, child) {
      assert.equal(pos, 'afterend');
      const p = this.parentElement;
      const idx = p.children.indexOf(this);
      child.parentElement = p;
      p.children.splice(idx + 1, 0, child);
      return child;
    },
    remove() {
      if (!this.parentElement) return;
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    },
    classList: null,
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    setAttribute(k, v) { this.attributes.set(k, v); },
    removeAttribute(k) { this.attributes.delete(k); },
    getBoundingClientRect() { return { width: 80, left: 10, top: 10, bottom: 32 }; },
    attachShadow() {
      const btn = makeNode('button');
      const ico = makeNode('span', btn);
      const label = makeNode('span', btn);
      const score = makeNode('span', btn);
      btn.children.push(ico, label, score);
      this.shadowRoot = {
        adoptedStyleSheets: [],
        innerHTML: '',
        querySelector(sel) {
          if (sel === '.tag') return btn;
          if (sel === '.ico') return ico;
          if (sel === '.label') return label;
          if (sel === '.score') return score;
          return null;
        },
        appendChild() {},
      };
      return this.shadowRoot;
    },
  };
  node.classList = {
    add(...cls) { cls.forEach((c) => node.classes.add(c)); },
    remove(...cls) { cls.forEach((c) => node.classes.delete(c)); },
    toggle(c, on) { if (on) node.classes.add(c); else node.classes.delete(c); },
    contains(c) { return node.classes.has(c); },
  };
  return node;
}

function queryAll(root, tag) {
  const out = [];
  const want = tag.toUpperCase();
  const walk = (n) => {
    for (const c of n.children) {
      if (c.tagName === want) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

let serial = 0;
async function loadTagModule(t) {
  const originals = new Map(['document', 'matchMedia', 'getComputedStyle', 'CSSStyleSheet'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  t.after(() => {
    for (const [key, desc] of originals) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  });
  const docRoot = makeNode('document-root');
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.getComputedStyle = () => ({ color: 'rgb(20, 20, 20)', transform: 'none' });
  globalThis.CSSStyleSheet = class { replaceSync() {} };
  globalThis.document = {
    documentElement: docRoot,
    createElement: (tag) => makeNode(tag),
    querySelectorAll: (sel) => queryAll(docRoot, sel),
  };

  const url = new URL('../src/content/ui/tag.js', import.meta.url);
  let src = await readFile(url, 'utf8');
  src = src
    .replace("import tokens from '../styles/tokens.css?inline';", "const tokens = '';")
    .replace("import tagCss from '../styles/tag.css?inline';", "const tagCss = '';")
    .replace(/from '(\.[^']+)'/g, (_, p) => `from '${new URL(p, url).href}'`);
  const mod = await import(`data:text/javascript,${encodeURIComponent(src)}#tag-${serial++}`);
  return { ...mod, docRoot };
}

test('dedupeHeadlines collapses nested Google Search heading markup and shared .yuRUbf anchors to 1 headline', () => {
  const card = makeNode('div');
  const yuru = makeNode('div', card); card.appendChild(yuru);
  const link = makeNode('a', yuru); yuru.appendChild(link);
  const roleHeading = makeNode('div', link); link.appendChild(roleHeading);
  const h3 = makeNode('h3', roleHeading); roleHeading.appendChild(h3);
  const siblingHeading = makeNode('div', yuru); yuru.appendChild(siblingHeading);

  const card2 = makeNode('div');
  const yuru2 = makeNode('div', card2); card2.appendChild(yuru2);
  const h3Second = makeNode('h3', yuru2); yuru2.appendChild(h3Second);

  const place = (el) => (yuru.contains(el) ? yuru : yuru2.contains(el) ? yuru2 : el);
  const result = dedupeHeadlines([link, roleHeading, h3, h3, siblingHeading, h3Second], place);

  assert.equal(result.length, 2, 'must emit exactly 1 headline per Google Search result card');
  assert.equal(result[0], h3, 'must keep the innermost heading element');
  assert.equal(result[1], h3Second);
});

test('repeated createTag calls and orphaned pills from older instances never create duplicate Reading badges', async (t) => {
  const { createTag, cleanupOrphanedTags, docRoot } = await loadTagModule(t);
  const resultContainer = makeNode('div');
  docRoot.appendChild(resultContainer);
  const yuru = makeNode('div');
  resultContainer.appendChild(yuru);

  // Simulate 2 orphaned <debait-tag> pills left behind by previous extension reloads
  const orphan1 = makeNode('debait-tag');
  const orphan2 = makeNode('debait-tag');
  yuru.insertAdjacentElement('afterend', orphan1);
  orphan1.insertAdjacentElement('afterend', orphan2);
  assert.equal(queryAll(docRoot, 'debait-tag').length, 2);

  // Startup cleanup purges orphaned badges from older content script instances
  assert.equal(cleanupOrphanedTags(document), 2);
  assert.equal(queryAll(docRoot, 'debait-tag').length, 0);

  // Repeated scans / createTag calls on the same anchor reuse the single live badge
  const clicks = [];
  const tag1 = createTag(yuru, { onClick: () => clicks.push('first') });
  tag1.setResult({ kind: 'envy', score: 85, source: 'cloud' });
  const tag2 = createTag(yuru, { onClick: () => clicks.push('second') });
  const tag3 = createTag(yuru, { onClick: () => clicks.push('third') });

  assert.equal(tag2, tag1, 'must reuse existing live tag handle for the same anchor');
  assert.equal(tag3, tag1);
  assert.equal(queryAll(docRoot, 'debait-tag').length, 1, 'must have strictly 1 <debait-tag> in DOM');

  // Even if an external orphan somehow appears next to the anchor, createTag prunes it
  const stray = makeNode('debait-tag');
  tag1.host.insertAdjacentElement('afterend', stray);
  assert.equal(queryAll(docRoot, 'debait-tag').length, 2);
  createTag(yuru, { onClick: () => clicks.push('fourth') });
  assert.equal(queryAll(docRoot, 'debait-tag').length, 1, 'must prune stray adjacent <debait-tag> siblings');
});

test('content startup cleans up orphaned tags/overlays and ignores own debait-tag mutations', async () => {
  const [mainSrc, overlaySrc] = await Promise.all([
    readFile(new URL('../src/content/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/ui/overlay.js', import.meta.url), 'utf8'),
  ]);
  assert.ok(mainSrc.includes('cleanupOrphanedTags(document)'), 'main.js must purge orphaned tags on startup');
  assert.ok(mainSrc.includes('dedupeHeadlines(adapter.find(document), adapter.place)'), 'main.js must deduplicate nested/shared-anchor headlines');
  assert.ok(mainSrc.includes('isDebaitMutation'), 'MutationObserver must ignore Debait own badge mutations');
  assert.ok(overlaySrc.includes("querySelectorAll('debait-root, debait-fx')"), 'overlay.js must purge orphaned overlays on startup');
});
