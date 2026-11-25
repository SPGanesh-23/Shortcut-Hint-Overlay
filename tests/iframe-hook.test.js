// Top frame hooking same-origin iframes (v0.1.9.2): Google Docs/Slides
// catch keys in a hidden about:blank iframe, so the top document never
// sees the Ctrl hold. The top frame must hook the iframe's window
// directly — for the iframe present at load (Docs), for one added later
// (Slides), and it must skip cross-origin iframes it cannot reach.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { El } = require('./fake-dom');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake MutationObserver: records instances; tests fire callbacks manually.
const observerInstances = [];
global.MutationObserver = class {
  constructor(cb) { this.cb = cb; observerInstances.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
};
function fireObservers(mutations) {
  for (const obs of observerInstances) obs.cb(mutations);
}

const docListeners = {};
const winListeners = {};
const docEl = new El('html');
global.document = {
  createElement: (t) => new El(t),
  createDocumentFragment: () => new El('#frag'),
  documentElement: docEl,
  querySelectorAll: (sel) => docEl.querySelectorAll(sel),
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
  location: { hostname: 'docs.google.com', origin: 'https://docs.google.com' },
  addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); },
  removeEventListener: (t, f) => {
    winListeners[t] = (winListeners[t] || []).filter((x) => x !== f);
  },
};
global.window.top = global.window; // top frame: top === self, so not inert
global.location = global.window.location;
const DB = {
  'docs.google.com': { shortcuts: [
    { keys: 'Ctrl + B', label: 'Bold text', priority: 1 },
    { keys: 'Ctrl + K', label: 'Insert link', priority: 2 },
  ] },
};
global.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://x/${p}`,
    sendMessage: (_msg, cb) => { setTimeout(() => cb(DB), 0); },
  },
  storage: { sync: { get: (d, cb) => cb({ ...d }) }, onChanged: { addListener() {} } },
};
global.fetch = async () => ({ json: async () => DB });

// A fake same-origin iframe window: records listeners and can fire events.
function makeFrameWindow() {
  const listeners = {};
  const frameDoc = new El('html');
  return {
    document: frameDoc,
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener: (t, f) => {
      listeners[t] = (listeners[t] || []).filter((x) => x !== f);
    },
    _listeners: listeners,
    fire(type, ev = {}) {
      ev.preventDefault = () => {};
      ev.stopImmediatePropagation = () => {};
      ev.stopPropagation = () => {};
      (listeners[type] || []).forEach((f) => f(ev));
    },
  };
}
function makeFrameEl(win) {
  const el = new El('iframe');
  el.contentWindow = win;
  return el;
}
function panelOfHost() {
  const host = docEl.children.find((c) => c.tagName === 'DIV');
  if (!host) return null;
  return host._shadow.children.find((c) => c.classList.contains('panel'));
}

// Docs case: the editor iframe is already in the page at load.
const editorWin = makeFrameWindow();
docEl.appendChild(makeFrameEl(editorWin));

eval(src);

test('Ctrl hold inside the editor iframe present at load opens the overlay on release', async () => {
  await sleep(20); // let the DB load via the worker path
  editorWin.fire('keydown', { key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true });
  await sleep(650); // long-press is 500 ms
  let panel = panelOfHost();
  assert.ok(!panel || !panel.classList.contains('visible'), 'nothing must appear while Ctrl is still held');
  editorWin.fire('keyup', { key: 'Control' });
  await sleep(50);
  panel = panelOfHost();
  assert.ok(panel, 'host element should be created by a Ctrl hold inside the iframe');
  assert.ok(panel.classList.contains('visible'), 'panel should be visible after release');
  const rows = panel.querySelectorAll('.shortcut-row');
  assert.ok(rows.some((r) => r.textContent.includes('Bold text')), 'Docs shortcuts should be shown');
});

test('Esc closes the overlay opened by a release inside the iframe', async () => {
  fireDoc('keydown', { key: 'Escape', code: 'Escape' });
  await sleep(50);
  const panel = panelOfHost();
  assert.ok(panel && !panel.classList.contains('visible'), 'panel should hide on Esc');
});

test('an iframe added later (Slides case) gets hooked by the observer', async () => {
  const slidesWin = makeFrameWindow();
  const slidesFrame = makeFrameEl(slidesWin);
  docEl.appendChild(slidesFrame);
  fireObservers([{ addedNodes: [slidesFrame] }]);
  slidesWin.fire('keydown', { key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true });
  await sleep(650);
  slidesWin.fire('keyup', { key: 'Control' });
  await sleep(50);
  const panel = panelOfHost();
  assert.ok(panel && panel.classList.contains('visible'), 'panel should open from a Ctrl hold in the dynamically added iframe');
  fireDoc('keydown', { key: 'Escape', code: 'Escape' });
  await sleep(50);
});

test('a cross-origin iframe is skipped without breaking the top frame', async () => {
  const xFrame = new El('iframe');
  Object.defineProperty(xFrame, 'contentWindow', { get() { throw new Error('cross-origin'); } });
  docEl.appendChild(xFrame);
  assert.doesNotThrow(() => fireObservers([{ addedNodes: [xFrame] }]), 'hooking must not throw on a cross-origin iframe');
  // The top frame must still work afterwards.
  fireDoc('keydown', { key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true });
  await sleep(650);
  fireDoc('keyup', { key: 'Control' });
  await sleep(50);
  const panel = panelOfHost();
  assert.ok(panel && panel.classList.contains('visible'), 'top-frame Ctrl hold should still open the overlay');
});

test('a click inside a hooked iframe closes a locked overlay', async () => {
  // Overlay is locked from the previous test (the release trigger opens
  // it locked), so it must survive a Ctrl release and close on the click.
  fireDoc('keyup', { key: 'Control' });
  await sleep(50);
  let panel = panelOfHost();
  assert.ok(panel && panel.classList.contains('visible'), 'locked overlay should survive Ctrl release');
  editorWin.fire('click', {});
  await sleep(50);
  panel = panelOfHost();
  assert.ok(panel && !panel.classList.contains('visible'), 'click inside the iframe should close the locked overlay');
});
