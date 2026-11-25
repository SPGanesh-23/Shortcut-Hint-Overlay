// Background worker serves the shortcuts DB (v0.1.8): content scripts ask
// it for the DB instead of fetching directly, because strict page CSPs
// (e.g. accounts.google.com) block a direct fetch with "Failed to fetch".
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const realDb = JSON.parse(fs.readFileSync(path.join(root, 'shortcuts-db.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let fetchCalls = 0;
let onMessageListener = null;
global.fetch = async (url) => {
  fetchCalls += 1;
  assert.ok(String(url).endsWith('shortcuts-db.json'), `unexpected fetch ${url}`);
  return { json: async () => realDb };
};
global.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://x/${p}`,
    onInstalled: { addListener() {} },
    onMessage: { addListener: (fn) => { onMessageListener = fn; } },
  },
  tabs: {
    onUpdated: { addListener() {} },
    onActivated: { addListener() {} },
    get: async () => null,
  },
  action: { disable: async () => {}, enable: async () => {} },
};

eval(src);

test('background worker returns the shortcuts DB to content scripts', async () => {
  assert.equal(typeof onMessageListener, 'function', 'onMessage listener should be registered');
  let answer = null;
  const replied = onMessageListener({ type: 'get-shortcuts-db' }, {}, (data) => { answer = data; });
  assert.equal(replied, true, 'listener should return true for an async response');
  await sleep(20);
  assert.ok(answer, 'worker should answer with the DB');
  assert.equal(Object.keys(answer).length, 107, 'DB should have 107 sites');
  assert.equal(answer['github.com'].shortcuts.length, 14, 'GitHub should have 14 shortcuts');
});

test('background worker caches the DB and ignores unknown messages', async () => {
  const callsBefore = fetchCalls;
  let answer = null;
  onMessageListener({ type: 'get-shortcuts-db' }, {}, (data) => { answer = data; });
  await sleep(20);
  assert.ok(answer, 'second request should also be answered');
  assert.equal(fetchCalls, callsBefore, 'DB should be fetched once and cached');
  const replied = onMessageListener({ type: 'something-else' }, {}, () => {});
  assert.equal(replied, false, 'unknown message types should not claim an async response');
});
