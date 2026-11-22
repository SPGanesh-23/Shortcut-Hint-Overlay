// Search / filter in the overlay (v0.1.2): loads the real content.js with
// the fake DOM, holds Ctrl to open the overlay, and exercises filtering,
// no-match, Esc-to-clear, reopen, "/" to focus, and click-to-lock.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { El } = require('./fake-dom');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Fake browser environment -------------------------------------------
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

// Load the real content script.
eval(src);

let host;
let shadow;
let panel;
let search;
const rows = () => panel.querySelectorAll('.shortcut-row');
const visibleRows = () => rows().filter((r) => r.style.display !== 'none');

async function holdCtrl() {
  fireDoc('keydown', { key: 'Control', code: 'ControlLeft', repeat: false, ctrlKey: true });
  await sleep(650); // long-press is 500 ms
  host = docEl.children.find((c) => c.tagName === 'DIV');
  shadow = host._shadow;
  panel = shadow.children.find((c) => c.classList.contains('panel'));
  search = panel.querySelector('.search-input');
}

test('overlay opens on a Ctrl long-press and has a search box', async () => {
  await sleep(20); // let the DB fetch resolve
  await holdCtrl();
  assert.ok(host, 'host element should be created');
  assert.ok(panel.classList.contains('visible'), 'panel should be visible');
  assert.ok(search, 'search input should exist');
  assert.equal(search.placeholder, 'Search shortcuts…  ( / to focus )');
  assert.equal(rows().length, 30, 'GitHub (6) + Chrome (24) rows');
});

test('filter finds a collapsed "View more" row', async () => {
  // Lock first (search is meant for the locked state).
  fireDoc('keydown', { key: ' ', code: 'Space', ctrlKey: true });
  assert.ok(panel.classList.contains('locked'));
  search.value = 'issues';
  search.dispatch('input', {});
  const vis = visibleRows();
  assert.equal(vis.length, 1);
  assert.ok(vis[0].textContent.includes('Go to Issues'));
});

test('filter matches keys and labels, and shows a no-match state', async () => {
  search.value = 'go to';
  search.dispatch('input', {});
  assert.equal(visibleRows().length, 2);
  search.value = 'zzzz';
  search.dispatch('input', {});
  assert.equal(visibleRows().length, 0);
  const empty = panel.querySelector('.empty-state');
  assert.ok(empty, 'no-match message should appear');
  assert.match(empty.textContent, /No shortcuts match "zzzz"/);
});

test('first Esc clears the search, second Esc closes the overlay', async () => {
  search.value = 'issues';
  search.dispatch('input', {});
  shadow.activeElement = search; // simulate focus in the search box
  fireDoc('keydown', { key: 'Escape' });
  assert.equal(search.value, '');
  assert.equal(visibleRows().length, 30);
  assert.ok(panel.classList.contains('locked'), 'overlay should stay open after first Esc');
  shadow.activeElement = null;
  fireDoc('keydown', { key: 'Escape' });
  assert.ok(!panel.classList.contains('visible'), 'overlay should close after second Esc');
});

test('search is cleared when the overlay reopens', async () => {
  await holdCtrl();
  assert.equal(search.value, '');
  assert.equal(visibleRows().length, 30);
});

test('"/" focuses the search box when locked, and clicking it locks', async () => {
  fireDoc('keydown', { key: ' ', code: 'Space', ctrlKey: true });
  assert.ok(panel.classList.contains('locked'));
  shadow.activeElement = null;
  fireDoc('keydown', { key: '/' });
  assert.equal(shadow.activeElement, search, '"/" should focus the search box');
  fireDoc('keydown', { key: 'Escape' }); // close
  await holdCtrl(); // reopen, visible but not locked
  assert.ok(!panel.classList.contains('locked'));
  search.click();
  assert.ok(panel.classList.contains('locked'), 'clicking the search box should lock');
});
