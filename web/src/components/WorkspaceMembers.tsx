import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import Portal from './Portal';
import { confirm } from '../dialog';
import { useExclusiveModal } from '../modal';
import { toast } from '../toast';

type Role = 'admin' | 'member' | 'viewer';
interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  member: 'Mitglied (Bearbeiten)',
  viewer: 'Betrachter (Nur lesen)',
};

export default function WorkspaceMembers({
  workspaceId,
  myUserId,
  myRole,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  myUserId: string;
  myRole: Role;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('member');
  const isAdmin = myRole === 'admin';
  useExclusiveModal(onClose);

  const load = () => void api.listMembers(workspaceId).then(setMembers).catch(() => {});
  useEffect(load, [workspaceId]);

  const [inviteLink, setInviteLink] = useState('');

  // Invite by link/email: creates an invitation the recipient accepts (they set
  // their own password), instead of an admin adding an already-existing user.
  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.createInvite(email.trim(), newRole, workspaceId);
      setInviteLink(r.link);
      setEmail('');
      void navigator.clipboard?.writeText(r.link);
      toast(r.emailed ? 'Einladung per E-Mail versendet' : 'Einladungslink kopiert');
      load();
    } catch (err) {
      toast((err as Error).message || 'Einladung fehlgeschlagen');
    }
  };

  const changeRole = async (m: Member, role: Role) => {
    try {
      await api.updateMember(workspaceId, m.userId, role);
      load();
    } catch (err) {
      toast((err as Error).message || 'Rolle konnte nicht geändert werden');
    }
  };

  const remove = async (m: Member, confirmPrivate = false) => {
    const self = m.userId === myUserId;
    if (!confirmPrivate && !(await confirm(self ? 'Workspace verlassen?' : `${m.name} entfernen?`, { danger: true }))) return;
    try {
      await api.removeMember(workspaceId, m.userId, confirmPrivate);
      if (self) {
        onChanged();
        onClose();
      } else {
        load();
      }
    } catch (err) {
      const msg = (err as Error).message || 'Mitglied konnte nicht entfernt werden';
      // 409 heißt: hier liegen private Seiten, die zurückbleiben und danach nur
      // noch für die Admins des Workspace sichtbar sind. Am STATUS erkannt, nicht
      // am Meldungstext — der ändert sich mit jeder Umformulierung, und dann wäre
      // das Entfernen über die Oberfläche gar nicht mehr möglich.
      if (!confirmPrivate && (err as ApiError).status === 409) {
        if (await confirm(`${msg}\n\nTrotzdem ${self ? 'verlassen' : 'entfernen'}?`, { danger: true, confirmText: self ? 'Verlassen' : 'Entfernen' })) {
          await remove(m, true);
        }
        return;
      }
      toast(msg);
    }
  };

  return (
    <Portal>
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Workspace-Mitglieder">
        <h2>Workspace-Mitglieder</h2>
        <div className="user-list">
          {members.map((m) => (
            <div key={m.userId} className="user-row">
              <span className="user-row-name">
                {m.name} {m.userId === myUserId && <span className="prop-empty">(du)</span>}
              </span>
              <span className="user-row-email">{m.email}</span>
              {isAdmin && m.userId !== myUserId ? (
                <select
                  className="prop-select"
                  value={m.role}
                  onChange={(e) => void changeRole(m, e.target.value as Role)}
                >
                  <option value="admin">Admin</option>
                  <option value="member">Mitglied</option>
                  <option value="viewer">Betrachter</option>
                </select>
              ) : (
                <span className="token-scope write">{ROLE_LABEL[m.role]}</span>
              )}
              {(isAdmin || m.userId === myUserId) && (
                <button
                  className="icon-btn danger"
                  title={m.userId === myUserId ? 'Verlassen' : 'Entfernen'}
                  onClick={() => void remove(m)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {members.length === 0 && <div className="dialog-hint">Noch keine Mitglieder.</div>}
        </div>
        {isAdmin && (
          <>
            <form className="user-add" onSubmit={invite}>
              <input
                value={email}
                placeholder="E-Mail einladen (leer = nur Link)"
                onChange={(e) => setEmail(e.target.value)}
              />
              <select className="prop-select" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
                <option value="member">Mitglied</option>
                <option value="viewer">Betrachter</option>
                <option value="admin">Admin</option>
              </select>
              <button className="btn primary" type="submit">Einladen</button>
            </form>
            {inviteLink && (
              <div className="invite-link">
                <span className="dialog-hint">Einladungslink (14 Tage gültig, kopiert):</span>
                <input className="prop-input" readOnly value={inviteLink} onFocus={(e) => e.currentTarget.select()} />
              </div>
            )}
          </>
        )}
        <button className="btn dialog-close" onClick={onClose}>Schließen</button>
      </div>
    </div>
    </Portal>
  );
}
