import { useEffect, useState } from 'react';
import { Check, Send } from 'lucide-react';
import { api } from '../api';
import { formField } from './CollectionView';
import { PageIcon } from '../pageIcon';
import { PublicFormConfig, PropDef } from '../types';
import { toast } from '../toast';

// Standalone, unauthenticated form page served at /form/{token}. Reuses the
// exact same field renderer as the in-app form view, but posts to the public
// endpoint so anyone with the link can submit a row without an account.
export default function PublicForm({ token }: { token: string }) {
  const [cfg, setCfg] = useState<PublicFormConfig | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading');
  const [title, setTitle] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api
      .publicFormConfig(token)
      .then((c) => {
        setCfg(c);
        setState('ready');
      })
      .catch(() => setState('notfound'));
  }, [token]);

  const set = (id: string, v: unknown) => setValues((p) => ({ ...p, [id]: v }));

  const submit = async () => {
    if (!title.trim() || busy || !cfg) return;
    setBusy(true);
    try {
      const props: Record<string, unknown> = {};
      for (const f of cfg.schema) {
        const v = values[f.id];
        if (v === undefined || v === '' || v === null) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        props[f.id] = v;
      }
      await api.publicFormSubmit(token, title.trim(), props);
      setDone(true);
    } catch {
      toast('Senden fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="public-form-page">
        <div className="form-card public-form-loading">Lädt…</div>
      </div>
    );
  }
  if (state === 'notfound' || !cfg) {
    return (
      <div className="public-form-page">
        <div className="form-card form-done">
          <h2>Formular nicht gefunden</h2>
          <p>Dieser Link ist ungültig oder wurde deaktiviert.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="public-form-page">
        <div className="form-card form-done">
          <div className="form-done-ic">
            <Check size={30} />
          </div>
          <h2>Danke!</h2>
          <p>Deine Antwort wurde übermittelt.</p>
          <button
            className="btn-sm primary"
            onClick={() => {
              setDone(false);
              setTitle('');
              setValues({});
            }}
          >
            Noch eine Antwort senden
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="public-form-page">
      <div className="form-card">
        <div className="public-form-head">
          {cfg.icon && <PageIcon icon={cfg.icon} size={42} />}
          <h1 className="form-heading form-heading-static">{cfg.formTitle || cfg.title || 'Formular'}</h1>
        </div>
        {cfg.formDesc && <p className="form-desc form-desc-static">{cfg.formDesc}</p>}
        <div className="form-fields">
          <label className="form-field">
            <span className="form-label">
              Titel <b className="form-req">*</b>
            </span>
            <input
              className="form-input"
              value={title}
              placeholder="Name des Eintrags"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </label>
          {cfg.schema.map((f: PropDef) => (
            <label key={f.id} className={'form-field' + (f.type === 'checkbox' ? ' form-field--check' : '')}>
              <span className="form-label">{f.name}</span>
              {formField(f, values[f.id], (v) => set(f.id, v))}
            </label>
          ))}
        </div>
        <div className="form-actions">
          <button className="btn-sm primary form-submit" disabled={busy || !title.trim()} onClick={() => void submit()}>
            <Send size={14} /> {cfg.formSubmit?.trim() || 'Absenden'}
          </button>
        </div>
        <div className="public-form-footer">
          Erstellt mit <b>Salt.md</b>
        </div>
      </div>
    </div>
  );
}
