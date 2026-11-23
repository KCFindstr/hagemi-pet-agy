const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { join } = require('node:path');

function getArg(prefix) {
  const found = process.argv.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

const targetUrl = getArg('--url=');
const parentPid = Number(getArg('--parent-pid=')) || 0;

if (!targetUrl) {
  process.exit(1);
}

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let win = null;

function syncBounds() {
  if (!win || win.isDestroyed()) return;
  const area = screen.getPrimaryDisplay().workArea;
  win.setBounds(area);
}

function isParentAlive(pid) {
  if (!pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

app.whenReady().then(() => {
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });

  win.loadURL(targetUrl).catch(() => app.quit());

  screen.on('display-metrics-changed', syncBounds);
  screen.on('display-added', syncBounds);
  screen.on('display-removed', syncBounds);

  ipcMain.on('hagemi:hit', (_event, interactive) => {
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(!interactive, { forward: true });
    }
  });

  if (parentPid > 0) {
    const timer = setInterval(() => {
      if (!isParentAlive(parentPid)) {
        clearInterval(timer);
        app.quit();
      }
    }, 3000);
    timer.unref?.();
  }
});

process.stdin.on('end', () => app.quit());
process.stdin.on('close', () => app.quit());
app.on('window-all-closed', () => app.quit());
