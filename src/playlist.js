const { Buffer } = require('buffer');

const LIVE_TGTV_PLAYLIST = 'https://livetgtv.lovable.app/api/public/playlist.m3u';
const LIVE_TGTV_CHANNELS = 'https://livetgtv.lovable.app/api/public/channels';
const LIVE_TGTV_BACKUP = 'https://hjh-545.pages.dev/';

function attr(line, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = line.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s,]+))`, 'i'));
  return match ? String(match[1] ?? match[2] ?? match[3] ?? '').trim() : '';
}

function streamType(raw) {
  let candidate = String(raw || '').toLowerCase();
  try {
    const parsed = new URL(raw);
    candidate += ` ${parsed.searchParams.get('url') || ''}`;
  } catch {}
  if (/\.m3u8(?:$|[?#&])|[?&](?:type|format)=m3u8(?:&|$)/.test(candidate)) return 'm3u8';
  if (/\.mpd(?:$|[?#&])|[?&](?:type|format)=mpd(?:&|$)/.test(candidate)) return 'mpd';
  if (/\.(?:mp4|m4v)(?:$|[?#&])/.test(candidate)) return 'mp4';
  return null;
}

function headerName(raw) {
  const key = raw.trim().toLowerCase();
  return ({ 'user-agent': 'User-Agent', referer: 'Referer', referrer: 'Referer', origin: 'Origin', cookie: 'Cookie', authorization: 'Authorization' })[key] || '';
}

function parseEntryHeaders(extras) {
  const headers = {};
  const add = (name, value) => {
    const key = headerName(name);
    const clean = String(value || '').trim();
    if (key && clean && !/[\r\n]/.test(key + clean)) headers[key] = clean;
  };
  for (const line of extras) {
    if (/^#EXTHTTP:/i.test(line)) {
      const payload = line.slice(line.indexOf(':') + 1).trim();
      try {
        const parsed = JSON.parse(payload);
        const values = parsed?.headers && typeof parsed.headers === 'object' ? parsed.headers : parsed;
        if (values && typeof values === 'object' && !Array.isArray(values)) {
          Object.entries(values).forEach(([key, value]) => {
            if (typeof value === 'string' || typeof value === 'number') add(key, value);
          });
        }
      } catch {
        for (const pair of payload.split(/[&;]/)) {
          const index = pair.indexOf('=');
          if (index > 0) {
            try { add(decodeURIComponent(pair.slice(0, index)), decodeURIComponent(pair.slice(index + 1))); } catch {}
          }
        }
      }
    } else if (/^#EXTVLCOPT:http-(?:user-agent|referrer|origin|cookie|authorization)=/i.test(line)) {
      const index = line.indexOf('=');
      const option = line.slice(0, index).toLowerCase().replace('#extvlcopt:http-', '');
      add(option === 'user-agent' ? 'User-Agent' : option === 'referrer' ? 'Referer' : option, line.slice(index + 1));
    } else if (/^#KODIPROP:inputstream\.adaptive\.stream_headers=/i.test(line)) {
      const raw = line.slice(line.indexOf('=') + 1);
      try {
        const parsed = JSON.parse(raw);
        Object.entries(parsed || {}).forEach(([key, value]) => typeof value === 'string' && add(key, value));
      } catch {}
    }
  }
  return headers;
}

function channelId(url, tvgId, name) {
  try {
    const liveId = new URL(url).searchParams.get('liveid');
    if (liveId) return `liveid:${liveId}`;
  } catch {}
  return tvgId ? `tvg:${tvgId}` : `name:${name}`;
}

function parseM3U(input) {
  const source = String(input || '').replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  const header = lines.find(line => /^#EXTM3U\b/i.test(line.trim())) || '';
  const epgUrl = attr(header, 'url-tvg') || attr(header, 'x-tvg-url');
  const channels = [];
  let entry = null;
  const finish = () => {
    if (!entry?.url) { entry = null; return; }
    const type = streamType(entry.url);
    if (!type) { entry = null; return; }
    const comma = entry.info.indexOf(',');
    const label = comma >= 0 ? entry.info.slice(comma + 1).trim() : '';
    const name = attr(entry.info, 'tvg-name') || label;
    if (!name) { entry = null; return; }
    const headers = parseEntryHeaders(entry.extras);
    const tvgId = attr(entry.info, 'tvg-id');
    const drmDirective = entry.extras.some(line => /^#KODIPROP:.*(?:license_(?:type|key)|drm)/i.test(line));
    channels.push({
      id: channelId(entry.url, tvgId, name), name,
      logo: attr(entry.info, 'tvg-logo'),
      group: attr(entry.info, 'group-title') || 'Other',
      url: entry.url, type, headers,
      requiresDrm: drmDirective,
      requiresAuthorization: Object.keys(headers).some(key => /^(cookie|authorization)$/i.test(key)),
    });
    entry = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF:/i.test(line)) { finish(); entry = { info: line, extras: [] }; }
    else if (entry && line.startsWith('#')) entry.extras.push(line);
    else if (entry && /^https?:\/\//i.test(line)) { entry.url = line; finish(); }
  }
  finish();
  return { channels, epgUrl };
}

function apiId(id) { return String(id).replace(/^(?:liveid|tvg):/, ''); }

function normalizeDrm(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const type = String(raw.type || '').toLowerCase();
  if (!['widevine', 'playready', 'clearkey', 'fairplay'].includes(type)) return undefined;
  if (type === 'clearkey') {
    const keys = {};
    const candidates = raw.clearKeys && typeof raw.clearKeys === 'object'
      ? Object.entries(raw.clearKeys)
      : raw.keyId && raw.key ? [[raw.keyId, raw.key]] : [];
    for (const [kid, key] of candidates) {
      if (/^[a-f\d]{32}$/i.test(kid) && /^[a-f\d]{32}$/i.test(String(key))) keys[kid.toLowerCase()] = String(key).toLowerCase();
    }
    if (!Object.keys(keys).length) return undefined;
    const b64url = hex => Buffer.from(hex, 'hex').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const response = JSON.stringify({ keys: Object.entries(keys).map(([kid, key]) => ({ kty: 'oct', kid: b64url(kid), k: b64url(key) })), type: 'temporary' });
    return { type, licenseServer: `data:application/json;base64,${Buffer.from(response).toString('base64')}` };
  }
  const licenseServer = raw.licenseServer || raw.licenseUrl;
  if (!/^https?:\/\//i.test(String(licenseServer || ''))) return undefined;
  return {
    type, licenseServer,
    ...(raw.headers && typeof raw.headers === 'object' ? { headers: raw.headers } : {}),
    ...(raw.multiDrm ? { multiDrm: true } : {}),
    ...(raw.contentId ? { contentId: raw.contentId } : {}),
    ...(raw.certificateUrl ? { certificateUrl: raw.certificateUrl } : {}),
    ...(raw.base64Certificate ? { base64Certificate: true } : {}),
  };
}

function validHttpUrl(value) { return typeof value === 'string' && /^https?:\/\//i.test(value.trim()); }

module.exports = {
  LIVE_TGTV_PLAYLIST, LIVE_TGTV_CHANNELS, LIVE_TGTV_BACKUP,
  parseM3U, normalizeDrm, streamType, apiId, validHttpUrl,
};
