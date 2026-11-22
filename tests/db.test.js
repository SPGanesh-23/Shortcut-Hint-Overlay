// shortcuts-db.json: every site entry must be well-formed, so a bad edit
// cannot break the overlay for everyone.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const db = JSON.parse(fs.readFileSync(path.join(root, 'shortcuts-db.json'), 'utf8'));

function entries(v) {
  return Array.isArray(v) ? v : v.shortcuts;
}

test('database has a useful number of sites and shortcuts', () => {
  const sites = Object.keys(db);
  assert.ok(sites.length >= 50, `expected >= 50 sites, got ${sites.length}`);
  const total = sites.reduce((n, s) => n + entries(db[s]).length, 0);
  assert.ok(total >= 100, `expected >= 100 shortcuts, got ${total}`);
});

test('every entry has keys and a label, and no duplicate keys per site', () => {
  for (const [site, value] of Object.entries(db)) {
    const list = entries(value);
    assert.ok(Array.isArray(list) && list.length > 0, `${site}: empty shortcut list`);
    const seen = new Set();
    for (const sc of list) {
      assert.equal(typeof sc.keys, 'string', `${site}: keys must be a string`);
      assert.ok(sc.keys.trim().length > 0, `${site}: empty keys`);
      assert.equal(typeof sc.label, 'string', `${site}: label must be a string`);
      assert.ok(sc.label.trim().length > 0, `${site}: empty label for ${sc.keys}`);
      const norm = sc.keys.replace(/\s+/g, '').toLowerCase();
      assert.ok(!seen.has(norm), `${site}: duplicate shortcut keys ${sc.keys}`);
      seen.add(norm);
    }
  }
});

test('priorities, where present, are unique per site', () => {
  for (const [site, value] of Object.entries(db)) {
    const priorities = entries(value).map((s) => s.priority).filter((p) => typeof p === 'number');
    assert.equal(new Set(priorities).size, priorities.length, `${site}: duplicate priorities`);
  }
});

test('regression: shortcuts restored in v0.1.1 are still present', () => {
  const gmail = entries(db['mail.google.com']).map((s) => s.keys);
  for (const k of ['R', 'A', '#', 'Shift + I', 'Shift + U']) {
    assert.ok(gmail.includes(k), `Gmail is missing ${k}`);
  }
  const docs = entries(db['docs.google.com']).map((s) => s.keys);
  assert.ok(docs.includes('Ctrl + K'), 'Docs is missing Ctrl + K');
  assert.ok(docs.includes('Ctrl + B'), 'Docs is missing Ctrl + B');
  const youtube = entries(db['youtube.com']).map((s) => s.keys);
  assert.ok(youtube.includes('K / Space'), 'YouTube K should be "K / Space"');
  assert.ok(youtube.includes('Shift + N'), 'YouTube is missing Shift + N');
  assert.ok(!('en.wikipedia.org' in db), 'en.wikipedia.org duplicate should not exist');
  assert.equal(entries(db['wikipedia.org']).length, 5, 'wikipedia.org should have 5 shortcuts');
});

test('regression (v0.1.3): corrected labels stay corrected', () => {
  const sheets = entries(db['sheets.google.com']);
  const altEnter = sheets.find((s) => s.keys === 'Alt+Enter');
  assert.ok(altEnter, 'Sheets Alt+Enter entry missing');
  assert.equal(altEnter.label, 'Insert line break in cell', 'Alt+Enter inserts a line break, not a note');
  const facebook = entries(db['facebook.com']);
  assert.ok(facebook.every((s) => !s.label.includes('story')), 'Facebook labels should say post, not story');
});
