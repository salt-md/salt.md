import { useState } from 'react';
import { api } from '../api';
import type { User } from '../types';
import Logo from '../Logo';
import { t } from '../i18n';

export default function Setup({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const user = await api.setup(name, email, password);
      onSuccess(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">🍃</div>
        <h1><Logo size={30} className="inline-logo" /> {t('Welcome to Salt.md')}</h1>
        <p>{t('Create the first (admin) account for this workspace.')}</p>
        <input
          autoFocus
          value={name}
          placeholder={t('Your name')}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="email"
          value={email}
          placeholder={t('Email')}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          value={password}
          placeholder={t('Password (min. 8 characters)')}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {t('Create workspace')}
        </button>
      </form>
    </div>
  );
}
