const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(new URL('../renderer.js', `file://${__filename}`), 'utf8');

test('Windows app entry and playlist implementation are present', () => {
  assert.match(source, /function parseM3U/);
  assert.match(source, /LIVE_PLAYLIST/);
  assert.match(source, /async function loadPlaylist/);
  assert.match(source, /function configureDrm/);
});

test('package targets Electron for Windows', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', `file://${__filename}`), 'utf8'));
  assert.equal(pkg.main, 'main.js');
  assert.match(pkg.scripts.start, /electron/);
  assert.ok(pkg.dependencies.electron);
});
