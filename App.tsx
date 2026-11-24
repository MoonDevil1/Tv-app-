import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, BackHandler, FlatList, Image, Modal, Pressable,
  SafeAreaView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Video from 'react-native-video';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import {
  LIVE_TGTV_CHANNELS, LIVE_TGTV_PLAYLIST, parseM3U, normalizeDrm,
  streamType, apiId, validHttpUrl,
} from './src/playlist';

const STORE_KEY = 'northstar.playlist.v1';
const THEME_KEY = 'northstar.dark.v1';
const DARK = { bg: '#090c11', panel: '#121720', panel2: '#1a2230', text: '#f4f6fb', muted: '#99a5b5', accent: '#8aabff', border: '#293344' };
const LIGHT = { bg: '#eef2f8', panel: '#ffffff', panel2: '#e5ebf4', text: '#151923', muted: '#596476', accent: '#355fe5', border: '#d3dbe8' };

function Button({ title, onPress, theme, secondary = false, compact = false }) {
  return (
    <Pressable onPress={onPress} focusable accessibilityRole="button"
      style={({ focused, pressed }) => [styles.button, compact && styles.buttonCompact,
        { backgroundColor: secondary ? theme.panel2 : theme.accent, borderColor: focused ? theme.text : secondary ? theme.border : theme.accent },
        focused && styles.focused, pressed && styles.pressed]}>
      <Text style={[styles.buttonText, { color: secondary ? theme.text : '#07101f' }]}>{title}</Text>
    </Pressable>
  );
}

export default function App() {
  const [dark, setDark] = useState(true);
  const theme = dark ? DARK : LIGHT;
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [channels, setChannels] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('All channels');
  const [dialog, setDialog] = useState(false);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [player, setPlayer] = useState(null);
  const [streamOptions, setStreamOptions] = useState([]);
  const [streamIndex, setStreamIndex] = useState(0);
  const [playerBusy, setPlayerBusy] = useState(false);
  const [playbackError, setPlaybackError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [saved, savedDark] = await Promise.all([AsyncStorage.getItem(STORE_KEY), AsyncStorage.getItem(THEME_KEY)]);
        if (savedDark !== null) setDark(savedDark === 'true');
        if (saved) {
          const item = JSON.parse(saved);
          setPlaylistUrl(item.url || '');
          setPlaylistName(item.name || '');
          if (item.url) await loadPlaylist(item.url, item.name || 'My playlist', false);
        }
      } catch { setMessage('Could not restore the saved playlist. Import it again to continue.'); }
    })();
  }, []);

  useEffect(() => {
    if (!player) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setPlayer(null); return true; });
    return () => sub.remove();
  }, [player]);

  async function loadPlaylist(url, name, persist = true) {
    if (!validHttpUrl(url)) { setMessage('Enter a playlist URL beginning with http:// or https://.'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await fetch(url, { headers: { Accept: 'audio/x-mpegurl, application/x-mpegURL, text/plain, */*' } });
      if (!response.ok) throw new Error(`Playlist request failed (${response.status}).`);
      const parsed = parseM3U(await response.text());
      if (!parsed.channels.length) throw new Error('No supported HLS, DASH or MP4 channels were found in this M3U playlist.');
      const categories = ['All channels', ...Array.from(new Set(parsed.channels.map(channel => channel.group))).sort((a, b) => a.localeCompare(b))];
      setChannels(parsed.channels); setGroups(categories); setSelectedGroup('All channels');
      setPlaylistUrl(url); setPlaylistName(name); setDialog(false); setMessage(`${parsed.channels.length} channels · ${name}`);
      if (persist) await AsyncStorage.setItem(STORE_KEY, JSON.stringify({ url, name }));
    } catch (error) {
      setMessage(error?.message || 'Playlist could not be loaded. Check the URL and try again.');
    } finally { setBusy(false); }
  }

  async function useDemo() {
    setPlaylistUrl(LIVE_TGTV_PLAYLIST);
    await loadPlaylist(LIVE_TGTV_PLAYLIST, 'LiveTGTV · test playlist');
  }

  async function openChannel(channel) {
    setPlayer(channel); setStreamOptions([]); setStreamIndex(0); setPlaybackError(''); setPlayerBusy(true);
    try {
      let detail = null;
      const id = apiId(channel.id);
      if (id && !id.startsWith('name:')) {
        try {
          const response = await fetch(`${LIVE_TGTV_CHANNELS}/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
          if (response.ok) {
            const value = await response.json();
            detail = typeof value === 'string' ? JSON.parse(value) : value;
          }
        } catch { /* Ordinary M3U URLs remain playable when the optional detail service is offline. */ }
      }
      const drm = normalizeDrm(detail?.drm);
      if (channel.requiresDrm && !drm) throw new Error('This channel requires DRM information from its provider, but none was returned.');
      const sources = Array.isArray(detail?.sources) ? detail.sources.filter(validHttpUrl).map(link => link.trim()) : [];
      const links = sources.length ? sources : (!channel.requiresDrm ? [channel.url] : []);
      if (!links.length) throw new Error('The provider did not return a playable stream URL.');
      const headers = { ...channel.headers, ...(detail?.headers && typeof detail.headers === 'object' ? detail.headers : {}) };
      const options = links.map((uri, index) => ({
        uri, type: streamType(uri) || channel.type, headers,
        ...(drm ? { drm } : {}), label: sources.length > 1 ? `Source ${index + 1}` : channel.name,
      }));
      setStreamOptions(options);
    } catch (error) { setPlaybackError(error?.message || 'Could not load this channel.'); }
    finally { setPlayerBusy(false); }
  }

  async function changeTheme(value) {
    setDark(value);
    try { await AsyncStorage.setItem(THEME_KEY, String(value)); } catch {}
  }

  const visibleChannels = useMemo(() => channels.filter(channel => selectedGroup === 'All channels' || channel.group === selectedGroup), [channels, selectedGroup]);
  const currentStream = streamOptions[streamIndex];

  return (
    <SafeAreaView style={[styles.app, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <ExpoStatusBar style={dark ? 'light' : 'dark'} />
      <View style={styles.topbar}>
        <View><Text style={[styles.brand, { color: theme.text }]}>NORTHSTAR<Text style={{ color: theme.accent }}> / TV</Text></Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>{playlistName || 'Your screen, your channels'}</Text></View>
        <View style={styles.topActions}>
          <Button title="⚙  Settings" onPress={() => setSettings(true)} theme={theme} secondary compact />
          <Button title="＋  Add playlist" onPress={() => { setMessage(''); setDialog(true); }} theme={theme} />
        </View>
      </View>

      {channels.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: theme.panel, borderColor: theme.border }]}>
          <Text style={styles.eyebrow}>MADE FOR THE BIG SCREEN</Text>
          <Text style={[styles.hero, { color: theme.text }]}>Everything live.{ '\n' }Nothing in the way.</Text>
          <Text style={[styles.body, { color: theme.muted }]}>Add an M3U playlist to browse channels with your remote. LiveTGTV is wired up as a one-tap test source.</Text>
          <View style={styles.row}><Button title="＋  Add playlist" onPress={() => setDialog(true)} theme={theme} /><Button title="▶  Try LiveTGTV" onPress={useDemo} theme={theme} secondary /></View>
          {busy && <ActivityIndicator color={theme.accent} style={{ marginTop: 24 }} />}
          {message ? <Text style={[styles.notice, { color: theme.muted }]}>{message}</Text> : null}
        </View>
      ) : (
        <View style={styles.content}>
          <View style={styles.headingRow}><View><Text style={[styles.sectionTitle, { color: theme.text }]}>Live channels</Text><Text style={[styles.subtitle, { color: theme.muted }]}>{channels.length} channels · choose a station to tune in</Text></View>
            <Button title="↻  Refresh" onPress={() => loadPlaylist(playlistUrl, playlistName)} theme={theme} secondary compact /></View>
          <FlatList horizontal data={groups} keyExtractor={item => item} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupList} renderItem={({ item }) => <Pressable focusable onPress={() => setSelectedGroup(item)} style={({ focused }) => [styles.groupChip, { backgroundColor: item === selectedGroup ? theme.accent : theme.panel, borderColor: focused ? theme.text : theme.border }, focused && styles.focused]}><Text style={{ color: item === selectedGroup ? '#07101f' : theme.text, fontWeight: '700' }}>{item}</Text></Pressable>} />
          <FlatList data={visibleChannels} keyExtractor={item => item.id} numColumns={4} contentContainerStyle={styles.grid} columnWrapperStyle={styles.gridRow} renderItem={({ item, index }) => (
            <Pressable focusable onPress={() => openChannel(item)} style={({ focused }) => [styles.channel, { backgroundColor: theme.panel, borderColor: focused ? theme.accent : theme.border }, focused && styles.focused]}>
              <View style={[styles.logoBox, { backgroundColor: theme.panel2 }]}>{item.logo ? <Image source={{ uri: item.logo }} resizeMode="contain" style={styles.logo} /> : <Text style={[styles.logoFallback, { color: theme.accent }]}>{item.name.slice(0, 1).toUpperCase()}</Text>}</View>
              <Text numberOfLines={1} style={[styles.channelName, { color: theme.text }]}>{item.name}</Text>
              <Text numberOfLines={1} style={[styles.channelGroup, { color: theme.muted }]}>{item.requiresDrm ? 'DRM' : item.group}</Text>
            </Pressable>
          )} />
          {message ? <Text style={[styles.notice, { color: theme.muted }]}>{message}</Text> : null}
        </View>
      )}

      <Modal visible={dialog} transparent animationType="fade" onRequestClose={() => setDialog(false)}>
        <View style={styles.scrim}><View style={[styles.modalCard, { backgroundColor: theme.panel, borderColor: theme.border }]}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>Add a playlist</Text><Text style={[styles.body, { color: theme.muted }]}>Paste an M3U URL. HLS, MPEG-DASH and MP4 entries are recognized.</Text>
          <TextInput value={playlistUrl} onChangeText={setPlaylistUrl} placeholder="https://example.com/playlist.m3u" placeholderTextColor={theme.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" selectTextOnFocus style={[styles.input, { color: theme.text, backgroundColor: theme.bg, borderColor: theme.border }]} />
          <View style={styles.row}><Button title={busy ? 'Loading…' : 'Load playlist'} onPress={() => loadPlaylist(playlistUrl, 'My playlist')} theme={theme} /><Button title="Cancel" onPress={() => setDialog(false)} theme={theme} secondary /></View>
          {message ? <Text style={[styles.notice, { color: theme.muted }]}>{message}</Text> : null}
        </View></View>
      </Modal>

      <Modal visible={settings} transparent animationType="fade" onRequestClose={() => setSettings(false)}>
        <View style={styles.scrim}><View style={[styles.modalCard, { backgroundColor: theme.panel, borderColor: theme.border }]}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>Settings</Text><Text style={[styles.body, { color: theme.muted }]}>Appearance</Text>
          <View style={styles.row}><Button title="☾  Dark theme" onPress={() => changeTheme(true)} theme={theme} secondary={dark} /><Button title="☼  Light theme" onPress={() => changeTheme(false)} theme={theme} secondary={!dark} /></View>
          <View style={{ marginTop: 20 }}><Button title="Done" onPress={() => setSettings(false)} theme={theme} /></View>
        </View></View>
      </Modal>

      <Modal visible={Boolean(player)} animationType="fade" onRequestClose={() => setPlayer(null)}>
        <SafeAreaView style={[styles.playerScreen, { backgroundColor: '#05070a' }]}>
          <View style={styles.playerTop}><View><Text style={styles.playerTitle}>{player?.name}</Text><Text style={styles.playerSubtitle}>{player?.group}</Text></View><Button title="✕  Close" onPress={() => setPlayer(null)} theme={DARK} secondary compact /></View>
          <View style={styles.videoBox}>
            {currentStream ? <Video key={currentStream.uri} source={{ uri: currentStream.uri, type: currentStream.type, headers: currentStream.headers, drm: currentStream.drm }} style={styles.video} controls resizeMode="contain" onError={() => setPlaybackError('Playback failed. Try another source or check that the stream is available.')} onLoad={() => setPlaybackError('')} /> : playerBusy ? <ActivityIndicator size="large" color={DARK.accent} /> : <Text style={styles.playError}>{playbackError || 'Stream unavailable.'}</Text>}
          </View>
          <View style={styles.playerBottom}><Text style={styles.playerSubtitle}>{currentStream?.label || playbackError || 'Loading stream details…'}</Text>{streamOptions.length > 1 ? <Button title="Next source  ›" onPress={() => setStreamIndex((streamIndex + 1) % streamOptions.length)} theme={DARK} secondary compact /> : null}</View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, paddingHorizontal: 48, paddingTop: 20, paddingBottom: 18 },
  topbar: { minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 },
  brand: { fontSize: 20, fontWeight: '900', letterSpacing: 2.4 }, subtitle: { fontSize: 13, marginTop: 5 }, topActions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  button: { minHeight: 48, minWidth: 132, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, buttonCompact: { minHeight: 42, minWidth: 0, paddingHorizontal: 15 }, buttonText: { fontSize: 14, fontWeight: '800' }, focused: { borderWidth: 3, transform: [{ scale: 1.035 }] }, pressed: { opacity: 0.78 },
  empty: { flex: 1, borderRadius: 24, borderWidth: 1, justifyContent: 'center', alignItems: 'flex-start', paddingHorizontal: '10%', paddingVertical: 36 }, eyebrow: { color: '#91adff', fontSize: 11, letterSpacing: 2.5, fontWeight: '900' }, hero: { fontSize: 48, lineHeight: 56, fontWeight: '900', marginTop: 16, letterSpacing: -1 }, body: { fontSize: 15, lineHeight: 23, maxWidth: 580, marginTop: 14 }, row: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 24 }, notice: { marginTop: 16, fontSize: 13 },
  content: { flex: 1 }, headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { fontSize: 27, fontWeight: '900' }, groupList: { gap: 9, paddingVertical: 18 }, groupChip: { paddingHorizontal: 16, height: 40, borderRadius: 20, borderWidth: 1, justifyContent: 'center' }, grid: { gap: 14, paddingBottom: 28 }, gridRow: { gap: 14 }, channel: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 15, padding: 11 }, logoBox: { height: 82, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, logo: { width: '78%', height: '78%' }, logoFallback: { fontSize: 34, fontWeight: '900' }, channelName: { marginTop: 10, fontSize: 14, fontWeight: '800' }, channelGroup: { marginTop: 3, fontSize: 11 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', alignItems: 'center', padding: 24 }, modalCard: { width: '72%', maxWidth: 680, borderRadius: 20, borderWidth: 1, padding: 28 }, modalTitle: { fontSize: 25, fontWeight: '900' }, input: { height: 54, borderWidth: 1, borderRadius: 10, marginTop: 20, paddingHorizontal: 14, fontSize: 15 },
  playerScreen: { flex: 1, paddingHorizontal: 34, paddingVertical: 18 }, playerTop: { height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, playerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' }, playerSubtitle: { color: '#aab4c2', fontSize: 13, marginTop: 4 }, videoBox: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', marginVertical: 8 }, video: { width: '100%', height: '100%' }, playError: { color: '#e7eaf0', padding: 24, textAlign: 'center', fontSize: 15 }, playerBottom: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
