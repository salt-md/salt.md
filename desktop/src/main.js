const { app, BrowserWindow, shell, Menu, dialog, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { normalizeURL } = require('./serverURL');

// Salt.md in its own window.
//
// This is a SHELL around a server you run — not a copy of Salt.md and not a
// local instance. You give it an address once and it opens straight into your
// workspace, in a window with no address bar and a native menu.
//
// The value over a browser tab is small and real: it opens where you left off,
// it does not sit in a row of thirty other tabs, and ⌘W closes the window
// rather than a page you were editing.
//
// Three rules shape the code below, and each one is a way the naive version
// goes wrong:
//
//  1. THE WINDOW STAYS ON YOUR INSTANCE. Anything else opens in the real
//     browser. Without this, one click on a bookmark block replaces your
//     workspace with somebody's website and there is no back button to see.
//  2. THE RENDERER GETS NO NODE. contextIsolation on, nodeIntegration off,
//     preload exposing exactly one function. A shell that loads a remote page
//     with Node in it hands that server the user's filesystem.
//  3. A SERVER THAT IS DOWN GETS A PAGE, NOT A CRASH. The failure everybody
//     hits first is a laptop opening the app on a train, and Chromium's own
//     error page is a dead end with no way back to the settings.

const store = path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(store, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(next) {
  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.writeFileSync(store, JSON.stringify(next, null, 2));
}


// ---- the sign-in window --------------------------------------------------
//
// "Open" is a five-minute door, not a mode. If a person abandons a sign-in — a
// forgotten password, a provider that hangs — the window must not be left able
// to navigate anywhere for the rest of the session.

let authOpen = false;
let authTimer = null;

/** True for the instance's own routes that BEGIN a round trip to a provider:
 *  signing in, and an admin connecting a mailbox. */
function isAuthStart(server, url) {
  return url.startsWith(server + '/api/oauth/') ||
         url.startsWith(server + '/api/admin/mail-oauth/');
}

function openAuthWindow() {
  authOpen = true;
  clearTimeout(authTimer);
  authTimer = setTimeout(closeAuthWindow, 5 * 60 * 1000);
}

function closeAuthWindow() {
  authOpen = false;
  clearTimeout(authTimer);
  authTimer = null;
}

let win = null;

function createWindow() {
  const saved = readSettings();
  win = new BrowserWindow({
    width: saved.width ?? 1280,
    height: saved.height ?? 860,
    minWidth: 700,
    minHeight: 500,
    // The traffic lights sit inside the window on macOS: Salt.md's own topbar
    // is the chrome, and a second title bar above it is a wasted stripe.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#191919',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Remember the size, not the position: a window restored onto a monitor that
  // is no longer attached is invisible with no way to fetch it back.
  const remember = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const [width, height] = win.getSize();
    writeSettings({ ...readSettings(), width, height });
  };
  win.on('resize', remember);
  win.on('close', remember);

  // RULE 1, part one: a link that wants a new window is an outside link.
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Some providers open the consent step in a popup. Mid-flow that popup is
    // part of signing in, so it belongs in this window rather than in the
    // browser — where it would finish the flow in the wrong program.
    if (authOpen && /^https?:/i.test(url)) {
      win.loadURL(url);
      return { action: 'deny' };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // RULE 1, part two: navigation inside the window may not leave the instance —
  // EXCEPT while a sign-in is running.
  //
  // Signing in with Microsoft or Google is a round trip: your instance sends the
  // browser to the provider, the provider sends it back. The naive version of
  // this rule breaks it in the middle — it sees login.microsoftonline.com,
  // decides that is not your instance, and hands the rest of the flow to the
  // real browser. The person then signs in successfully in the WRONG program:
  // the session cookie lands in the browser and the app sits on the login page
  // forever, which is exactly what it looked like.
  //
  // The gate is the FLOW, not a list of provider hostnames. A list would have to
  // name every identity provider, every asset domain they redirect through, and
  // every one they add later — and it would still refuse anybody running their
  // own. Instead: passing through one of the instance's own OAuth routes opens
  // the door, and coming back to the instance closes it again.
  win.webContents.on('will-navigate', (event, url) => {
    const server = readSettings().server;
    if (!server) return;
    if (url.startsWith('file://')) return; // our own connect / error pages

    if (isAuthStart(server, url)) {
      openAuthWindow();
      return;
    }
    if (url.startsWith(server)) {
      // Back home. Anything after this is ordinary navigation again.
      if (!url.startsWith(server + '/api/oauth/') &&
          !url.startsWith(server + '/api/admin/mail-oauth/')) closeAuthWindow();
      return;
    }
    if (authOpen) return; // mid-flow at the provider: let it through

    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  // RULE 3: a server that cannot be reached gets an explanation and a way back.
  win.webContents.on('did-fail-load', (_e, code, description, failedURL, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted, e.g. a redirect */) return;
    showUnreachable(failedURL, description);
  });

  route();
}

function route() {
  const server = readSettings().server;
  if (server) win.loadURL(server);
  else win.loadFile(path.join(__dirname, 'connect.html'));
}

function showUnreachable(url, description) {
  win.loadFile(path.join(__dirname, 'connect.html'), {
    query: { error: description || 'unreachable', url: url || '' },
  });
}

// ---- what the connect page may ask for -------------------------------------

ipcMain.handle('salt:getServer', () => readSettings().server ?? '');

ipcMain.handle('salt:setServer', async (_e, input) => {
  const origin = normalizeURL(input);
  if (!origin) return { ok: false, error: 'not-a-url' };
  // Ask the instance whether it is one before saving. Typing an address that
  // answers nothing and being dropped into a blank window is the worst first
  // five minutes this app could have.
  try {
    const res = await fetch(origin + '/api/health', { redirect: 'follow' });
    const body = await res.json();
    if (!body || body.status !== 'ok') return { ok: false, error: 'not-salt' };
    writeSettings({ ...readSettings(), server: origin });
    route();
    return { ok: true, version: body.version ?? '' };
  } catch (e) {
    return { ok: false, error: 'unreachable', detail: String(e.message ?? e) };
  }
});

ipcMain.handle('salt:forget', () => {
  const { server, ...rest } = readSettings();
  writeSettings(rest);
  route();
  return true;
});

// ---- menu ------------------------------------------------------------------

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Change server…',
          click: () => win.loadFile(path.join(__dirname, 'connect.html')),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Salt.md documentation',
          click: () => shell.openExternal('https://salt.md/wiki'),
        },
        {
          label: 'About this app',
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              message: 'Salt.md',
              detail:
                `Version ${app.getVersion()}\n\n` +
                'This app is a window onto a Salt.md server you run. ' +
                'Your data lives on that server, not here.\n\n' +
                `Connected to: ${readSettings().server || 'nothing yet'}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- start -----------------------------------------------------------------

app.whenReady().then(() => {
  // Identity providers refuse to show a sign-in page to anything whose user
  // agent says "Electron" — Google answers `disallowed_useragent` outright.
  // The objection is to hidden webviews that can read what somebody types; this
  // is a visible window with no script of ours in it, so the honest description
  // is a browser. Dropping the two Electron tokens says exactly that.
  const ua = session.defaultSession
    .getUserAgent()
    .replace(/ Electron\/[\d.]+/, '')
    .replace(/ salt-desktop\/[\d.]+/i, '')
    .replace(/ Salt\.md\/[\d.]+/i, '');
  session.defaultSession.setUserAgent(ua);

  // The renderer loads a REMOTE page, so it is treated as one: no permission is
  // granted by default. Notifications and clipboard reads are the ones a
  // workspace might plausibly ask for; both can be added deliberately later.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
