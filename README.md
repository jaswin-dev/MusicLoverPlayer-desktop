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


## Desktop auto-updates (macOS and Windows)

The desktop app uses `electron-updater` with a public generic update feed hosted
in the same `jaswin-dev/MusicLoverPlayer-desktop` repository. It checks the
platform-specific metadata at app startup. When a newer version is published,
the app shows **Download update**; after the download completes, the user
selects **Restart & Update** to install it.

The desktop release workflow builds Apple Silicon macOS (ARM64) and Windows
(x64) installers separately. It uploads the installers and publishes
`latest-mac.yml` for macOS and `latest.yml` for Windows to the desktop repository. The Android
`latest.json` remains independent and is not overwritten.

### One-time setup

Add the following repository secret to this private desktop source repository:

- `UPDATE_REPO_TOKEN`: a GitHub token with permission to publish releases and
  publish releases in this repository.

The desktop repository must remain public. Never embed the token in the
desktop application or commit it to source control.

### Every future desktop update

1. Make and push source changes to `main`.
2. The workflow increments the desktop version, builds the macOS ARM64 and
   Windows x64 installers, and computes SHA-256 hashes.
3. The workflow publishes platform-specific release assets and updater metadata (`latest-mac.yml` and `latest.yml`) as GitHub Releases in this same repository.
4. Installed desktop apps detect the higher version, download the matching
   platform update, and prompt the user to restart and install.

### Platform notes

- macOS updates are delivered for Apple Silicon. For distribution outside
  your own machine, sign and notarize the app with an Apple Developer
  certificate. Configure Apple signing/notarization secrets before enabling
  notarization in the release workflow.
- Windows installers are built for x64. For distribution outside testing,
  sign the NSIS installer with a trusted code-signing certificate.
- macOS and Windows still show their normal platform installation/security
  prompts when applicable. The updater cannot silently bypass those prompts.

Workflow: [Build and publish desktop updates](https://github.com/jaswin-dev/MusicLoverPlayer-desktop/actions/workflows/desktop-release.yml)
