// normalizeHost: the disabled-sites fix (v0.1.1). All three files must use
// the same rule, or disabling a site in one place silently fails elsewhere.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const contentSrc = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function loadNormalizeHost() {
  const start = contentSrc.indexOf('function normalizeHost');
  assert.ok(start >= 0, 'normalizeHost not found in content.js');
  const end = contentSrc.indexOf('\n  }', start) + '\n  }'.length;
  const fn = new Function(`${contentSrc.slice(start, end)}\nreturn normalizeHost;`);
  return fn();
}

const normalizeHost = loadNormalizeHost();

const cases = [
  ['en.wikipedia.org', 'wikipedia.org'],
  ['m.youtube.com', 'youtube.com'],
  ['www.github.com', 'github.com'],
  ['mail.google.com', 'mail.google.com'],
  ['EN.Wikipedia.org', 'wikipedia.org'],
  ['youtube.com', 'youtube.com'],
];

for (const [input, expected] of cases) {
  test(`normalizeHost(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`, () => {
    assert.equal(normalizeHost(input), expected);
  });
}

test('a stored "wikipedia.org" disables en.wikipedia.org', () => {
  const stored = ['wikipedia.org'].map(normalizeHost);
  assert.ok(stored.includes(normalizeHost('en.wikipedia.org')));
});

test('content.js, popup.js and options.js all use the same normaliser', () => {
  const rule = '/^(www|en|m)\\./';
  for (const file of ['content.js', 'popup.js', 'options.js']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(src.includes(rule), `${file} does not contain the canonical normalizeHost rule`);
  }
});
