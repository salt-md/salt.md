# The desktop app

Salt.md has a desktop application for macOS, Windows and Linux. It is a **window
onto a server you run** — not a second copy of the product, not a local
instance, and not an offline mode. You give it the address of your instance
once, and it opens straight into your workspace in a window with no address bar,
a native menu, and its own place in the dock or taskbar.

Everything you see in it is the same Salt.md the browser shows. Your pages,
files and databases stay on the server. This page covers connecting the app,
changing which instance it points at, signing in through your real browser, what
the window does that a browser tab does not, and how the app is built.

## What it is

One window, one instance, no data of its own. The app stores exactly two things
on your computer: the address you gave it, and the size of the window. There is
no local cache of your pages and no offline access — with no connection to the
server the app shows you a page explaining that, and the field to change the
address.

It is deliberately built to work against **older instances than itself**. The
app carries its own window layout and its own extras rather than expecting the
server to supply them, so pointing a new app at an instance nobody has updated
in months is an ordinary case, not a broken one. The app's version (Help →
**About this app**) and your instance's version are separate numbers.

The app is not shipped with the server release. It is built from the `desktop/`
folder of the Salt.md repository — see [Building it](#building-it) at the end of
this page.

## Connecting it to your instance

On first launch the window shows a single screen headed **Connect to your
salt.md**, with the line *This app is a window onto a server you run. Your data
stays there.*

1. Type the address of your instance in the field (it is prefilled with the
   example `salt.example.com`).
2. Press **Connect**, or the Enter key.

The app then asks that address whether a Salt.md is actually there — it calls
`/api/health` and waits for the answer — before saving anything. Typing an
address that answers nothing and being dropped into a blank window is the
failure this check exists to prevent.

While it checks, the screen says *Looking for a salt.md there…*. Then one of:

| What it says | What happened |
| --- | --- |
| Found it. Opening… | The address is saved and the window loads your instance. |
| That does not look like an address. | What you typed cannot be read as a web address at all. |
| Something answered there, but it is not a salt.md. | Something is listening, but it is not this product — a router page, a proxy, another application on that port. |
| Nothing answered there. Check the address, and that the server is running. | Nothing replied: wrong host or port, server stopped, name that does not resolve, or a certificate the app refuses. |

### What you may type

You do not have to type a scheme. The app fills one in, and this is the only
place in it that guesses at what you meant:

| You type | The app uses |
| --- | --- |
| `salt.example.com` | `https://salt.example.com` |
| `https://salt.example.com` | `https://salt.example.com` — an explicit scheme always wins |
| `localhost:8420` | `http://localhost:8420` |
| `127.0.0.1:8420` | `http://127.0.0.1:8420` |
| `192.0.2.10:8420` | `https://192.0.2.10:8420` |
| `https://salt.example.com/p/9fd2?tab=x` | `https://salt.example.com` |

Two rules are worth knowing because they are not obvious:

- **A bare host becomes `https`, but this machine becomes `http`.**
  `localhost`, `127.0.0.1`, `0.0.0.0` and `[::1]` default to plain HTTP, because
  a Salt.md you started on your own machine serves plain HTTP unless you gave it
  a certificate. Anything else — including a LAN address like `192.0.2.10` — gets
  `https`, since that may well be behind a proxy that terminates TLS.
- **A pasted page address is cut back to the instance.** People copy the address
  of the page they are looking at; the path, query and fragment are dropped.

Anything with another scheme (`ftp://…`, `file:///…`) is refused rather than
patched up, and so is text that is not an address.

## Changing the instance later

One instance at a time. Connecting to another one replaces the address and
nothing else — no data is touched on either server, and switching back is
retyping the old address.

There are two ways in:

- **Settings…** (⌘, / Ctrl+,) — in the application menu on macOS, in the **File**
  menu on Windows and Linux.
- **On the sign-in screen**, a quiet line at the bottom of the window: *Connected
  to* the host name, followed by **Change**. It appears only on the sign-in
  screen, because that is the moment you notice you are at the wrong instance —
  staring at a login you cannot use.

The connect screen prefills whatever is configured, so changing the instance is
an edit rather than typing an address from memory. When a server is already
set, the screen also offers **Back to my workspace**, which leaves everything as
it was.

## Signing in through your browser

The app does not draw its own sign-in page. It sends you to your **real
browser**, you sign in there exactly as you normally would, and the browser
hands control back to the app.

That is a deliberate trade of one extra step for two things you cannot get
inside an application window: you can see the address bar, and therefore check
that your password is going to your identity provider and not to a window some
program drew; and the browser session, password manager, passkeys and hardware
keys you already have all work. It is also why identity providers refuse
embedded sign-in windows in the first place.

What you see:

1. Your browser opens on your instance. If you are not signed in there, the
   normal sign-in screen appears first — password and two-factor code, or your
   company account (see [Single sign-on](sso.md)). It returns to the right place
   afterwards.
2. A page headed **Sign in to the desktop app?** with the line *The salt.md app
   on this computer is asking for a session.* and a box showing which account it
   would use — your name, and your email address if you have one.
3. Press **Allow**. **Not now** cancels and takes you to your workspace in the
   browser.
4. A page says **Signed in.** — *You can close this tab and go back to the
   salt.md app.* — with an **Open salt.md** button. The browser usually jumps
   back to the app on its own; the button is there for browsers that will not
   follow an unfamiliar link without a click.
5. The app window opens your workspace.

**The Allow step is not ceremony.** Without it, any web page you happened to
open could send your browser through this flow and quietly mint a session for a
program waiting on the other end.

### What the app ends up with

An ordinary browser session, the same as signing in in a browser — not an agent
credential, and not a token with reduced powers. It lasts as long as your
instance's session length allows (90 days unless an administrator changed it,
see [Administration](administration.md)), it appears in the audit log like any
other sign-in ([History and audit](history-and-audit.md)), and changing your
password ends it along with every other session ([Account](account.md)).

The code that travels from the browser back to the app is single use, expires
after **five minutes**, and cannot be redeemed by anything except the app that
started the request — the app keeps a secret it never sends, and the code alone
is worthless without it. If the app has been restarted in the meantime, the
secret is gone and the sign-in starts again rather than half-completing.

### When something goes wrong mid-flow

| What you see | What it means |
| --- | --- |
| That sign-in request is malformed. | The browser arrived on the sign-in page without a proper request from the app. Start it again from the app. |
| You are not signed in any more. | Your browser session ended between the approval page and pressing **Allow**. Sign in again in the browser and repeat. |
| Could not create the sign-in. | The server could not record the request. Try again; if it repeats, the server log is the place to look. |

If the hand-back fails after you pressed **Allow** — the code expired, or it was
already used — the app window returns to the connect screen. Start the sign-in
again from **File → Sign in with your browser**.

### When the browser is not used

Two cases send the sign-in back into the app window, unchanged and working:

- **Your instance is older than this feature.** The app asks the server whether
  it knows the browser hand-off before sending you anywhere; an instance that
  does not simply gets the sign-in in the window. Without that question you
  would end up standing in your workspace in a browser wondering what happened.
- **The machine would not let the app claim its `salt://` link.** Without that,
  the browser has no way to reach back, so the app keeps the in-window sign-in
  as a way in rather than leaving you with none. A run started from source
  (`npm start`) never claims the link on purpose, so a development run cannot
  take it away from an installed copy.

**File → Sign in with your browser** starts the browser flow by hand. Use it
when a session has expired and the app is sitting on a sign-in screen.

## What the window adds over a browser tab

- **It opens where you left off**, and it is not one of thirty tabs. ⌘W closes
  the window rather than a page you were editing.
- **The size is remembered, the position is not.** A window restored onto a
  monitor that is no longer attached is invisible with no way to fetch it back.
  The window cannot be made smaller than 700 × 500.
- **On macOS the window has no title bar of its own.** Salt.md's own top bar is
  the chrome; the traffic lights sit inside it, and the app supplies the spacing
  around them. Drag the window by the empty space in the sidebar header or the
  tab bar.
- **Right-click gives you Salt.md's own menus** — on a page in the sidebar, on a
  row, on a card. The browser's own menu is suppressed there so it cannot open
  on top of them. On text it still appears, with Copy and the spelling
  suggestions, and the system spell checker underlines misspellings as you write.
- **The View menu** has Reload, Force Reload, zoom in / out / reset, full screen
  and developer tools. **Edit** has the standard undo, cut, copy, paste and
  select all.
- **Links to anywhere else open in your real browser.** A bookmark block, a URL
  property, a link in a document — they leave the app rather than replacing your
  workspace with somebody's website in a window with no back button.
- **No browser permissions are granted.** Notifications, clipboard reads, camera,
  microphone and location are all refused, because the window loads a remote
  page and is treated as one.
- **Launching it twice focuses the window you already have** instead of opening
  a second one. On macOS, closing the window leaves the app running in the dock;
  clicking the dock icon brings it back. The dock icon follows your system's
  light or dark appearance.
- **Help → Salt.md documentation** opens this wiki. **Help → About this app**
  shows the app's version and which instance it is connected to.

One consequence worth knowing: anything the interface opens **in a new tab**
opens in your browser, even when it points at your own instance. That is the
**Print / as PDF** view of a document ([Pages](pages.md)) and a file that cannot
be previewed in the panel ([Files](files.md)). Those pages need a signed-in
browser — which, if you signed in the way described above, is the browser you
used.

## When the server cannot be reached

The app does not show the browser's error page. A failed load lands on the
connect screen with the address prefilled and a line naming it: *Could not reach
salt.example.com. Is it running?*

The usual causes, in the order they happen: the laptop is not on the network;
the instance is only reachable through a VPN or a tunnel that is not up (see
[Reaching it from outside](domain.md)); the server is stopped. Press **Back to
my workspace** to try the same address again once the cause is gone, or type a
different one. [Troubleshooting](troubleshooting.md) covers the server side.

## Building it

The app lives in `desktop/` in the repository and is built with Electron:

```sh
cd desktop
npm install
npm start            # run it
npm run check        # assert the address parser
npm run dist:mac     # build an installer (also dist:win, dist:linux)
```

Builds land in `desktop/dist/`.

| Platform | What is built |
| --- | --- |
| macOS | `.dmg`, for Apple silicon and Intel |
| Windows | an NSIS installer, 64-bit |
| Linux | AppImage and `.deb` |

**Signing.** macOS builds are notarised automatically when `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are in the environment at
build time; the hardened runtime and entitlements are already configured.
Without them the build still works, and macOS then tells whoever opens it that
the app is damaged — that message is about the missing signature, not about the
file. Removing the quarantine flag by hand gets past it:

```sh
xattr -dr com.apple.quarantine /Applications/salt.md.app
```

That is acceptable for your own machine and not something to ask a colleague to
do. Windows and Linux builds are unsigned.

**Why Finder writes "salt.md.app".** macOS hides the `.app` extension — except
when hiding it would leave a name that ends in another known extension, and
`salt.md` reads as a Markdown file. The menu bar, the dock and the About box say
**salt.md**; Finder and Spotlight say salt.md.app. Nothing overrides it, and a
dot in the name is not the cause: `salt.x.app` shows as *salt.x*.

## Related pages

- [Getting started](getting-started.md) — installing the server itself
- [Single sign-on](sso.md) — signing in with a company account
- [Account](account.md) — sessions, two-factor, ending a session everywhere
- [Agent access](agent-access.md) — why the desktop app is not an agent
- [Self-hosting](self-hosting.md) — running the instance the app points at
