import React from 'react';
import ReactDOM from 'react-dom/client';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
// Schriften liegen im Binary, nicht bei einem CDN: eine selbstgehostete
// Instanz soll ohne Netzzugang nach draussen vollstaendig aussehen, und ein
// Abruf bei Google verraet jede Seitenansicht an einen Dritten. Der Browser
// laedt eine Schriftdatei erst, wenn sie tatsaechlich verwendet wird — die
// Einbindung kostet also nichts, solange niemand sie eingeschaltet hat.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import App from './App';
import { installRingHover } from './ring';
import { initLocale } from './i18n';
import ErrorBoundary from './components/ErrorBoundary';

installRingHover();

// Load the language before the first paint. Rendering first and translating
// afterwards would show every non-English user a flash of English on every
// load.
//
// A callback rather than top-level await on purpose: await here would force the
// build target up to ES2022 and drop Safari 14, which still runs the iOS
// home-screen app on older iPads. `finally` so a broken catalog costs the user
// English, never a blank page.
initLocale().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
});

// PWA app-shell caching. Service workers only run in secure contexts (HTTPS or
// localhost) — on a plain-HTTP LAN deployment this is a silent no-op, and the
// manifest/apple-touch-icon still give an installable home-screen app on iOS.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline shell is a nice-to-have; never break the app over it */
    });
  });
}
