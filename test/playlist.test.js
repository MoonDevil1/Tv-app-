const test = require('node:test');
const assert = require('node:assert/strict');
const { parseM3U, normalizeDrm, apiId, streamType } = require('../src/playlist');

const fixture = [
  '\uFEFF#EXTM3U url-tvg="https://example.test/guide.xml"',
  '#EXTINF:-1 tvg-id="news" tvg-name="News HD" tvg-logo="https://example.test/news.png" group-title="News",News',
  '#EXTVLCOPT:http-user-agent=Northstar/1.0',
  'https://cdn.example.test/live/index.m3u8',
  '#EXTINF:-1 tvg-id="sports" group-title="Sports",Sports DASH',
  'https://livetgtv.lovable.app/api/public/stream?url=https%3A%2F%2Fcdn.example.test%2Flive.mpd&liveid=channel-42&embed=1',
  '#EXTINF:-1 tvg-name="Movie" group-title="Movies",Movie',
  'https://cdn.example.test/movie.mp4',
].join('\n');

test('parses supported M3U entries, groups, EPG and safe HTTP headers', () => {
  const parsed = parseM3U(fixture);
  assert.equal(parsed.epgUrl, 'https://example.test/guide.xml');
  assert.equal(parsed.channels.length, 3);
  assert.equal(parsed.channels[0].name, 'News HD');
  assert.equal(parsed.channels[0].group, 'News');
  assert.equal(parsed.channels[0].headers['User-Agent'], 'Northstar/1.0');
  assert.equal(parsed.channels[0].type, 'm3u8');
  assert.equal(parsed.channels[1].type, 'mpd');
  assert.equal(parsed.channels[1].id, 'liveid:channel-42');
  assert.equal(parsed.channels[2].type, 'mp4');
});

test('detects nested playlist types and extracts provider API IDs', () => {
  assert.equal(streamType('https://site.test/play?url=https%3A%2F%2Fcdn.test%2Fmaster.m3u8'), 'm3u8');
  assert.equal(apiId('liveid:channel-42'), 'channel-42');
});

test('normalizes provider-declared license DRM and valid ClearKey material', () => {
  assert.deepEqual(normalizeDrm({ type: 'widevine', licenseServer: 'https://license.example.test', headers: { Authorization: 'Bearer test' } }), {
    type: 'widevine', licenseServer: 'https://license.example.test', headers: { Authorization: 'Bearer test' },
  });
  const drm = normalizeDrm({ type: 'clearkey', keyId: '00112233445566778899aabbccddeeff', key: 'ffeeddccbbaa99887766554433221100' });
  assert.equal(drm.type, 'clearkey');
  assert.match(drm.licenseServer, /^data:application\/json;base64,/);
  assert.equal(normalizeDrm({ type: 'widevine', licenseServer: 'file:///license' }), undefined);
  assert.equal(normalizeDrm({ type: 'clearkey', keyId: 'bad', key: 'bad' }), undefined);
});
