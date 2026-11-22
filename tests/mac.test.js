// Mac key localisation: on Mac, displayed keys must say Cmd / Option
// instead of Ctrl / Alt. The stored data stays in Windows form; only the
// rendered keys change. The extension's own trigger stays Ctrl.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { El } = require('./fake-dom');

const root = path.join(__dirname, '..');
const popupSrc = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

function loadPopupRender(navigatorStub) {
  const start = popupSrc.indexOf('const IS_MAC');
  const end = popupSrc.indexOf('\ndocument.addEventListener', start);
  assert.ok(start >= 0 && end > start, 'renderKeyCombo not found in popup.js');
  const documentStub = {
    createElement: (t) => new El(t),
    createDocumentFragment: () => new El('#frag'),
  };
  const fn = new Function(
    'document', 'navigator',
    `${popupSrc.slice(start, end)}\nreturn { renderKeyCombo, IS_MAC };`,
  );
  return fn(documentStub, navigatorStub);
}

function serialize(el) {
  let out = '';
  if (el._text) out += `[${el._text}]`;
  for (const ch of el.children) out += serialize(ch);
  return out;
}

test('popup on Mac renders Cmd / Option', () => {
  const { renderKeyCombo, IS_MAC } = loadPopupRender({ platform: 'MacIntel' });
  assert.equal(IS_MAC, true);
  assert.equal(serialize(renderKeyCombo('Ctrl + T')), '[Cmd][+][T]');
  assert.equal(serialize(renderKeyCombo('Alt + ←')), '[Option][+][←]');
  assert.equal(serialize(renderKeyCombo('Ctrl + Shift + T')), '[Cmd][+][Shift][+][T]');
  assert.equal(serialize(renderKeyCombo('G, D')), '[G][→][D]', 'non-modifier keys unchanged');
});

test('popup on Windows still renders Ctrl / Alt', () => {
  const { renderKeyCombo, IS_MAC } = loadPopupRender({ platform: 'Win32' });
  assert.equal(IS_MAC, false);
  assert.equal(serialize(renderKeyCombo('Ctrl + T')), '[Ctrl][+][T]');
  assert.equal(serialize(renderKeyCombo('Alt + ←')), '[Alt][+][←]');
});

// --- Overlay on a Mac: load the real content.js with a Mac navigator -----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const contentSrc = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
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
// Node 24 exposes global.navigator as a getter-only property, so assign
// via defineProperty instead of a plain assignment.
Object.defineProperty(global, 'navigator', {
  value: { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  configurable: true,
});
global.window = {
  innerWidth: 1200,
  innerHeight: 800,
  location: { hostname: 'github.com' },
  addEventListener() {},
  removeEventListener() {},
};
global.location = global.window.location;
global.chrome = {
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  storage: { sync: { get: (d, cb) => cb({ ...d }) }, onChanged: { addListener() {} } },
};
global.fetch = async () => ({ json: async () => ({}) });

eval(contentSrc);

test('overlay on Mac shows Cmd / Option in the Chrome section', async () => {
  await sleep(20);
  docListeners.keydown.forEach((f) => f({
    key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true,
    preventDefault() {}, stopImmediatePropagation() {}, stopPropagation() {},
  }));
  await sleep(650);
  const host = docEl.children.find((c) => c.tagName === 'DIV');
  const panel = host._shadow.children.find((c) => c.classList.contains('panel'));
  assert.ok(panel.classList.contains('visible'));
  const text = panel.textContent;
  // textContent concatenates the <kbd> chips and "+" separators with no
  // spaces, so the rendered keys read "Cmd+T" / "Option+←" here.
  assert.match(text, /Cmd\+T/, 'New tab should show Cmd + T on Mac');
  assert.match(text, /Option\+←/, 'Back should show Option + ← on Mac');
  assert.doesNotMatch(text, /Ctrl\+T/, 'no Windows Ctrl + T on Mac');
});
