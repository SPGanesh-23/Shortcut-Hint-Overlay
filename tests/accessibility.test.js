// Accessibility (v0.1.4): the overlay must be usable by keyboard and
// screen readers — dialog role, list/listitem rows with labels, a
// lock button with aria-pressed, a View more toggle with aria-expanded,
// and Arrow/Home/End navigation between visible rows.
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
const DB = {
  'github.com': { shortcuts: [
    { keys: 'G, D', label: 'Go to homepage', priority: 5 },
    { keys: 'G, I', label: 'Go to Issues', priority: 8 },
    { keys: 'S', label: 'Focus search bar', priority: 2 },
    { keys: '/', label: 'Focus search bar', priority: 3 },
    { keys: 'T', label: 'Open file finder', priority: 4 },
    { keys: '?', label: 'Show all keyboard shortcuts', priority: 1 },
  ] },
};
global.fetch = async () => ({ json: async () => DB });

eval(src);

let host;
let shadow;
let panel;
let search;
let lockIcon;

async function openAndLock() {
  await sleep(20);
  fireDoc('keydown', { key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true });
  await sleep(650);
  // Release trigger: a clean hold opens the overlay locked.
  fireDoc('keyup', { key: 'Control', code: 'ControlLeft' });
  await sleep(50);
  host = docEl.children.find((c) => c.tagName === 'DIV');
  shadow = host._shadow;
  panel = shadow.children.find((c) => c.classList.contains('panel'));
  search = panel.querySelector('.search-input');
  lockIcon = panel.querySelector('.lock-icon');
  assert.ok(panel.classList.contains('locked'), 'overlay should be locked');
}

function panelKey(key) {
  panel.dispatch('keydown', {
    key,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
  });
}

test('panel is a dialog and rows are labelled list items', async () => {
  await openAndLock();
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(panel.getAttribute('aria-label'), 'Keyboard Shortcuts');
  const lists = panel.querySelectorAll('.shortcut-list');
  assert.ok(lists.length >= 1);
  assert.ok(lists.every((l) => l.getAttribute('role') === 'list'));
  const rows = panel.querySelectorAll('.shortcut-row');
  assert.equal(rows.length, 30);
  assert.ok(rows.every((r) => r.getAttribute('role') === 'listitem'));
  assert.ok(rows.every((r) => r.tabIndex === -1, 'roving tabindex starts at -1'));
  const first = rows.find((r) => r.textContent.includes('Go to Issues'));
  assert.ok(first.getAttribute('aria-label').includes('Go to Issues'));
});

test('lock icon is a button with aria-pressed', () => {
  assert.equal(lockIcon.getAttribute('role'), 'button');
  assert.equal(lockIcon.getAttribute('aria-pressed'), 'true');
  assert.equal(lockIcon.getAttribute('aria-label'), 'Lock overlay open');
});

test('View more toggle reports its expanded state', () => {
  const toggle = panel.querySelector('.toggle-more-btn');
  assert.ok(toggle, 'a View more toggle should exist');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  const controlled = toggle.getAttribute('aria-controls');
  assert.ok(controlled, 'toggle should name the container it controls');
  const extras = panel.querySelectorAll('.extra-shortcuts');
  assert.ok(extras.some((e) => e.id === controlled), 'controlled id should be an extra container in the panel');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('locking moves keyboard focus into the search box', () => {
  assert.equal(shadow.activeElement, search);
});

test('ArrowDown / ArrowUp / Home / End walk the visible rows', () => {
  // Only the top 3 rows of each section are visible (the rest are behind
  // "View more"), so the last visible row is Chrome's 3rd shortcut.
  const rows = panel.querySelectorAll('.shortcut-row');
  const firstVisible = rows[0];
  const lastVisible = rows.find((r) => r.textContent.includes('Reopen last closed tab'));
  assert.ok(lastVisible, 'expected a visible Reopen-last-closed-tab row');
  // Focus starts in the search box, so Down goes to the first row.
  panelKey('ArrowDown');
  assert.equal(shadow.activeElement, firstVisible);
  assert.equal(firstVisible.tabIndex, 0);
  panelKey('ArrowDown');
  assert.equal(shadow.activeElement, rows[1]);
  panelKey('ArrowUp');
  assert.equal(shadow.activeElement, firstVisible);
  panelKey('End');
  assert.equal(shadow.activeElement, lastVisible);
  panelKey('Home');
  assert.equal(shadow.activeElement, firstVisible);
});
