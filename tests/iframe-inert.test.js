// Same-origin iframe instances are inert (v0.1.9.2): the top frame hooks
// the iframe's window directly, so an instance running inside a
// same-origin iframe must attach nothing and build no overlay of its own.
// (v0.1.9's forwarder never ran in Docs' about:blank editor iframe, so
// this replaces it — the iframe instance simply stays quiet.)
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
  // Same-origin iframe: window.top is a different window whose location
  // is readable, so this instance is inert.
  top: {
    location: { href: 'https://docs.google.com/document/d/x/edit' },
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
global.fetch = async () => { throw new Error('fetch should not be used by an inert iframe'); };

eval(src);

test('same-origin iframe instance loads no DB and builds no overlay', async () => {
  await sleep(20); // let bootstrap (storage read) finish
  assert.equal(sendMessageCalls, 0, 'an inert iframe needs no DB, so it should not ask for one');
  fireDoc('keydown', { key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true });
  await sleep(650);
  assert.equal(docEl.children.length, 0, 'an inert iframe must not create an overlay host in its own document');
});
