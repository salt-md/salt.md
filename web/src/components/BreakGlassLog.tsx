import { useEffect, useState } from 'react';
import { api } from '../api';
import Portal from './Portal';
import { toast } from '../toast';
import { formatMoment } from '../format';

// Notfallzugriffe auf einen Workspace — für dessen Verantwortliche.
//
// Ein Zugriff, den man nur per E-Mail mitgeteilt bekommt, ist eine Mitteilung
// ohne Handhabe. Hier steht, wer wann mit welcher Begründung Einsicht genommen
// hat — und ein laufender Zugriff lässt sich sofort beenden.

interface Grant {
  id: string;
  user: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  active: boolean;
}

const when = (iso: string) => formatMoment(iso, 'datetime');

export default function BreakGlassLog({
  workspaceId,
  workspaceName,
  onClose,
}: {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
}) {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .listBreakGlass(workspaceId)
      .then(setGrants)
      .catch((e: Error) => {
        setError(e.message);
        setGrants([]);
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [workspaceId]);

  const revoke = async (g: Grant) => {
    try {
      await api.revokeBreakGlass(workspaceId, g.id);
      toast(`Zugriff von ${g.user} beendet.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Portal>
      <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dialog" role="dialog" aria-modal="true" aria-label="Notfallzugriffe">
          <h2>Notfallzugriffe</h2>
          <p className="dialog-hint">
            Einsicht in „{workspaceName}" durch den Instanz-Owner. Notfallzugriff erlaubt nur Lesen,
            läuft nach zwei Stunden ab und lässt sich jederzeit vorzeitig beenden.
          </p>
          {error && <div className="login-error">{error}</div>}
          {grants === null && <div className="dialog-hint">Wird geladen…</div>}
          {grants?.length === 0 && (
            <div className="dialog-hint">Bisher gab es keinen Notfallzugriff auf diesen Workspace.</div>
          )}
          {grants && grants.length > 0 && (
            <div className="bg-list">
              {grants.map((g) => (
                <div key={g.id} className={'bg-row' + (g.active ? ' active' : '')}>
                  <div className="bg-row-main">
                    <strong>{g.user}</strong>
                    <span className="bg-when">
                      {when(g.createdAt)}
                      {g.active
                        ? ` · läuft bis ${when(g.expiresAt)}`
                        : g.revokedAt
                          ? ' · vorzeitig beendet'
                          : ' · abgelaufen'}
                    </span>
                    <span className="bg-reason">{g.reason}</span>
                  </div>
                  {g.active && (
                    <button className="btn-sm danger" onClick={() => void revoke(g)}>
                      Jetzt beenden
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="dialog-actions">
            <button className="btn" onClick={onClose}>Schließen</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
