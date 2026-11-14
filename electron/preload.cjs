const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicLover', {
  chooseFolder: () =>
    ipcRenderer.invoke('music:choose-folder'),

  chooseFiles: () =>
    ipcRenderer.invoke('music:choose-files'),

  scanLibrary: () =>
    ipcRenderer.invoke('music:scan-library'),

  rescanLibrary: () =>
    ipcRenderer.invoke('music:rescan-library'),

  getTrackUrl: (id) =>
    ipcRenderer.invoke('music:url', id),

  // Return the selected local audio file bytes through a validated track ID.
  readTrackBytes: (id) =>
    ipcRenderer.invoke('music:read-track-bytes', id),

  // Fallback cover extraction via music-metadata / FFmpeg / folder art in the main process.
  readTrackCover: (id) =>
    ipcRenderer.invoke('music:read-track-cover', id),

  getSupportedFormats: () =>
    ipcRenderer.invoke('music:supported-formats'),

  getLibraryInfo: () =>
    ipcRenderer.invoke('music:library-info'),

  getConversionStatus: () =>
    ipcRenderer.invoke('music:conversion-status'),

  getUpdateState: () => ipcRenderer.invoke('app-update:get-state'),
  checkForUpdate: () => ipcRenderer.invoke('app-update:check'),
  downloadUpdate: () => ipcRenderer.invoke('app-update:download'),
  installUpdate: () => ipcRenderer.invoke('app-update:install'),
  openReleasesPage: () => ipcRenderer.invoke('app-update:open-releases'),
  onUpdateEvent: callback => {
    const events = ['app-update:checking', 'app-update:available', 'app-update:latest', 'app-update:downloading', 'app-update:downloaded', 'app-update:error'];
    const listeners = events.map(name => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(name, listener);
      return [name, listener];
    });
    return () => listeners.forEach(([name, listener]) => ipcRenderer.removeListener(name, listener));
  }
});
