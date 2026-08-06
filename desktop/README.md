# Salt.md desktop

A window onto a Salt.md server you run. Not a local instance, not a copy of the
product — a shell, so your workspace opens where you left it instead of living
in a browser tab among thirty others.

```sh
npm install
npm start          # run it
npm run check      # assert the address parser
npm run dist:mac   # build a .dmg (also :win, :linux)
```

## What it does beyond loading a page

- **Asks the server whether it is one** before saving an address. Typing
  something that answers nothing and landing in a blank window is the worst
  first five minutes this app could have.
- **Stays on your instance.** Any other link opens in your real browser. Without
  that, one click on a bookmark block replaces your workspace and there is no
  address bar to get back from.
- **Gives an unreachable server a page, not a crash.** A laptop opened on a
  train gets an explanation and the field to change the address — Chromium's own
  error page is a dead end.
- **No Node in the renderer.** `contextIsolation` on, `nodeIntegration` off,
  `sandbox` on, and a preload exposing exactly three functions. A shell that
  loads a remote page with Node in it hands that server the user's filesystem.
- Remembers the window size but **not its position**: a window restored onto a
  monitor that is no longer attached is invisible with no way to fetch it back.

## Signing

macOS builds are notarised when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
`APPLE_TEAM_ID` are in the environment. Without them the build still works and
macOS will tell whoever opens it that the app is damaged — which is what an
unsigned app looks like from the outside.

Windows and Linux builds are unsigned for now.
