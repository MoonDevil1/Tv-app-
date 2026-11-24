const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#090c11',
    autoHideMenuBar: true,
    title: 'Northstar TV',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

ipcMain.handle('northstar-fetch', async (_event, url, headers = {}) => {
  try {
    const response = await net.fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Northstar-TV/1.0', ...headers },
    });
    return { ok: response.ok, status: response.status, text: await response.text() };
  } catch (error) {
    return { ok: false, status: 0, text: '', error: error.message || 'Network request failed' };
  }
});
