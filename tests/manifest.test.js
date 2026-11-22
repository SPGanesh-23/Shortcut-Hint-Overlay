// Manifest + referenced files: the extension must be loadable as-is.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('manifest is Manifest V3 with a version', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+(\.\d+)?$/, 'version is dotted numbers; a 4th part is allowed for testing patches like 0.1.9.1');
  assert.ok(manifest.name);
  assert.ok(manifest.description);
});

test('every file the manifest mentions exists', () => {
  const files = new Set();
  for (const cs of manifest.content_scripts || []) files.add(...(cs.js || []));
  if (manifest.background) files.add(manifest.background.service_worker);
  if (manifest.action) files.add(manifest.action.default_popup);
  if (manifest.options_ui) files.add(manifest.options_ui.page);
  for (const group of Object.values(manifest.icons || {})) files.add(group);
  for (const group of Object.values((manifest.action || {}).default_icon || {})) files.add(group);
  for (const war of manifest.web_accessible_resources || []) {
    files.add(...(war.resources || []));
  }
  assert.ok(files.size > 0);
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(root, f)), `missing file referenced by manifest: ${f}`);
  }
});

test('icons are real PNGs at the right sizes', () => {
  for (const [size, file] of Object.entries(manifest.icons)) {
    const buf = fs.readFileSync(path.join(root, file));
    // PNG signature
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // Width / height are stored big-endian at bytes 16-23 of a PNG.
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert.equal(width, Number(size), `${file} width`);
    assert.equal(height, Number(size), `${file} height`);
  }
});

test('permissions are the documented minimal set', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'storage', 'tabs']);
});
