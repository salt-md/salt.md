import { useEffect, useState } from 'react';
import { api } from '../api';
import type { User } from '../types';
import Logo from '../Logo';

// Rendered when the URL is /invite/<token>.
//  - Signed-out visitor → a small sign-up/sign-in form that joins the workspace.
//    If the email already belongs to an account, the password (and, when set, a
//    2FA code) is required — the server authenticates before joining, so a
//    leaked link can never take over an existing account.
//  - Signed-in visitor → a one-click "join as <me>" prompt; the session proves
//    identity, so no credentials are re-collected.
export default function InviteAccept({
  token,
  currentUser,
  onSuccess,
}: {
  token: string;
  currentUser?: User | null;
  onSuccess: (user: User) => void;
}) {
  const [info, setInfo] = useState<{ email: string; workspace: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .inviteInfo(token)
      .then((i) => {
        setInfo(i);
        if (i.email) setEmail(i.email);
      })
      .catch(() => setInvalid(true));
  }, [token]);

  const finish = (user: User) => {
    history.replaceState(null, '', '/'); // drop the invite path so a reload lands in the app
    onSuccess(user);
  };

  // Signed-in: join the workspace as the current account (no credentials).
  const joinAsCurrent = async () => {
    setBusy(true);
    setError(null);
    try {
      finish(await api.acceptInvite(token, '', '', ''));
    } catch (err) {
      setError((err as Error).message || 'Beitritt fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      finish(await api.acceptInvite(token, name, email, password, code));
    } catch (err) {
      const msg = (err as Error).message || 'Beitritt fehlgeschlagen';
      if (/2fa required/i.test(msg)) {
        setNeedCode(true);
        setError('Bitte gib deinen 2FA-Code ein.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-logo"><Logo size={56} /></div>
          <h1>Einladung ungültig</h1>
          <p>Dieser Einladungslink ist ungültig oder abgelaufen.</p>
          <a className="btn" href="/">Zum Login</a>
        </div>
      </div>
    );
  }

  // Signed-in join view.
  if (currentUser) {
    const mismatch =
      !!info?.email && info.email.toLowerCase() !== currentUser.email.toLowerCase();
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-logo"><Logo size={56} /></div>
          <h1>Workspace beitreten</h1>
          <p>
            {info?.workspace
              ? `Du wurdest zum Workspace „${info.workspace}" eingeladen.`
              : 'Du wurdest eingeladen.'}
          </p>
          {mismatch ? (
            <>
              <p>
                Diese Einladung ist für <strong>{info?.email}</strong>, du bist aber als{' '}
                <strong>{currentUser.email}</strong> angemeldet.
              </p>
              <a className="btn" href="/api/logout">Abmelden &amp; neu anmelden</a>
            </>
          ) : (
            <>
              <p>
                Angemeldet als <strong>{currentUser.email}</strong>.
              </p>
              {error && <div className="login-error">{error}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" onClick={joinAsCurrent} disabled={busy}>
                  Beitreten
                </button>
                <a className="btn" href="/">Abbrechen</a>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo"><Logo size={56} /></div>
        <h1>Beitreten</h1>
        <p>
          {info?.workspace
            ? `Du wurdest zum Workspace „${info.workspace}" eingeladen.`
            : 'Du wurdest eingeladen.'}
        </p>
        <input
          autoFocus
          value={name}
          placeholder="Dein Name"
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="email"
          value={email}
          placeholder="Email"
          readOnly={!!info?.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          value={password}
          placeholder="Passwort (min. 8 Zeichen)"
          onChange={(e) => setPassword(e.target.value)}
        />
        {needCode && (
          <input
            value={code}
            placeholder="2FA-Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            onChange={(e) => setCode(e.target.value)}
          />
        )}
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          Beitreten
        </button>
      </form>
    </div>
  );
}
