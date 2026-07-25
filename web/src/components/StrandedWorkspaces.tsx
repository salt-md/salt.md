import { useEffect, useState } from 'react';
import { api } from '../api';
import Portal from './Portal';
import { toast } from '../toast';
import { promptText } from '../dialog';

// Workspaces ohne Verantwortlichen — die Aufräum-Ansicht des Owners.
//
// Vor W105 konnte so etwas still entstehen: wurde das einzige Mitglied eines
// Workspace gelöscht, blieb er mit null Mitgliedern zurück. In keiner Sidebar
// mehr sichtbar, aber mit allen Seiten, Dateien und Suchindex-Einträgen. Neu
// entstehen können solche Reste nicht mehr; die schon vorhandenen brauchen
// trotzdem einen Weg heraus.

interface Stranded {
  id: string;
  name: string;
  owner: string;
  members: number;
  admins: number;
  pages: number;
  /** Wirklich niemand mehr da — nur dann lässt sich übernehmen oder löschen. */
  adoptable: boolean;
  deletable: boolean;
  personal: boolean;
}

export default function StrandedWorkspaces({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<Stranded[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .strandedWorkspaces()
      .then(setList)
      .catch((e: Error) => {
        // list bleibt null — sonst stuende unter der roten Fehlerzeile die
        // Entwarnung "Alles in Ordnung", die genau das Gegenteil behauptet.
        setError(e.message);
      });
  };
  useEffect(load, []);

  const adopt = async (w: Stranded) => {
    try {
      await api.adoptWorkspace(w.id);
      toast(`„${w.name}" übernommen — er steht jetzt in deiner Liste.`);
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (w: Stranded) => {
    const typed = await promptText(
      `„${w.name}" mit ${w.pages} Seiten endgültig löschen? Tippe den Namen zur Bestätigung.`,
      { placeholder: w.name },
    );
    if (typed?.trim() !== w.name) return;
    try {
      await api.deleteStrandedWorkspace(w.id, w.name);
      toast(`„${w.name}" gelöscht.`);
      load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Portal>
      <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dialog" role="dialog" aria-modal="true" aria-label="Workspaces ohne Verantwortlichen">
          <h2>Workspaces ohne Verantwortlichen</h2>
          <p className="dialog-hint">
            Hier stehen Workspaces, um die sich niemand mehr kümmern kann. Ist gar niemand mehr
            Mitglied, kannst du sie übernehmen oder löschen. Sind noch Mitglieder da, fehlt dort nur
            ein Verantwortlicher — dann ernenne einen von ihnen in der Nutzerverwaltung.
          </p>
          {error && <div className="login-error">{error}</div>}
          {list === null && <div className="dialog-hint">Wird geladen…</div>}
          {list?.length === 0 && (
            <div className="dialog-hint">Alles in Ordnung — jeder Workspace hat einen Verantwortlichen.</div>
          )}
          {list && list.length > 0 && (
            <div className="bg-list">
              {list.map((w) => (
                <div key={w.id} className="bg-row active">
                  <div className="bg-row-main">
                    <strong>{w.name}</strong>
                    <span className="bg-when">
                      {w.pages} Seiten · {w.members} Mitglieder · {w.admins} Admins
                      {w.owner ? ` · zuletzt ${w.owner}` : ''}
                    </span>
                  </div>
                  {w.adoptable && (
                    <button className="btn-sm" onClick={() => void adopt(w)}>Übernehmen</button>
                  )}
                  {w.deletable && (
                    <button className="btn-sm danger" onClick={() => void remove(w)}>Löschen</button>
                  )}
                  {!w.deletable && (
                    <span className="dialog-hint">Hat noch Mitglieder: ernenne einen von ihnen zum Admin.</span>
                  )}
                  {w.deletable && w.personal && (
                    <span className="dialog-hint">Verwaister persönlicher Bereich — nur aufräumen, nicht öffnen.</span>
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
