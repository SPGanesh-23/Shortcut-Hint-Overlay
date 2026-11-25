// Workspace routing (v0.1.10): Docs, Sheets and Slides documents ALL live
// on docs.google.com and differ only by path, so the overlay must route by
// path — a spreadsheet must show SHEETS.GOOGLE.COM with Sheets shortcuts,
// not DOCS.GOOGLE.COM with Docs shortcuts.
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
    hostname: 'docs.google.com',
    pathname: '/spreadsheets/d/abc123/edit',
    origin: 'https://docs.google.com',
  },
  addEventListener: (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); },
  removeEventListener: (t, f) => {
    winListeners[t] = (winListeners[t] || []).filter((x) => x !== f);
  },
};
global.window.top = global.window; // top frame
global.location = global.window.location;
const DB = {
  'docs.google.com': { shortcuts: [
    { keys: 'Ctrl + Shift + C', label: 'Word count', priority: 3 },
  ] },
  'sheets.google.com': { shortcuts: [
    { keys: 'Ctrl + D', label: 'Fill down', priority: 7 },
    { keys: 'Ctrl + B', label: 'Bold', priority: 5 },
  ] },
  'slides.google.com': { shortcuts: [
    { keys: 'Ctrl + D', label: 'Duplicate slide', priority: 4 },
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

async function holdCtrl() {
  fireDoc('keydown', { key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true });
  await sleep(650); // long-press is 500 ms
  fireDoc('keyup', { key: 'Control', code: 'ControlLeft' }); // release trigger opens it
  await sleep(50);
}
function panelAndText() {
  const host = docEl.children.find((c) => c.tagName === 'DIV');
  const panel = host._shadow.children.find((c) => c.classList.contains('panel'));
  return { panel, text: panel.textContent };
}

test('spreadsheet path shows Sheets shortcuts, not Docs', async () => {
  await sleep(20); // let the DB load via the worker path
  await holdCtrl();
  const { panel, text } = panelAndText();
  assert.ok(panel.classList.contains('visible'), 'panel should be visible');
  assert.ok(text.includes('SHEETS.GOOGLE.COM'), 'section should be titled SHEETS.GOOGLE.COM');
  assert.ok(text.includes('Fill down'), 'Sheets shortcuts should be shown');
  assert.ok(!text.includes('Word count'), 'Docs shortcuts must not leak into a spreadsheet');
});

test('document path shows Docs shortcuts, not Sheets', async () => {
  // Close the overlay, switch to a Docs document URL, reopen.
  fireDoc('keydown', { key: 'Escape', code: 'Escape' });
  await sleep(50);
  global.window.location.pathname = '/document/d/xyz789/edit';
  await holdCtrl();
  const { panel, text } = panelAndText();
  assert.ok(panel.classList.contains('visible'), 'panel should be visible');
  assert.ok(text.includes('DOCS.GOOGLE.COM'), 'section should be titled DOCS.GOOGLE.COM');
  assert.ok(text.includes('Word count'), 'Docs shortcuts should be shown');
  assert.ok(!text.includes('Fill down'), 'Sheets shortcuts must not leak into a document');
});
