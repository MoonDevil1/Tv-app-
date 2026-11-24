const STORE_KEY = 'northstar.playlist.v1';
const THEME_KEY = 'northstar.theme.v1';
const LIVE_PLAYLIST = 'https://livetgtv.lovable.app/api/public/playlist.m3u';
const LIVE_CHANNELS = 'https://livetgtv.lovable.app/api/public/channels';

let state = { channels: [], groups: [], selectedGroup: 'All channels', playlistUrl: '', playlistName: '', sources: [], sourceIndex: 0, hls: null, shaka: null };

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function validHttpUrl(value) { return /^https?:\/\//i.test(String(value || '').trim()); }

function attribute(line, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = line.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s,]+))`, 'i'));
  return match ? String(match[1] ?? match[2] ?? match[3] ?? '').trim() : '';
}

function streamType(raw) {
  const text = String(raw || '').toLowerCase();
  if (/\.m3u8(?:$|[?#&])|[?&](?:type|format)=m3u8(?:&|$)/.test(text)) return 'hls';
  if (/\.mpd(?:$|[?#&])|[?&](?:type|format)=mpd(?:&|$)/.test(text)) return 'dash';
  if (/\.(?:mp4|m4v)(?:$|[?#&])/.test(text)) return 'mp4';
  return null;
}

function headerName(raw) {
  return ({ 'user-agent': 'User-Agent', referer: 'Referer', referrer: 'Referer', origin: 'Origin', cookie: 'Cookie', authorization: 'Authorization' })[String(raw).trim().toLowerCase()] || '';
}

function parseEntryHeaders(lines) {
  const headers = {};
  const add = (name, value) => { const key = headerName(name); const clean = String(value || '').trim(); if (key && clean) headers[key] = clean; };
  for (const line of lines) {
    if (/^#EXTHTTP:/i.test(line)) {
      const payload = line.slice(line.indexOf(':') + 1).trim();
      try { const parsed = JSON.parse(payload); const values = parsed?.headers && typeof parsed.headers === 'object' ? parsed.headers : parsed; if (values && typeof values === 'object') Object.entries(values).forEach(([key, value]) => add(key, value)); }
      catch { for (const pair of payload.split(/[&;]/)) { const i = pair.indexOf('='); if (i > 0) { try { add(decodeURIComponent(pair.slice(0, i)), decodeURIComponent(pair.slice(i + 1))); } catch {} } } }
    } else if (/^#EXTVLCOPT:http-(?:user-agent|referrer|origin|cookie|authorization)=/i.test(line)) {
      const i = line.indexOf('='); const option = line.slice(0, i).toLowerCase().replace('#extvlcopt:http-', ''); add(option, line.slice(i + 1));
    }
  }
  return headers;
}

function channelId(url, tvgId, name) {
  try { const liveId = new URL(url).searchParams.get('liveid'); if (liveId) return `liveid:${liveId}`; } catch {}
  return tvgId ? `tvg:${tvgId}` : `name:${name}`;
}

function parseM3U(input) {
  const lines = String(input || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = lines.find(line => /^#EXTM3U\b/i.test(line.trim())) || '';
  const channels = []; let entry = null;
  const finish = () => {
    if (!entry?.url) { entry = null; return; }
    const type = streamType(entry.url); if (!type) { entry = null; return; }
    const comma = entry.info.indexOf(','); const label = comma >= 0 ? entry.info.slice(comma + 1).trim() : '';
    const name = attribute(entry.info, 'tvg-name') || label; if (!name) { entry = null; return; }
    const headers = parseEntryHeaders(entry.extras);
    channels.push({ id: channelId(entry.url, attribute(entry.info, 'tvg-id'), name), name, logo: attribute(entry.info, 'tvg-logo'), group: attribute(entry.info, 'group-title') || 'Other', url: entry.url, type, headers, requiresDrm: entry.extras.some(line => /^#KODIPROP:.*(?:license_(?:type|key)|drm)/i.test(line)), requiresAuthorization: Object.keys(headers).some(key => /^(cookie|authorization)$/i.test(key)) });
    entry = null;
  };
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    if (/^#EXTINF:/i.test(line)) { finish(); entry = { info: line, extras: [] }; }
    else if (entry && line.startsWith('#')) entry.extras.push(line);
    else if (entry && /^https?:\/\//i.test(line)) { entry.url = line; finish(); }
  }
  finish();
  return { channels, epgUrl: attribute(header, 'url-tvg') || attribute(header, 'x-tvg-url') };
}

function normalizeDrm(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const type = String(raw.type || '').toLower; 
}

async function fetchText(url, headers = {}) {
  const response = await window.northstar.fetchText(url, headers);
  if (!response.ok) throw new Error(response.error || `Request failed (${response.status || 'network'})`);
  return response.text;
}

async function loadPlaylist(url, name, persist = true) {
  if (!validHttpUrl(url)) { showNotice('emptyNotice', 'Enter a playlist URL beginning with http:// or https://.'); return; }
  showNotice('emptyNotice', 'Loading playlist…');
  try {
    const text = await fetchText(url, { Accept: 'audio/x-mpegurl, application/x-mpegURL, text/plain, */*' });
    const parsed = parseM3U(text);
    if (!parsed.channels.length) throw new Error('No supported HLS, DASH or MP4 channels were found.');
    state = { ...state, channels: parsed.channels, groups: ['All channels', ...Array.from(new Set(parsed.channels.map(c => c.group))).sort((a, b) => a.localeCompare(b))], selectedGroup: 'All channels', playlistUrl: url, playlistName: name };
    renderChannels(); $('#playlistDialog').close();
    if (persist) localStorage.setItem(STORE_KEY, JSON.stringify({ url, name }));
  } catch (error) { showNotice('emptyNotice', error.message || 'Playlist could not be loaded.'); }
}

function showNotice(id, text) { const element = document.getElementById(id); if (element) element.textContent = text; }

function renderChannels() {
  $('#emptyView').classList.add('hidden'); $('#channelView').classList.remove('hidden');
  $('#playlistLabel').textContent = state.playlistName;
  $('#channelCount').textContent = `${state.channels.length} channels · choose a station to tune in`;
  $('#groups').replaceChildren(...state.groups.map(group => { const button = document.createElement('button'); button.className = `chip focusable${group === state.selectedGroup ? ' active' : ''}`; button.textContent = group; button.onclick = () => { state.selectedGroup = group; renderChannels(); }; return button; }));
  const visible = state.channels.filter(channel => state.selectedGroup === 'All channels' || channel.group === state.selectedGroup);
  $('#channelGrid').replaceChildren(...visible.map((channel, index) => {
    const card = document.createElement('button'); card.className = 'channel focusable'; card.tabIndex = index === 0 ? 0 : -1;
    card.innerHTML = `<div class="logoBox">${channel.logo ? `<img src="${escapeHtml(channel.logo)}" alt="" />` : `<span>${escapeHtml(channel.name.slice(0, 1).toUpperCase())}</span>`}</div><div class="channelName">${escapeHtml(channel.name)}</div><div class="channelGroup">${escapeHtml(channel.requiresDrm ? 'DRM' : channel.group)}</div>`;
    card.onclick = () => openChannel(channel); return card;
  }));
}

function escapeHtml(value) { const node = document.createElement('div'); node.textContent = String(value); return node.innerHTML; }

async function openChannel(channel) {
  state.sources = []; state.sourceIndex = 0;
  $('#playerTitle').textContent = channel.name; $('#playerSubtitle').textContent = channel.group; $('#sourceLabel').textContent = 'Loading stream details…'; $('#videoMessage').classList.add('hidden');
  $('#playerDialog').showModal();
  try {
    let detail = null; const id = channel.id.replace(/^(?:liveid|tvg):/, '');
    if (id && !channel.id.startsWith('name:')) {
      try { const text = await fetchText(`${LIVE_CHANNELS}/${encodeURIComponent(id)}`, { Accept: 'application/json', 'Cache-Control': 'no-cache' }); detail = typeof text === 'string' ? JSON.parse(text) : text; } catch {}
    }
    const sources = Array.isArray(detail?.sources) ? detail.sources.filter(validHttpUrl) : [];
    const links = sources.length ? sources : (!channel.requiresDrm ? [channel.url] : []);
    if (!links.length) throw new Error('The provider did not return a playable stream URL.');
    state.sources = links.map((uri, index) => ({ uri, type: streamType(uri) || channel.type, headers: { ...channel.headers, ...(detail?.headers || {}) }, drm: detail?.drm, label: links.length > 1 ? `Source ${index + 1}` : channel.name }));
    $('#nextSource').classList.toggle('hidden', state.sources.length < 2); await playSource();
  } catch (error) { showVideoError(error.message || 'Could not load this channel.'); }
}

async function playSource() {
  const video = $('#video'); const source = state.sources[state.sourceIndex]; if (!source) return;
  cleanupPlayer(); $('#videoMessage').classList.add('hidden'); $('#sourceLabel').textContent = source.label;
  try {
    if (source.type === 'hls' && Hls.isSupported()) {
      state.hls = new Hls({ xhrSetup: xhr => Object.entries(source.headers).forEach(([key, value]) => xhr.setRequestHeader(key, value)) });
      state.hls.loadSource(source.uri); state.hls.attachMedia(video); state.hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) showVideoError(`HLS playback failed: ${data.details}`); });
    } else if (source.type === 'dash') {
      if (!window.shaka) throw new Error('DASH playback support is unavailable.');
      shaka.polyfill.installAll(); state.shaka = new shaka.Player(); await state.shaka.attach(video);
      if (source.drm) configureDrm(state.shaka, source.drm);
      await state.shaka.load(source.uri);
    } else {
      video.src = source.uri; await video.play().catch(() => {});
    }
  } catch (error) { showVideoError(error.message || 'Playback failed. Try another source.'); }
}

function configureDrm(player, drm) {
  const type = String(drm?.type || '').toLowerCase();
  if (type === 'clearkey') {
    const keys = drm.clearKeys && typeof drm.clearKeys === 'object' ? drm.clearKeys : (drm.keyId && drm.key ? { [drm.keyId]: drm.key } : null);
    if (keys && Object.values(keys).every(key => /^[a-f\d]{32}$/i.test(key))) player.configure({ drm: { clearKeys: keys } });
  } else if (/^https?:\/\//i.test(drm?.licenseServer || drm?.licenseUrl || '')) {
    const servers = { [type === 'widevine' ? 'com.widevine.alpha' : type === 'playready' ? 'com.microsoft.playready' : type]: drm.licenseServer || drm.licenseUrl }; player.configure({ drm: { servers } });
  }
}

function cleanupPlayer() {
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  if (state.shaka) { state.shaka.destroy(); state.shaka = null; }
  const video = $('#video'); video.removeAttribute('src'); video.load();
}

function showVideoError(message) { $('#videoMessage').textContent = message; $('#videoMessage').classList.remove('hidden'); }

function setTheme(theme) { document.documentElement.dataset.theme = theme; localStorage.setItem(THEME_KEY, theme); }

function init() {
  setTheme(localStorage.getItem(THEME_KEY) || 'dark');
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]'); if (!target) return;
    if (target.dataset.action === 'add') { $('#dialogNotice').textContent = ''; $('#playlistUrl').value = state.playlistUrl; $('#playlistDialog').showModal(); }
    if (target.dataset.action === 'settings') $('#settingsDialog').showModal();
    if (target.dataset.action === 'demo') loadPlaylist(LIVE_PLAYLIST, 'LiveTGTV · test playlist');
    if (target.dataset.action === 'refresh') loadPlaylist(state.playlistUrl, state.playlistName);
  });
  $('#loadPlaylist').onclick = () => loadPlaylist($('#playlistUrl').value.trim(), 'My playlist');
  $$('.themeButton').forEach(button => button.onclick = () => setTheme(button.dataset.theme));
  $('#closePlayer').onclick = () => { cleanupPlayer(); $('#playerDialog').close(); };
  $('#nextSource').onclick = () => { state.sourceIndex = (state.sourceIndex + 1) % state.sources.length; playSource(); };
  $('#playerDialog').addEventListener('cancel', cleanupPlayer);

  const saved = localStorage.getItem(STORE_KEY); if (saved) { try { const item = JSON.parse(saved); state.playlistUrl = item.url || ''; state.playlistName = item.name || ''; if (item.url) loadPlaylist(item.url, item.name || 'My playlist', false); } catch {} }
}

window.addEventListener('DOMContentLoaded', init);
