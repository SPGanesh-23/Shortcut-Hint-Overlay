// Release trigger (v0.1.11): holding the trigger key for the long-press
// duration arms the overlay, but nothing appears while the key is held.
// The overlay opens (locked) only when the key is released after a clean
// hold — no other key, click or scroll in between. That is what makes
// Ctrl+click / Ctrl+scroll / Ctrl+C safe: those all use the key before
// releasing it, so the overlay never appears for them at all.
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
const DB = {};
global.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://x/${p}`,
    sendMessage: (_msg, cb) => { setTimeout(() => cb(DB), 0); },
  },
  storage: { sync: { get: (d, cb) => cb({ ...d }) }, onChanged: { addListener() {} } },
};
global.fetch = async () => ({ json: async () => DB });

eval(src);

function panel() {
  const host = docEl.children.find((c) => c.tagName === 'DIV' && c._shadow);
  if (!host || !host._shadow) return null;
  return host._shadow.children.find((c) => c.classList.contains('panel'));
}
function panelVisible() {
  const p = panel();
  return !!(p && p.classList.contains('visible'));
}
function panelLocked() {
  const p = panel();
  return !!(p && p.classList.contains('locked'));
}

async function closeOverlay() {
  fireDoc('keydown', { key: 'Escape', code: 'Escape' });
  await sleep(50);
}

async function pressCtrl() {
  fireDoc('keydown', { key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true });
}
async function releaseCtrl() {
  fireDoc('keyup', { key: 'Control', code: 'ControlLeft' });
  await sleep(50);
}

test('nothing appears during the hold; a clean hold opens the overlay (locked) on release', async () => {
  await closeOverlay();
  await pressCtrl();
  await sleep(650); // past the 500 ms hold
  assert.equal(panelVisible(), false, 'overlay must not appear while Ctrl is still held');
  await releaseCtrl();
  assert.equal(panelVisible(), true, 'overlay should open on release after a clean hold');
  assert.equal(panelLocked(), true, 'overlay should open locked so it stays open');
  await closeOverlay();
});

test('a short Ctrl tap opens nothing', async () => {
  await closeOverlay();
  await pressCtrl();
  await sleep(200); // under the 500 ms hold
  await releaseCtrl();
  assert.equal(panelVisible(), false, 'a short tap must not open the overlay');
});

test('Ctrl+C never opens the overlay on release', async () => {
  await closeOverlay();
  await pressCtrl();
  await sleep(650);
  fireDoc('keydown', { key: 'c', code: 'KeyC', ctrlKey: true });
  fireDoc('keyup', { key: 'c', code: 'KeyC', ctrlKey: true });
  await releaseCtrl();
  assert.equal(panelVisible(), false, 'using Ctrl for another shortcut must not open the overlay');
});

test('Ctrl+scroll during the hold opens nothing on release', async () => {
  await closeOverlay();
  await pressCtrl();
  await sleep(200);
  fireDoc('wheel', { deltaY: 120, ctrlKey: true });
  await sleep(600); // past when a re-armed timer would have fired
  await releaseCtrl();
  assert.equal(panelVisible(), false, 'scrolling during the hold must disqualify the release');
});

test('Ctrl+click during the hold opens nothing on release', async () => {
  await closeOverlay();
  await pressCtrl();
  await sleep(200);
  fireDoc('mousedown', { ctrlKey: true });
  await sleep(600);
  await releaseCtrl();
  assert.equal(panelVisible(), false, 'clicking during the hold must disqualify the release');
});

test('a fresh hold after a disqualified one still opens on release', async () => {
  await closeOverlay();
  await pressCtrl();
  await sleep(200);
  fireDoc('wheel', { deltaY: 120, ctrlKey: true });
  await releaseCtrl();
  assert.equal(panelVisible(), false, 'disqualified hold must open nothing');
  await pressCtrl();
  await sleep(650);
  await releaseCtrl();
  assert.equal(panelVisible(), true, 'a fresh clean hold should open on release');
  await closeOverlay();
});
