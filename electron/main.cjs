const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  net,
  shell
} = require('electron');

const { autoUpdater } = require('electron-updater');

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const crypto = require('crypto');
const ffmpegPath = require('ffmpeg-static');

let parseFileFn = null;
async function getParseFile() {
  if (parseFileFn) return parseFileFn;
  try {
    const mm = require('music-metadata');
    parseFileFn = mm.parseFile;
  } catch {
    const mm = await import('music-metadata');
    parseFileFn = mm.parseFile;
  }
  return parseFileFn;
}

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'aac', 'm4a', 'mp4', 'mp2', 'mpa', 'ogg', 'oga', 'opus',
  'wma', 'amr', 'ra', 'ram', 'flac', 'wav', 'wave', 'aiff', 'aif',
  'alac', 'ape', 'wv', 'tta', 'tak', 'ofr', 'ofs', 'shn', 'ac3',
  'eac3', 'dts', 'caf', 'au', 'snd', 'webm', 'mka', 'mkv'
]);

let win = null;
let library = [];
let tracksById = new Map();
let libraryRoot = null;
let settingsPath = null;
let updateInfo = { status: 'idle', version: app.getVersion(), availableVersion: null, percent: 0, error: null };
let updateCheckStarted = false;

function broadcastUpdate(event, payload = {}) {
  updateInfo = { ...updateInfo, ...payload };
  if (win && !win.isDestroyed()) win.webContents.send(event, updateInfo);
}

function configureAutoUpdater() {
  if (!app.isPackaged || updateCheckStarted) return;
  updateCheckStarted = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('checking-for-update', () => broadcastUpdate('app-update:checking', { status: 'checking', error: null }));
  autoUpdater.on('update-available', info => broadcastUpdate('app-update:available', { status: 'available', availableVersion: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', info => broadcastUpdate('app-update:latest', { status: 'latest', version: info.version, availableVersion: null }));
  autoUpdater.on('download-progress', progress => broadcastUpdate('app-update:downloading', { status: 'downloading', percent: Math.round(progress.percent || 0) }));
  autoUpdater.on('update-downloaded', info => broadcastUpdate('app-update:downloaded', { status: 'downloaded', availableVersion: info.version, percent: 100 }));
  autoUpdater.on('error', error => {
    console.error('Desktop update error:', error);
    broadcastUpdate('app-update:error', { status: 'error', error: error.message || 'Update check failed.' });
  });
  autoUpdater.checkForUpdates().catch(error => {
    console.error('Unable to check desktop updates:', error);
    broadcastUpdate('app-update:error', { status: 'error', error: error.message || 'Update check failed.' });
  });
}

const conversionCache = new Map();

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'music',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

function isAudioFile(file) {
  const extension = path.extname(file).slice(1).toLowerCase();
  return AUDIO_EXTENSIONS.has(extension);
}

function collectAudioFiles(root) {
  const files = [];

  function walk(directory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      console.warn('Cannot read directory:', directory, error.message);
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && isAudioFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

async function getAudioMetadata(file) {
  try {
    const parseFile = await getParseFile();
    return await parseFile(file, { duration: true, skipCovers: false });
  } catch (error) {
    console.warn('Metadata unavailable:', path.basename(file), error.message);
    return null;
  }
}

function detectImageMimeFromBytes(buffer, fallbackFormat = '') {
  if (buffer && buffer.length >= 4) {
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4E &&
      buffer[3] === 0x47
    ) {
      return 'image/png';
    }
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'image/jpeg';
    }
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46
    ) {
      return 'image/webp';
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return 'image/gif';
    }
  }

  const value = String(fallbackFormat || '').trim().toLowerCase();
  if (value === 'image/png' || value === 'png') return 'image/png';
  if (value === 'image/webp' || value === 'webp') return 'image/webp';
  if (value === 'image/gif' || value === 'gif') return 'image/gif';
  if (value.startsWith('image/')) return value;
  return 'image/jpeg';
}

function runFFmpegCoverArgs(args) {
  return new Promise(resolve => {
    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
      resolve(null);
      return;
    }

    const proc = spawn(ffmpegPath, args);
    const chunks = [];

    proc.stdout.on('data', chunk => chunks.push(chunk));
    proc.on('error', () => resolve(null));
    proc.on('close', code => {
      if (code === 0 && chunks.length > 0) {
        const buffer = Buffer.concat(chunks);
        if (buffer.length > 32) {
          resolve({
            data: Uint8Array.from(buffer),
            mimeType: detectImageMimeFromBytes(buffer),
            kind: 'coverFront'
          });
          return;
        }
      }
      resolve(null);
    });
  });
}

async function extractCoverWithFFmpeg(file) {
  const direct = await runFFmpegCoverArgs([
    '-hide_banner',
    '-loglevel', 'error',
    '-i', file,
    '-an',
    '-vcodec', 'copy',
    '-frames:v', '1',
    '-f', 'image2pipe',
    'pipe:1'
  ]);
  if (direct) return direct;

  return runFFmpegCoverArgs([
    '-hide_banner',
    '-loglevel', 'error',
    '-i', file,
    '-an',
    '-frames:v', '1',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    'pipe:1'
  ]);
}

async function findFolderCover(file) {
  try {
    const dir = path.dirname(file);
    const base = path.basename(file, path.extname(file));
    const candidates = [
      `${base}.jpg`,
      `${base}.jpeg`,
      `${base}.png`,
      `${base}.webp`,
      'cover.jpg',
      'cover.jpeg',
      'cover.png',
      'folder.jpg',
      'folder.jpeg',
      'folder.png',
      'album.jpg',
      'front.jpg'
    ];

    for (const name of candidates) {
      const candidatePath = path.join(dir, name);
      if (fs.existsSync(candidatePath)) {
        const buffer = await fs.promises.readFile(candidatePath);
        if (buffer.length > 32) {
          return {
            data: Uint8Array.from(buffer),
            mimeType: detectImageMimeFromBytes(buffer),
            kind: 'coverFront'
          };
        }
      }
    }
  } catch {}
  return null;
}

async function scanFiles(files) {
  const found = [];
  tracksById = new Map();
  const uniqueFiles = [...new Set(files)];

  for (const file of uniqueFiles) {
    try {
      if (!fs.existsSync(file)) continue;
      if (!isAudioFile(file)) continue;

      const metadata = await getAudioMetadata(file);
      const common = metadata?.common || {};
      const format = metadata?.format || {};
      const extension = path.extname(file).slice(1).toUpperCase();

      const id = crypto
        .createHash('sha1')
        .update(file)
        .digest('hex')
        .slice(0, 16);

      const track = {
        id,
        title: common.title || path.basename(file, path.extname(file)),
        artist: common.artist || common.albumartist || 'Unknown Artist',
        album: common.album || 'Unknown Album',
        duration: Number(format.duration) || 0,
        extension,
        filename: path.basename(file),
        coverUrl: null,
        bitrate: Number(format.bitrate) || 0,
        sampleRate: Number(format.sampleRate) || 0,
        channels: Number(format.numberOfChannels) || 0
      };

      tracksById.set(id, file);
      found.push(track);
    } catch (error) {
      console.error('Unable to add audio file:', file, error.message);
    }
  }

  library = found;
  console.log(`Music library scanned: ${library.length} tracks`);
  return library;
}

function getConversionDirectory() {
  return path.join(app.getPath('userData'), 'converted-audio');
}

async function convertM4AToMP3(file) {
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    throw new Error('FFmpeg executable was not found. Check ffmpeg-static installation.');
  }

  const stats = await fs.promises.stat(file);
  const hash = crypto
    .createHash('sha256')
    .update(`${file}:${stats.size}:${stats.mtimeMs}`)
    .digest('hex');

  const conversionDirectory = getConversionDirectory();
  const outputFile = path.join(conversionDirectory, `${hash}.mp3`);

  if (fs.existsSync(outputFile)) return outputFile;
  if (conversionCache.has(hash)) return conversionCache.get(hash);

  const conversionJob = (async () => {
    await fs.promises.mkdir(conversionDirectory, { recursive: true });

    await new Promise((resolve, reject) => {
      const args = [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', file,
        '-map', '0:a:0',
        '-vn',
        '-codec:a', 'libmp3lame',
        '-q:a', '2',
        '-ar', '44100',
        outputFile
      ];

      const proc = spawn(ffmpegPath, args);
      let errorOutput = '';

      proc.stderr.on('data', data => {
        errorOutput += data.toString();
      });

      proc.on('error', error => reject(error));

      proc.on('close', code => {
        if (code === 0 && fs.existsSync(outputFile)) {
          resolve();
        } else {
          reject(new Error(`FFmpeg conversion failed: ${errorOutput.slice(-2000)}`));
        }
      });
    });

    return outputFile;
  })();

  conversionCache.set(hash, conversionJob);

  try {
    return await conversionJob;
  } catch (error) {
    try {
      await fs.promises.unlink(outputFile);
    } catch {}
    throw error;
  } finally {
    conversionCache.delete(hash);
  }
}

async function getPlayableAudioFile(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.m4a') {
    return convertM4AToMP3(file);
  }
  return file;
}

function saveSettings() {
  if (!settingsPath) return;
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ libraryRoot }, null, 2), 'utf8');
  } catch (error) {
    console.error('Unable to save settings:', error.message);
  }
}

async function scanSavedLibrary() {
  if (!libraryRoot || !fs.existsSync(libraryRoot)) {
    library = [];
    tracksById.clear();
    return [];
  }
  const files = collectAudioFiles(libraryRoot);
  return scanFiles(files);
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#0b0b10',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.once('ready-to-show', () => win.show());

  if (!app.isPackaged) {
    await win.loadURL('http://127.0.0.1:5173');
  } else {
    await win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.on('closed', () => {
    win = null;
  });
}

function registerMusicProtocol() {
  protocol.handle('music', async request => {
    try {
      const url = new URL(request.url);
      const id = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
      const originalFile = tracksById.get(id);

      if (!originalFile || !fs.existsSync(originalFile)) {
        return new Response('Track not found. Rescan your library.', { status: 404 });
      }

      const playableFile = await getPlayableAudioFile(originalFile);
      if (!fs.existsSync(playableFile)) {
        return new Response('Audio file could not be prepared.', { status: 404 });
      }

      return net.fetch(pathToFileURL(playableFile).toString());
    } catch (error) {
      console.error('Music playback error:', error);
      return new Response(`Unable to play audio: ${error.message}`, { status: 500 });
    }
  });
}

ipcMain.handle('music:choose-folder', async () => {
  if (!win) return library;
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return library;
  libraryRoot = result.filePaths[0];
  saveSettings();
  return scanSavedLibrary();
});

ipcMain.handle('music:choose-files', async () => {
  if (!win) return library;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Audio Files', extensions: [...AUDIO_EXTENSIONS] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return library;
  const existingFiles = [...tracksById.values()];
  return scanFiles([...existingFiles, ...result.filePaths]);
});

ipcMain.handle('music:scan-library', async () => library);
ipcMain.handle('music:rescan-library', async () => scanSavedLibrary());

ipcMain.handle('music:read-track-bytes', async (_event, id) => {
  const trackId = String(id);
  const filePath = tracksById.get(trackId);
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('The selected local audio file is unavailable. Rescan your music folder.');
  }
  const bytes = await fs.promises.readFile(filePath);
  return Uint8Array.from(bytes);
});

ipcMain.handle('music:read-track-cover', async (_event, id) => {
  const trackId = String(id);
  const filePath = tracksById.get(trackId);
  if (!filePath || !fs.existsSync(filePath)) return null;

  try {
    const metadata = await getAudioMetadata(filePath);
    const pictures = metadata?.common?.picture || [];
    if (pictures.length > 0) {
      const front =
        pictures.find(p => /front/i.test(String(p.type || ''))) ||
        pictures.find(p => p?.data?.length > 32) ||
        pictures[0];
      if (front?.data?.length > 32) {
        const cleanBytes = Uint8Array.from(front.data);
        return {
          data: cleanBytes,
          mimeType: detectImageMimeFromBytes(cleanBytes, front.format),
          kind: 'coverFront'
        };
      }
    }
  } catch (error) {
    console.warn('music-metadata cover fallback failed:', error.message);
  }

  const ffmpegCover = await extractCoverWithFFmpeg(filePath);
  if (ffmpegCover) return ffmpegCover;

  return findFolderCover(filePath);
});

ipcMain.handle('music:url', (_event, id) => {
  const trackId = String(id);
  if (!tracksById.has(trackId)) {
    throw new Error('This track is no longer in the library. Rescan your folder.');
  }
  return `music://track/${encodeURIComponent(trackId)}`;
});

ipcMain.handle('music:supported-formats', () =>
  [...AUDIO_EXTENSIONS].map(format => format.toUpperCase())
);

ipcMain.handle('music:library-info', () => ({
  libraryRoot,
  totalTracks: library.length,
  supportedFormats: [...AUDIO_EXTENSIONS]
}));

ipcMain.handle('app-update:get-state', () => ({ ...updateInfo, version: app.getVersion(), packaged: app.isPackaged }));
ipcMain.handle('app-update:check', async () => {
  if (!app.isPackaged) return { ...updateInfo, packaged: false, message: 'Updates are checked in installed builds.' };
  try { await autoUpdater.checkForUpdates(); return { ...updateInfo, version: app.getVersion(), packaged: true }; }
  catch (error) { broadcastUpdate('app-update:error', { status: 'error', error: error.message || 'Update check failed.' }); return { ...updateInfo, packaged: true }; }
});
ipcMain.handle('app-update:install', () => {
  if (updateInfo.status !== 'downloaded') return false;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
});
ipcMain.handle('app-update:open-releases', () => shell.openExternal('https://github.com/jaswin-dev/MusicLoverPlayer-desktop/releases/latest'));

ipcMain.handle('music:conversion-status', () => ({
  ffmpegAvailable: Boolean(ffmpegPath && fs.existsSync(ffmpegPath)),
  conversionsInProgress: conversionCache.size
}));

app.whenReady().then(async () => {
  try {
    settingsPath = path.join(app.getPath('userData'), 'library.json');
    try {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      libraryRoot = saved.libraryRoot || null;
    } catch {
      libraryRoot = null;
    }

    registerMusicProtocol();
    await scanSavedLibrary();
    await createWindow();
    configureAutoUpdater();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow();
      }
    });
  } catch (error) {
    console.error('Application startup error:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  library = [];
  tracksById.clear();
});
