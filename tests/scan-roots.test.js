// DOM scan roots + thin-entry supplement + late-DB re-render (v0.1.11):
// scanPageShortcuts() must find shortcuts inside same-origin iframes and
// shadow roots, not just the top document; a thin curated entry (< 10)
// must be supplemented with scanned shortcuts (deduped by keys); and a DB
// that arrives after the overlay opened must re-render the panel.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { El } = require('./fake-dom');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const docListeners = {};
const winListeners = {};
const docEl = new El('html');
global.document = {
  createElement: (t) => new El(t),
  createDocumentFragment: () => new El('#frag'),
  documentElement: docEl,
  querySelectorAll: (sel) => docEl.querySelectorAll(sel),
  querySelector: (sel) => docEl.querySelector(sel),
  addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); },
  removeEventListener: (t, f) => {
    docListeners[t] = (docListeners[t] || []).filter((x) => x !== f);
  },
};
function fireDoc(type, ev) {
  ev.preventDefault = () => {};
  ev.stopImmediatePropagation = () => {};
  ev.stopPropagation = () => {};
  (docListeners[type] || []).forEach((f) => f(ev));
}
global.window = {
  innerWidth: 1200,
  innerHeight: 800,
  location: {
    hostname: 'example.com',
    pathname: '/',
    origin: 'https://example.com',
  },
  addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); },
  removeEventListener: (t, f) => {
    winListeners[t] = (winListeners[t] || []).filter((x) => x !== f);
  },
};
global.window.top = global.window; // top frame
global.location = global.window.location;
// Thin curated entry: 1 shortcut, so the v0.1.11 supplement must kick in.
const DB = {
  'thin.com': [
    { keys: 'Alt + S', label: 'Curated save', priority: 1 },
  ],
};
global.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://x/${p}`,
    // Capture the DB callback so a test can simulate a late DB arrival.
    sendMessage: (_msg, cb) => { global.__dbCb = cb; setTimeout(() => cb(DB), 0); },
  },
  storage: { sync: { get: (d, cb) => cb({ ...d }) }, onChanged: { addListener() {} } },
};
global.fetch = async () => ({ json: async () => DB });

eval(src);

// ── Fake page tree ──────────────────────────────────────────────────────────
// Top document: a button with an accesskey.
const topBtn = new El('button');
topBtn.setAttribute('accesskey', 's');
topBtn.setAttribute('aria-label', 'DOM save');
docEl.appendChild(topBtn);

// Shadow DOM: a host element whose shadow root holds a button with
// aria-keyshortcuts.
const shadowHost = new El('div');
const shadowRootEl = new El('div');
const shadowBtn = new El('button');
shadowBtn.setAttribute('aria-keyshortcuts', 'Control+K');
shadowBtn.setAttribute('aria-label', 'Search notes');
shadowRootEl.appendChild(shadowBtn);
shadowHost.shadowRoot = shadowRootEl;
docEl.appendChild(shadowHost);

// Same-origin iframe: its document holds a button with an accesskey.
const frame = new El('iframe');
const frameDoc = new El('html');
const frameBtn = new El('button');
frameBtn.setAttribute('accesskey', 'p');
frameBtn.setAttribute('aria-label', 'Publish');
frameDoc.appendChild(frameBtn);
frame.contentDocument = frameDoc;
docEl.appendChild(frame);

// Cross-origin iframe: reading contentDocument throws — the scan must
// skip it instead of crashing.
const xFrame = new El('iframe');
Object.defineProperty(xFrame, 'contentDocument', {
  get() { throw new Error('cross-origin'); },
  configurable: true,
});
docEl.appendChild(xFrame);

async function holdCtrl() {
  fireDoc('keydown', { key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true });
  await sleep(650); // long-press is 500 ms
  fireDoc('keyup', { key: 'Control', code: 'ControlLeft' }); // release trigger opens it
  await sleep(50);
}
function panelText() {
  // The overlay host is the DIV with a shadow root — other DIVs in the
  // fake page tree (e.g. the shadow host) have none.
  const host = docEl.children.find((c) => c.tagName === 'DIV' && c._shadow);
  const panel = host._shadow.children.find((c) => c.classList.contains('panel'));
  return panel.textContent;
}
async function openOn(hostname) {
  fireDoc('keydown', { key: 'Escape', code: 'Escape' });
  await sleep(50);
  global.window.location.hostname = hostname;
  await holdCtrl();
  return panelText();
}

test('scan finds shortcuts in the top document, a shadow root and a same-origin iframe', async () => {
  await sleep(20); // let the DB load via the worker path
  const text = await openOn('example.com'); // no DB entry: pure DOM scan
  assert.ok(text.includes('DOM save'), 'top-document accesskey should be found');
  assert.ok(text.includes('Search notes'), 'shadow-root aria-keyshortcuts should be found');
  assert.ok(text.includes('Publish'), 'same-origin iframe accesskey should be found');
});

test('thin curated entry is supplemented with scanned shortcuts, deduped by keys', async () => {
  const text = await openOn('thin.com'); // curated entry has 1 shortcut
  assert.ok(text.includes('Curated save'), 'curated shortcut should be shown');
  assert.ok(text.includes('Search notes'), 'scanned shadow-root shortcut should supplement');
  assert.ok(text.includes('Publish'), 'scanned iframe shortcut should supplement');
  assert.ok(!text.includes('DOM save'), 'scanned Alt + S duplicates the curated key and must be skipped');
  assert.equal(DB['thin.com'].length, 1, 'supplementing must not mutate the loaded DB');
});

test('a DB that arrives after the overlay opened re-renders the panel', async () => {
  const before = await openOn('example.com');
  assert.ok(!before.includes('Late DB entry'), 'no site section before the late DB arrives');
  // Simulate the background worker replying late with a DB entry for this host.
  global.__dbCb({
    'example.com': { shortcuts: [{ keys: 'Ctrl + E', label: 'Late DB entry', priority: 1 }] },
  });
  await sleep(50);
  const after = panelText();
  assert.ok(after.includes('Late DB entry'), 'panel should re-render once the DB arrives');
  fireDoc('keydown', { key: 'Escape', code: 'Escape' });
  await sleep(50);
});
