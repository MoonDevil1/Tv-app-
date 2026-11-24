# Northstar TV for Windows

A remote-friendly Windows TV/desktop app for importing and playing M3U playlists. It supports HLS, MPEG-DASH and MP4 streams, M3U names/logos/groups, channel categories, local playlist/theme persistence, dark/light themes, and a one-tap LiveTGTV test playlist.

## Requirements

- Windows 10/11
- Node.js 18 or newer
- Internet access for remote playlists

## Run

```powershell
npm install
npm start
```

This is an Electron desktop app, with navigation and focus styling suitable for a connected TV or a regular Windows screen.

## LiveTGTV test source

Choose **Try LiveTGTV** to load:

```text
https://livetgtv.lovable.app/api/public/playlist.m3u
```

The app also fetches public LiveTGTV channel details for fresh stream URLs and provider-declared DRM metadata. HLS and MP4 use HLS.js/native video support. MPEG-DASH and supported DRM metadata use Shaka Player. DRM behavior still depends on Windows/Electron support for the stream's codec and DRM system.

## Playlists

Choose **Add playlist**, paste an M3U URL, and select **Load playlist**. Standard `#EXTINF` metadata and HTTP header directives are parsed. Authorization headers are included where applicable. DRM keys/license data are passed only to the local player implementation and are never written to the playlist store.

Only add streams you are authorized to access. LiveTGTV availability and stream availability can change.

## Test

```powershell
npm test
```
