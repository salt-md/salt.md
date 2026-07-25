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
import ErrorBoundary from './components/ErrorBoundary';

installRingHover();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

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
