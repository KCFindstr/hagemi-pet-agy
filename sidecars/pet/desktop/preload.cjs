const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__hagemiDesktop', {
  setInteractive: (interactive) => ipcRenderer.send('hagemi:hit', !!interactive),
});
