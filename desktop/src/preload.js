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

// The window has no title bar on macOS — the traffic lights sit INSIDE it, over
// whatever the page draws in its top-left corner. With the sidebar open that is
// empty space and it looks right; collapsed, they land on the tab bar and on
// the page title, which is what he saw.
//
// The page cannot know that on its own, so it is told. An attribute rather than
// anything scripted: contextIsolation means this file shares no JS context with
// the page, and the DOM is the one thing both can see. Salt.md's CSS keys off
// it and reserves the corner.
//
// Set as early as the document exists, so there is no frame where the tabs are
// drawn under the buttons.
const mark = () => document.documentElement.setAttribute('data-desktop', process.platform === 'darwin' ? 'mac' : 'other');
if (document.documentElement) mark();
document.addEventListener('DOMContentLoaded', mark);
