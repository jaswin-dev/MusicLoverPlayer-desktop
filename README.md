# MusicLover Player — Desktop

A local-first desktop music player that retains the MusicLover React interface and branding while replacing website/cloud features with desktop music-library functionality.

## Features

- **Local library:** choose a folder; nested folders are scanned automatically. The selected folder is remembered and rescanned on the next launch. You can also add individual audio files.
- **Playback:** play individual tracks or play a playlist sequentially; previous/next, shuffle, repeat, seek and volume controls.
- **Playlists:** create, rename, delete, add songs, remove songs and play playlists. Playlist and liked-song data are saved in local browser storage for the desktop app.
- **Live lyrics:** LRCLIB lookup uses the track title and artist; synchronized LRC timestamps are highlighted against the audio playback position. Plain lyrics are shown when synced lyrics are unavailable.
- **Metadata and artwork:** reads title, artist, album, duration and embedded cover art from local files.

## Supported file extensions

The library scanner recognizes MP3, FLAC, WAV, AAC, M4A, MP4, OGG, OGA, OPUS, WebM, AIFF, AIF, CAF, WMA, APE, WV, MPC and TTA. Actual decoding depends on the Chromium/Electron codecs available on the user's operating system. A recognized extension does not guarantee that every codec/container combination is playable.

## Requirements

- Node.js 22 LTS recommended
- macOS or Windows

## Run in development

```bash
npm install
npm start
```

## Build installers

```bash
npm run dist:mac
npm run dist:win
```

Build each platform on its target OS (or use a suitable CI runner). On macOS, Electron's postinstall step must download the matching Electron binary. If it fails, remove `node_modules` and reinstall after checking network access to GitHub release assets.

## Privacy

Music files are read from folders selected by the user and are not uploaded by this app. LRCLIB requests send the song title and artist to retrieve lyrics. Playlist and liked-song data remain in the app's local storage.
