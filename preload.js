const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('northstar', {
  fetchText: (url, headers) => ipcRenderer.invoke('northstar-fetch', url, headers),
});
