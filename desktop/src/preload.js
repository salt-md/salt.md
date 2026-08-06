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

// The window has no title bar on macOS — the traffic lights are drawn INSIDE
// it, over whatever the page puts in its top-left corner. With the sidebar open
// that corner is empty and it looks right; collapsed, they land on the tab bar
// and on the page title.
//
// THE APP CARRIES THIS FIX, not the server.
//
// The first version put the rules in Salt.md's own stylesheet, which was wrong
// in a way that only shows up later: the app would then look broken against
// every instance that has not been updated yet — and pointing this app at an
// older server is the normal case, not the exception. A window's own layout is
// the window's problem.
//
// Injected as a stylesheet rather than scripted: contextIsolation means this
// file shares no JS context with the page, and the DOM is the one thing both
// can see.

// macOS draws the traffic lights at roughly x 12-70, y 12-32 with this title
// bar style. Both numbers below come from that rectangle rather than from
// taste — the first two attempts guessed and were wrong in both directions.
const DESKTOP_CSS = `
/* Collapsed: the content starts at the left edge, so the corner is cleared
   sideways — the row is short and there is nothing to push down. */
html[data-desktop='mac'] .app.sidebar-collapsed .tab-bar,
html[data-desktop='mac'] .app.sidebar-collapsed .topbar {
  padding-left: 78px;
}

/* Open: the sidebar owns the corner and its first row is the workspace
   switcher, which sat straight under the buttons. Cleared downwards rather
   than sideways — an indented switcher in a full-width sidebar looks like a
   mistake, while a little air above it looks like a title bar, which is what
   the space is. */
html[data-desktop='mac'] .app:not(.sidebar-collapsed) .sidebar-header {
  padding-top: 38px;
}

/* The strip beside the buttons drags the window, the way a title bar would.
   Without it a window with no title bar moves only by its edges. */
html[data-desktop='mac'] .tab-bar { -webkit-app-region: drag; }
html[data-desktop='mac'] .tab-bar .tab,
html[data-desktop='mac'] .tab-bar button { -webkit-app-region: no-drag; }
`;

function apply() {
  const html = document.documentElement;
  if (!html) return;
  html.setAttribute('data-desktop', process.platform === 'darwin' ? 'mac' : 'other');
  if (process.platform !== 'darwin') return;
  if (document.getElementById('salt-desktop-css')) return;
  const style = document.createElement('style');
  style.id = 'salt-desktop-css';
  style.textContent = DESKTOP_CSS;
  (document.head || html).appendChild(style);
}

// Both, because neither alone covers every load: at document-start there may be
// no <head> yet, and on a page that is already parsed DOMContentLoaded has been
// and gone.
apply();
document.addEventListener('DOMContentLoaded', apply);
