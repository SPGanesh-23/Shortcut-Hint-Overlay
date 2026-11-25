// Trigger mode setting (v0.1.12): "release" (default) opens the overlay
// locked when the trigger key is released after a clean hold, so ordinary
// Ctrl+click / Ctrl+scroll / Ctrl+C never trigger it. "peek" is the old
// behaviour: the overlay appears while the key is held and hides on
// release (Ctrl+Space locks it). Switching the setting live (via
// chrome.storage.onChanged, as the options page does) must take effect
// without a reload.
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
let changeListener = null;
const storedOverrides = {};
global.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://x/${p}`,
    sendMessage: (_msg, cb) => { setTimeout(() => cb(DB), 0); },
  },
  storage: {
    sync: { get: (d, cb) => cb({ ...d, ...storedOverrides }) },
    onChanged: { addListener(f) { changeListener = f; } },
  },
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
function hintText() {
  const p = panel();
  if (!p) return null;
  const hint = p.querySelector('.hint');
  return hint ? hint.textContent : null;
}

async function closeOverlay() {
  fireDoc('keydown', { key: 'Escape', code: 'Escape' });
  await sleep(50);
}

// Switch the trigger mode the way the options page does: write the
// setting, then fire the storage change event content.js listens for.
async function setTriggerMode(mode) {
  storedOverrides.triggerMode = mode;
  changeListener({}, 'sync');
  await sleep(50);
}

async function pressCtrl() {
  fireDoc('keydown', { key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true });
}
async function releaseCtrl() {
  fireDoc('keyup', { key: 'Control', code: 'ControlLeft' });
  await sleep(50);
}

test('default mode is release: clean hold opens locked on release, nothing mid-hold', async () => {
  await closeOverlay();
  await pressCtrl();
  await sleep(650);
  assert.equal(panelVisible(), false, 'release mode must show nothing while held');
  await releaseCtrl();
  assert.equal(panelVisible(), true, 'release mode should open on release');
  assert.equal(panelLocked(), true, 'release mode should open locked');
  assert.equal(hintText(), 'Hold Ctrl, then release to open');
  await closeOverlay();
});

test('peek mode: overlay appears mid-hold and hides on release', async () => {
  await setTriggerMode('peek');
  await closeOverlay();
  await pressCtrl();
  await sleep(650);
  assert.equal(panelVisible(), true, 'peek mode should show the overlay while held');
  assert.equal(panelLocked(), false, 'peek mode should not lock on its own');
  assert.equal(hintText(), 'Hold Ctrl to peek');
  await releaseCtrl();
  assert.equal(panelVisible(), false, 'peek mode should hide on release');
});

test('peek mode: Ctrl+Space locks it, and it survives the release', async () => {
  await pressCtrl();
  await sleep(650);
  assert.equal(panelVisible(), true, 'peek overlay should be visible before locking');
  fireDoc('keydown', { key: ' ', code: 'Space', ctrlKey: true });
  assert.equal(panelLocked(), true, 'Ctrl+Space should lock the peek overlay');
  await releaseCtrl();
  assert.equal(panelVisible(), true, 'locked peek overlay should survive the release');
  await closeOverlay();
});

test('peek mode: Ctrl+scroll during the hold keeps it hidden', async () => {
  await pressCtrl();
  await sleep(200);
  fireDoc('wheel', { deltaY: 120, ctrlKey: true });
  await sleep(600);
  assert.equal(panelVisible(), false, 'scrolling during a peek hold must suppress the overlay');
  await releaseCtrl();
  assert.equal(panelVisible(), false, 'a suppressed peek hold must open nothing on release');
});

test('switching back to release takes effect without a reload', async () => {
  await setTriggerMode('release');
  await closeOverlay();
  await pressCtrl();
  await sleep(650);
  assert.equal(panelVisible(), false, 'release mode must show nothing while held');
  await releaseCtrl();
  assert.equal(panelVisible(), true, 'release mode should open on release again');
  assert.equal(panelLocked(), true, 'release mode should open locked again');
  await closeOverlay();
});
