const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let serverProcess;
let mainWindow;
const PORT = 4173;

function waitForServer(url, attempts = 80) {
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, res => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(500, () => req.destroy());
    };
    const retry = () => {
      if (--attempts <= 0) return reject(new Error('Trinity Control server did not start.'));
      setTimeout(tryOnce, 150);
    };
    tryOnce();
  });
}

async function createWindow() {
  const appRoot = app.getAppPath();
  const serverPath = path.join(appRoot, 'server.mjs');
  const dataDir = path.join(app.getPath('userData'), 'data');

  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      TRINITY_DATA_DIR: dataDir,
      PORT: String(PORT)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', data => console.log(String(data)));
  serverProcess.stderr.on('data', data => console.error(String(data)));

  try {
    await waitForServer(`http://127.0.0.1:${PORT}/api/state`);
  } catch (error) {
    dialog.showErrorBox('Trinity Control could not start', error.message);
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0c1017',
    title: 'Trinity Control',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
