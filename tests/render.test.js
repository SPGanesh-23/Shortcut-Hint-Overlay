// renderKeyCombo (popup.js, extracted verbatim): sequences and alternatives
// must render as separate keys, not one big key.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { El } = require('./fake-dom');

const root = path.join(__dirname, '..');
const popupSrc = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

function loadRenderKeyCombo() {
  const start = popupSrc.indexOf('function renderKeyCombo');
  const end = popupSrc.indexOf('\ndocument.addEventListener', start);
  assert.ok(start >= 0 && end > start, 'renderKeyCombo not found in popup.js');
  // The function only needs document.createElement / createDocumentFragment.
  const documentStub = {
    createElement: (t) => new El(t),
    createDocumentFragment: () => new El('#frag'),
  };
  const fn = new Function('document', `${popupSrc.slice(start, end)}\nreturn renderKeyCombo;`);
  return fn(documentStub);
}

const renderKeyCombo = loadRenderKeyCombo();

function serialize(el) {
  // [text] for every element that carries text (kbd chips and separators).
  let out = '';
  if (el._text) out += `[${el._text}]`;
  for (const ch of el.children) out += serialize(ch);
  return out;
}

const cases = [
  ['G, D', '[G][→][D]'],
  ['Tab then Q', '[Tab][→][Q]'],
  ['S or /', '[S][or][/]'],
  ['K / Space', '[K][or][Space]'],
  ['Ctrl + /', '[Ctrl][+][/]'],
  ['Ctrl + +', '[Ctrl][+][+]'],
  ['/', '[/]'],
  ['Ctrl + Shift + T', '[Ctrl][+][Shift][+][T]'],
  ['← / →', '[←][or][→]'],
];

for (const [input, expected] of cases) {
  test(`renderKeyCombo(${JSON.stringify(input)})`, () => {
    assert.equal(serialize(renderKeyCombo(input)), expected);
  });
}

test('content.js uses the same alt-separator rule as the popup', () => {
  const contentSrc = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  assert.ok(
    contentSrc.includes('str.split(/\\s+\\/\\s+|\\s+or\\s+/i)'),
    'content.js renderKeyCombo should split on " / " and " or "',
  );
});
