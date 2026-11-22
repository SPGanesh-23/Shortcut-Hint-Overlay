// Iframe forwarding (v0.1.9): when this script runs in a same-origin iframe
// (e.g. Google Docs' hidden editor iframe, where keystrokes actually go),
// it must NOT build its own overlay — it forwards key/click events to the
// top frame, which owns the overlay.
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
function fireDoc(type, ev) {
  ev.preventDefault = () => {};
  ev.stopImmediatePropagation = () => {};
  ev.stopPropagation = () => {};
  (docListeners[type] || []).forEach((f) => f(ev));
}

const posted = [];
global.window = {
  innerWidth: 1200,
  innerHeight: 800,
  location: { hostname: 'docs.google.com', origin: 'https://docs.google.com' },
  // Same-origin iframe: window.top is a different window whose location
  // is readable, so this instance becomes a forwarder.
  top: {
    location: { href: 'https://docs.google.com/document/d/x/edit' },
    postMessage: (msg) => { posted.push(msg); },
  },
  addEventListener() {},
  removeEventListener() {},
};
global.location = global.window.location;
let sendMessageCalls = 0;
global.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://x/${p}`,
    sendMessage: (_msg, cb) => { sendMessageCalls += 1; setTimeout(() => cb({}), 0); },
  },
  storage: { sync: { get: (d, cb) => cb({ ...d }) }, onChanged: { addListener() {} } },
};
global.fetch = async () => { throw new Error('fetch should not be used by a forwarder'); };

eval(src);

test('same-origin iframe forwards keys to the top frame and builds no overlay', async () => {
  await sleep(20); // let bootstrap (storage read) finish
  assert.equal(sendMessageCalls, 0, 'a forwarder needs no DB, so it should not ask for one');
  fireDoc('keydown', { key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true });
  assert.equal(posted.length, 1, 'keydown should be forwarded');
  assert.equal(posted[0].__sho, true);
  assert.equal(posted[0].type, 'keydown');
  assert.equal(posted[0].key, 'Control');
  fireDoc('keyup', { key: 'Control', code: 'ControlLeft', ctrlKey: false });
  assert.equal(posted.length, 2, 'keyup should be forwarded');
  assert.equal(posted[1].type, 'keyup');
  fireDoc('click', {});
  assert.equal(posted.length, 3, 'click should be forwarded');
  assert.equal(posted[2].type, 'click');
  assert.equal(docEl.children.length, 0, 'a forwarder must not create an overlay host in its own document');
});
