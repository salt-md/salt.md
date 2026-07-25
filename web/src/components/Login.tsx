import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import type { User } from '../types';
import Logo from '../Logo';

export default function Login({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [instanceName, setInstanceName] = useState('');
  const [oauth, setOauth] = useState<{ google: boolean; microsoft: boolean }>({ google: false, microsoft: false });

  useEffect(() => {
    void api
      .signupPolicy()
      .then((p) => {
        setSignupOpen(p.mode === 'open' || p.mode === 'domain');
        setInstanceName(p.instanceName || '');
        if (p.instanceName) document.title = p.instanceName;
        setOauth({ google: p.oauthGoogle, microsoft: p.oauthMicrosoft });
      })
      .catch(() => {});
    // Fehlermeldung aus einem abgebrochenen OAuth-Redirect anzeigen.
    const qs = new URLSearchParams(window.location.search);
    const oe = qs.get('oauthError');
    if (oe) {
      setError(oe);
      qs.delete('oauthError');
      const rest = qs.toString();
      window.history.replaceState({}, '', window.location.pathname + (rest ? '?' + rest : ''));
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') {
        onSuccess(await api.signup(name, email, password));
        return;
      }
      const user = await api.login(email, password, needCode ? code : undefined);
      onSuccess(user);
    } catch (err) {
      // Am Grund aus der Antwort, nicht am Meldungstext: der Server schickt
      // `code`, die Meldung selbst darf sich jederzeit ändern oder übersetzt
      // werden. Vorher hing das Einblenden des 2FA-Feldes an einem wörtlichen
      // Vergleich mit "2fa required" — eine Umformulierung hätte jedes Konto
      // mit Zwei-Faktor-Anmeldung ausgesperrt.
      const e = err as ApiError;
      if (e.code === '2fa_required') setNeedCode(true);
      setError(e.message || 'Server nicht erreichbar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card ring" onSubmit={submit}>
        <div className="login-logo"><Logo size={56} /></div>
        {/* Ohne eigenen Instanznamen steht hier die Marke — klein, Mono, eng
            gestellt, wie auf der Website und im Banner. Traegt die Instanz
            einen eigenen Namen, ist das die Marke der Firma und bleibt, wie
            sie geschrieben wurde. */}
        <h1 className={instanceName ? undefined : 'wordmark'}>{instanceName || 'salt.md'}</h1>
        <p>{mode === 'signup' ? 'Konto erstellen.' : 'Melde dich in deinem Workspace an.'}</p>
        {mode === 'signup' && (
          <input
            autoFocus
            value={name}
            placeholder="Name"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        )}
        <input
          type="email"
          autoFocus={mode === 'login'}
          value={email}
          placeholder="Email"
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
        />
        <input
          type="password"
          value={password}
          placeholder={mode === 'signup' ? 'Passwort (min. 8 Zeichen)' : 'Passwort'}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />
        {needCode && mode === 'login' && (
          <input
            inputMode="numeric"
            autoFocus
            value={code}
            placeholder="2FA-Code (6-stellig)"
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
          />
        )}
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {mode === 'signup' ? 'Konto erstellen' : 'Anmelden'}
        </button>
        {(oauth.google || oauth.microsoft) && (
          <>
            <div className="login-divider"><span>oder</span></div>
            {oauth.google && (
              <a className="btn oauth-btn" href="/api/oauth/google/start">
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.86c2.26-2.09 3.58-5.17 3.58-8.81z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.86-3c-1.07.72-2.44 1.14-4.08 1.14-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z" />
                  <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54v-3.1H1.29a12 12 0 0 0 0 10.74l3.98-3.1z" />
                  <path fill="#EA4335" d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.42-3.42A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.63l3.98 3.1C6.22 6.88 8.87 4.77 12 4.77z" />
                </svg>
                Mit Google anmelden
              </a>
            )}
            {oauth.microsoft && (
              <a className="btn oauth-btn" href="/api/oauth/microsoft/start">
                <svg width="17" height="17" viewBox="0 0 23 23" aria-hidden="true">
                  <rect x="1" y="1" width="10" height="10" fill="#F35325" />
                  <rect x="12" y="1" width="10" height="10" fill="#81BC06" />
                  <rect x="1" y="12" width="10" height="10" fill="#05A6F0" />
                  <rect x="12" y="12" width="10" height="10" fill="#FFBA08" />
                </svg>
                Mit Microsoft anmelden
              </a>
            )}
          </>
        )}
        {signupOpen && (
          <button
            type="button"
            className="login-switch"
            onClick={() => {
              setMode((m) => (m === 'login' ? 'signup' : 'login'));
              setError(null);
              setNeedCode(false);
            }}
          >
            {mode === 'login'
              ? 'Neu hier? Konto erstellen'
              : 'Zurück zum Login'}
          </button>
        )}
      </form>
    </div>
  );
}
