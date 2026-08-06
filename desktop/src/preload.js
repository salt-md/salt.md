const { contextBridge, ipcRenderer } = require('electron');

// The entire bridge between the window and the app. Three functions, and only
// the connect page uses them — the workspace itself is an ordinary web page
// that never touches this.
//
// Deliberately not a generic `invoke(channel, ...args)`. That is the shape that
// looks tidy and hands a remote page the whole IPC surface: whatever the main
// process ever adds becomes callable by the server, and by anything that gets
// a script into it.
contextBridge.exposeInMainWorld('salt', {
  getServer: () => ipcRenderer.invoke('salt:getServer'),
  setServer: (url) => ipcRenderer.invoke('salt:setServer', url),
  forget: () => ipcRenderer.invoke('salt:forget'),
});
