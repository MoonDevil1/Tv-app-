# Northstar TV

A remote-first Android TV starter app for importing and playing M3U playlists. It includes a minimal dark-first interface, playlist categories, a light/dark setting, channel playback, and a one-tap LiveTGTV playlist test source.

## Run

Requires Node 18+ and Android Studio/SDK for a native TV build.

```sh
npm install
npm start
# Android TV device/emulator
npm run android:tv
```

The project uses Expo with `react-native-tvos` and `react-native-video`. For a real TV target, build and test the native Android app on the TV emulator/device; streaming format and DRM support depend on the Android player/device codecs and the provider's lawful entitlement.

## Playlists

- Use **Try LiveTGTV** on the welcome screen to load `https://livetgtv.lovable.app/api/public/playlist.m3u`.
- Or choose **Add playlist** and enter an M3U URL. Playlist URL and theme are kept locally on the device.
- Parses `#EXTINF` names/logos/groups, HLS (`.m3u8`), MPEG-DASH (`.mpd`) and MP4 entries, standard HTTP header directives, and LiveTGTV's `liveid` wrapper links.
- When a channel has a LiveTGTV ID, the app requests its public channel-detail endpoint for fresh stream URLs and the provider-declared DRM metadata. DRM/license configuration is passed to the native player, not decrypted or logged by this app. An encrypted channel without valid provider-supplied DRM configuration will show an explanatory error rather than attempting a fallback that bypasses protection.

Only add playlists and streams you are authorized to access. The LiveTGTV endpoint is a test integration and can change or be unavailable; this starter does not guarantee service availability or that a given device supports every codec/DRM system.

## Tests

```sh
npm test
```
