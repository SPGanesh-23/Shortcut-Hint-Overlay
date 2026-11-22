// Top frame receiving forwarded events (v0.1.9): a same-origin iframe sends
// its key events up via postMessage, and the top frame — which owns the
// overlay — must open the overlay for them, exactly as if the keys had
// happened in the top document. Foreign-origin messages must be ignored.
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
  addEventListener: (t, f) => { (docListeners[t] = docListeners[t] || []).push(f); },
  removeEventListener: (t, f) => {
    docListeners[t] = (docListeners[t] || []).filter((x) => x !== f);
  },
};
global.window = {
  innerWidth: 1200,
  innerHeight: 800,
  location: { hostname: 'docs.google.com', origin: 'https://docs.google.com' },
  addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); },
  removeEventListener: (t, f) => {
    winListeners[t] = (winListeners[t] || []).filter((x) => x !== f);
  },
};
global.window.top = global.window; // top frame: top === self, so not a forwarder
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

eval(src);

function postToTop(data, origin) {
  (winListeners.message || []).forEach((f) => f({ data, origin }));
}

test('forwarded Ctrl hold from an iframe opens the overlay with Docs shortcuts', async () => {
  await sleep(20); // let the DB load via the worker path
  // A foreign-origin message must be ignored.
  postToTop({ __sho: true, type: 'keydown', key: 'Control', code: 'ControlLeft', ctrlKey: true }, 'https://evil.example');
  await sleep(650);
  let host = docEl.children.find((c) => c.tagName === 'DIV');
  assert.ok(!host, 'foreign-origin messages must not open the overlay');

  postToTop({ __sho: true, type: 'keydown', key: 'Control', code: 'ControlLeft', ctrlKey: true, repeat: false }, 'https://docs.google.com');
  await sleep(650); // long-press is 500 ms
  host = docEl.children.find((c) => c.tagName === 'DIV');
  assert.ok(host, 'host element should be created by a forwarded Ctrl hold');
  const panel = host._shadow.children.find((c) => c.classList.contains('panel'));
  assert.ok(panel.classList.contains('visible'), 'panel should be visible');
  const rows = panel.querySelectorAll('.shortcut-row');
  assert.ok(rows.some((r) => r.textContent.includes('Bold text')), 'Docs shortcuts should be shown');
});

test('forwarded Ctrl release hides the overlay again', async () => {
  postToTop({ __sho: true, type: 'keyup', key: 'Control' }, 'https://docs.google.com');
  await sleep(50);
  const host = docEl.children.find((c) => c.tagName === 'DIV');
  const panel = host._shadow.children.find((c) => c.classList.contains('panel'));
  assert.ok(!panel.classList.contains('visible'), 'panel should hide on forwarded Ctrl release');
});
