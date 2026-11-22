// Onboarding (v0.1.4): first install must open the welcome page once,
// and the welcome page must teach the trigger, lock, search and arrows.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('background opens welcome.html only on first install', () => {
  const src = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
  assert.match(src, /chrome\.runtime\.onInstalled/);
  assert.match(src, /details\.reason === "install"/);
  assert.match(src, /welcome\.html/);
  // Updates must not re-open it: the only reason checked is "install".
  assert.doesNotMatch(src, /reason === "update"/);
});

test('welcome page exists and teaches the four basics', () => {
  for (const f of ['welcome.html', 'welcome.css', 'welcome.js']) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} missing`);
  }
  const html = fs.readFileSync(path.join(root, 'welcome.html'), 'utf8');
  assert.match(html, /Hold <kbd>Ctrl<\/kbd>/, 'welcome must teach the Ctrl hold');
  assert.match(html, /Ctrl<\/kbd> \+ <kbd>Space<\/kbd>/, 'welcome must teach the lock combo');
  assert.match(html, /Search with <kbd>\/<\/kbd>/, 'welcome must teach / search');
  assert.match(html, /arrow keys/i, 'welcome must teach arrow-key navigation');
  assert.match(html, /No accounts, no tracking/, 'welcome must state the privacy position');
  assert.match(html, /welcome\.js/, 'welcome page must load its script');
  const js = fs.readFileSync(path.join(root, 'welcome.js'), 'utf8');
  assert.match(js, /openOptionsPage/, 'welcome must link to Options');
});
