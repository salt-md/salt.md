import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ApiToken, AuditEntry, User, Workspace } from '../types';
import Portal from './Portal';
import { confirm, promptText } from '../dialog';
import { toast } from '../toast';
import { useExclusiveModal } from '../modal';
import { AdminSettingsModal, TwoFAModal, CalendarSubModal } from './AdminSettings';
import { Key, History, CalendarDays, ShieldCheck, Users, Settings, LogOut, Bot, User as UserIcon, Columns2 } from 'lucide-react';

export function Avatar({ user, size = 22 }: { user: User; size?: number }) {
  // Mit hochgeladenem Bild zeigt der Kreis das Bild, sonst Initiale auf der
  // Nutzerfarbe — dieselbe Logik ueberall, damit eine Person wiedererkennbar
  // bleibt.
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: user.avatar ? 'transparent' : user.color,
        fontSize: size * 0.5,
      }}
      title={user.name}
    >
      {user.avatar ? (
        <img src={user.avatar} alt="" />
      ) : (
        user.name.trim().charAt(0).toUpperCase() || '?'
      )}
    </span>
  );
}

// Die zehn Farben, die der Server beim Anlegen vergibt — dieselbe Palette
// zum Selbst-Waehlen.
const USER_COLORS = [
  '#2f7d4f', '#c4554d', '#3b6fb5', '#b58a3b', '#7d4fb0',
  '#3ba0a8', '#b5527e', '#6b8f3b', '#8a6650', '#5560c4',
];

// Profil-Dialog: Name, E-Mail, Farbe, Bild, Passwort. Das Backend konnte
// Name/Farbe/Passwort laengst aendern (PATCH /api/users/{id}) — es gab nur
// nirgends eine Oberflaeche dafuer. E-Mail-Aenderung ist neu (W96).
function ProfileModal({
  user,
  onClose,
  onChanged,
  onOpen2FA,
}: {
  user: User;
  onClose: () => void;
  onChanged: (u: User) => void;
  onOpen2FA: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [color, setColor] = useState(user.color);
  const [avatar, setAvatar] = useState(user.avatar);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [currentPw, setCurrentPw] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useExclusiveModal(onClose);

  const emailChanged = email.trim() !== '' && email !== user.email;
  const pwMismatch = pw !== '' && pw !== pw2;
  // Aktuelles Passwort wird verlangt, sobald man Passwort ODER E-Mail aendert —
  // genau das prueft auch der Server; ohne diese Bestaetigung koennte jemand an
  // einer offen gelassenen Sitzung die Zugangsdaten uebernehmen.
  const needsCurrent = pw !== '' || emailChanged;

  const save = async () => {
    if (pwMismatch) {
      toast('Die beiden neuen Passwörter stimmen nicht überein');
      return;
    }
    setBusy(true);
    try {
      const patch: Parameters<typeof api.updateUser>[1] = {};
      if (name.trim() && name !== user.name) patch.name = name.trim();
      if (emailChanged) patch.email = email.trim();
      if (color !== user.color) patch.color = color;
      if (avatar !== user.avatar) patch.avatar = avatar;
      if (pw) patch.password = pw;
      if (needsCurrent) patch.currentPassword = currentPw;
      if (Object.keys(patch).length) {
        const updated = await api.updateUser(user.id, patch);
        onChanged(updated);
      }
      onClose();
      if (pw) toast('Passwort geändert — andere Sitzungen wurden abgemeldet');
    } catch (err) {
      toast((err as Error).message || 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const pickAvatar = async (f: File | undefined) => {
    if (!f) return;
    try {
      const url = await api.upload(f);
      setAvatar(url);
    } catch (err) {
      toast((err as Error).message || 'Upload fehlgeschlagen');
    }
  };

  return (
    <Portal>
      <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dialog" role="dialog" aria-modal="true" aria-label="Profil">
          <h2>Profil</h2>
          <div className="profile-avatar-row">
            <Avatar user={{ ...user, name, color, avatar }} size={56} />
            <div className="profile-avatar-btns">
              <button className="btn-sm" onClick={() => fileRef.current?.click()}>Bild hochladen</button>
              {avatar && (
                <button className="btn-sm" onClick={() => setAvatar('')}>Bild entfernen</button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => void pickAvatar(e.target.files?.[0])}
              />
            </div>
          </div>
          <label className="profile-label">Name</label>
          <input className="prop-input profile-input" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="profile-label">E-Mail</label>
          <input className="prop-input profile-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label className="profile-label">Farbe</label>
          <div className="profile-colors">
            {USER_COLORS.map((c) => (
              <button
                key={c}
                className={'profile-swatch' + (color === c ? ' active' : '')}
                style={{ background: c }}
                title={c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <label className="profile-label">Neues Passwort (leer = unverändert)</label>
          <input
            className="prop-input profile-input"
            type="password"
            value={pw}
            autoComplete="new-password"
            placeholder="mindestens 8 Zeichen"
            onChange={(e) => setPw(e.target.value)}
          />
          {pw !== '' && (
            <>
              <label className="profile-label">Neues Passwort bestätigen</label>
              <input
                className={'prop-input profile-input' + (pwMismatch ? ' is-invalid' : '')}
                type="password"
                value={pw2}
                autoComplete="new-password"
                onChange={(e) => setPw2(e.target.value)}
              />
            </>
          )}
          {needsCurrent && (
            <>
              <label className="profile-label">
                Aktuelles Passwort {pw ? '(zur Bestätigung)' : '(nötig zum Ändern der E-Mail)'}
              </label>
              <input
                className="prop-input profile-input"
                type="password"
                value={currentPw}
                autoComplete="current-password"
                placeholder="dein jetziges Passwort"
                onChange={(e) => setCurrentPw(e.target.value)}
              />
            </>
          )}

          <div className="profile-2fa-row">
            <span>Zwei-Faktor-Authentifizierung</span>
            <button className="btn-sm" onClick={onOpen2FA}>Verwalten</button>
          </div>

          <div className="dialog-actions">
            <button className="btn" onClick={onClose}>Abbrechen</button>
            <button
              className="btn primary"
              disabled={
                busy ||
                (!!pw && pw.length < 8) ||
                pwMismatch ||
                (needsCurrent && currentPw === '')
              }
              onClick={() => void save()}
            >
              Speichern
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

interface Props {
  user: User;
  onLogout: () => void;
  // Nach einer Profilaenderung traegt App den neuen Stand in den Auth-State —
  // sonst zeigten Kopfzeile und Praesenz bis zum Neuladen den alten Namen.
  onUserChanged?: (u: User) => void;
  onOpenAgents?: () => void;
  // Bear-style notes mode (middle notes column). Off = classic tree layout.
  notesMode?: boolean;
  onToggleNotesMode?: () => void;
}

export default function UserMenu({ user, onLogout, onUserChanged, onOpenAgents, notesMode, onToggleNotesMode }: Props) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<'users' | 'tokens' | 'activity' | 'twofa' | 'settings' | 'calendar' | 'profile' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu-btn" onClick={() => setOpen((o) => !o)}>
        <Avatar user={user} />
        <span className="user-name">{user.name}</span>
      </button>
      {open && (
        <div className="menu user-menu-popup">
          {onOpenAgents && (
            <button className="agents-menu-item" onClick={() => { setOpen(false); onOpenAgents(); }}>
              <span className="agents-ic"><Bot size={16} /></span>
              <span className="agents-label">Agents &amp; MCP</span>
            </button>
          )}
          <button onClick={() => { setOpen(false); setModal('profile'); }}>
            <UserIcon size={16} /> Profil
          </button>
          <button onClick={() => { setOpen(false); setModal('tokens'); }}>
            <Key size={16} /> API tokens
          </button>
          <button onClick={() => { setOpen(false); setModal('activity'); }}>
            <History size={16} /> Activity log
          </button>
          <button onClick={() => { setOpen(false); setModal('calendar'); }}>
            <CalendarDays size={16} /> Kalender abonnieren
          </button>
          <button onClick={() => { setOpen(false); setModal('twofa'); }}>
            <ShieldCheck size={16} /> Zwei-Faktor (2FA)
          </button>
          {onToggleNotesMode && (
            <button onClick={onToggleNotesMode} title="Notizliste als Mittelspalte (Bear-Stil)">
              <Columns2 size={16} /> Notizen-Modus
              <span className={'mode-dot' + (notesMode ? ' on' : '')} aria-hidden />
            </button>
          )}
          {user.isAdmin && (
            <button onClick={() => { setOpen(false); setModal('users'); }}>
              <Users size={16} /> Manage users
            </button>
          )}
          {user.isAdmin && (
            <button onClick={() => { setOpen(false); setModal('settings'); }}>
              <Settings size={16} /> Instanz-Einstellungen
            </button>
          )}
          <button className="danger" onClick={onLogout}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}
      {modal === 'profile' && (
        <ProfileModal
          user={user}
          onClose={() => setModal(null)}
          onChanged={(u) => onUserChanged?.(u)}
          // 2FA an STELLE des Profils oeffnen, nicht verschachtelt — beide
          // nutzen useExclusiveModal und wuerden sich sonst um Esc streiten.
          onOpen2FA={() => setModal('twofa')}
        />
      )}
      {modal === 'users' && <UsersModal me={user} onClose={() => setModal(null)} />}
      {modal === 'tokens' && <TokensModal onClose={() => setModal(null)} />}
      {modal === 'activity' && <ActivityModal onClose={() => setModal(null)} />}
      {modal === 'twofa' && <TwoFAModal onClose={() => setModal(null)} />}
      {modal === 'calendar' && <CalendarSubModal onClose={() => setModal(null)} />}
      {modal === 'settings' && <AdminSettingsModal onClose={() => setModal(null)} />}
    </div>
  );
}

function ActivityModal({ onClose }: { onClose: () => void }) {
  useExclusiveModal(onClose);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    void api.audit().then((e) => {
      setEntries(e);
      if (e.length < 50) setDone(true);
    });
  }, []);
  const loadMore = async () => {
    const oldest = entries[entries.length - 1]?.id;
    if (!oldest) return;
    const more = await api.audit(oldest).catch(() => []);
    setEntries((prev) => [...prev, ...more]);
    if (more.length < 50) setDone(true);
  };
  // Die Vorgänge rund um Konten und Workspaces sind der Grund, warum es dieses
  // Protokoll gibt — ohne Übersetzung standen sie als rohes „disable_user"
  // zwischen den Seitenänderungen.
  const label: Record<string, string> = {
    create_page: 'hat erstellt',
    update_page: 'hat geändert',
    append_markdown: 'hat ergänzt',
    trash_page: 'hat in den Papierkorb gelegt',
    delete_page: 'hat endgültig gelöscht',
    upload_file: 'hat eine Datei hochgeladen zu',
    disable_user: 'hat das Konto stillgelegt:',
    enable_user: 'hat das Konto wieder aktiviert:',
    delete_user: 'hat das Konto gelöscht:',
    delete_workspace: 'hat den Workspace gelöscht:',
    workspace_handover: 'hat den Workspace übernommen:',
    workspace_adopted: 'hat den herrenlosen Workspace übernommen:',
    transfer_owner: 'hat die Instanz übergeben an:',
    break_glass: 'hat Notfallzugriff genommen:',
    break_glass_revoked: 'hat den Notfallzugriff beendet:',
  };
  return (
    <Portal>
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog">
        <h2>Protokoll</h2>
        <p className="dialog-hint">Die letzten Änderungen — mit dem Hinweis, ob ein Mensch oder ein Agent sie gemacht hat.</p>
        <div className="user-list">
          {entries.map((e) => (
            <div key={e.id} className="user-row">
              <span className={'badge ' + (e.actorType === 'agent' ? 'agent-badge' : '')}>
                {e.actorType === 'agent' ? <><Bot size={12} /> agent</> : <><UserIcon size={12} /> human</>}
              </span>
              <span className="user-row-name">
                {e.actorName} {label[e.action] ?? e.action}
                {e.detail ? ` „${e.detail.slice(0, 60)}"` : ''}
              </span>
              <span className="user-row-email">{e.createdAt.slice(0, 16).replace('T', ' ')}</span>
            </div>
          ))}
          {entries.length === 0 && <div className="dialog-hint">Noch nichts passiert.</div>}
          {!done && entries.length > 0 && (
            <button className="btn-sm" onClick={() => void loadMore()}>
              Mehr laden…
            </button>
          )}
        </div>
        <button className="btn dialog-close" onClick={onClose}>Schließen</button>
      </div>
    </div>
    </Portal>
  );
}

type WsRef = { id: string; name: string };
type Membership = { userId: string; workspaceId: string; role: string };
const ROLES = [
  { v: 'none', label: 'Kein Zugriff' },
  { v: 'viewer', label: 'Betrachter' },
  { v: 'member', label: 'Mitglied' },
  { v: 'admin', label: 'Admin' },
];

// Vollwertige Nutzerverwaltung (W98): links die Liste, rechts das Detail —
// Instanz-Admin-Schalter, Loeschen, und die Workspace-Zugehoerigkeit mit
// Rolle je Workspace direkt umschaltbar. Neue Nutzer bekommen ihre Workspaces
// gleich beim Anlegen zugewiesen.
function UsersModal({ me, onClose }: { me: User; onClose: () => void }) {
  useExclusiveModal(onClose);
  const [users, setUsers] = useState<User[]>([]);
  const [access, setAccess] = useState<{ workspaces: WsRef[]; memberships: Membership[] }>({
    workspaces: [],
    memberships: [],
  });
  const [selId, setSelId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void api.listUsers().then((u) => {
      setUsers(u);
      setSelId((cur) => cur ?? u[0]?.id ?? null);
    }).catch(() => {});
    void api.accessOverview().then(setAccess).catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const roleOf = (userId: string, wsId: string) =>
    access.memberships.find((m) => m.userId === userId && m.workspaceId === wsId)?.role ?? 'none';

  const setRole = async (userId: string, wsId: string, role: string) => {
    setError(null);
    // Optimistisch: die Pille reagiert sofort, der Server bestaetigt.
    setAccess((a) => {
      const rest = a.memberships.filter((m) => !(m.userId === userId && m.workspaceId === wsId));
      return { ...a, memberships: role === 'none' ? rest : [...rest, { userId, workspaceId: wsId, role }] };
    });
    try {
      await api.setMembership(userId, wsId, role);
    } catch (err) {
      setError((err as Error).message);
      load(); // zuruecksetzen auf den echten Stand
    }
  };

  // Notfallzugriff: die Begründung ist Pflicht, weil genau sie den Unterschied
  // zwischen kontrolliertem Zugriff und stiller Hintertür ausmacht.
  const requestBreakGlass = async (wsId: string, wsName: string) => {
    setError(null);
    const reason = await promptText(`Notfallzugriff auf „${wsName}" — warum?`, {
      placeholder: 'z.B. Rechtliche Prüfung Az. …, Freigabe durch …',
    });
    if (!reason?.trim()) return;
    try {
      const res = await api.breakGlass(wsId, reason.trim());
      const until = new Date(res.expiresAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      toast(`Lesezugriff auf „${wsName}" bis ${until} — die Verantwortlichen wurden informiert.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggleAdmin = async (u: User) => {
    setError(null);
    try {
      await api.updateUser(u.id, { isAdmin: !u.isAdmin });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Stilllegen ist der Normalfall beim Offboarding: Anmeldung zu, Sitzungen
  // beendet — aber alles bleibt zurechenbar und nichts verwaist.
  const toggleDisabled = async (u: User) => {
    setError(null);
    try {
      await api.setUserDisabled(u.id, !u.disabled);
      toast(u.disabled ? `${u.name} ist wieder aktiv.` : `${u.name} wurde stillgelegt.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Die Instanz weiterreichen. Danach ist der bisherige Owner ein gewöhnlicher
  // Admin — deshalb die ausführliche Rückfrage, die Folge ist nicht umkehrbar
  // (nur der neue Owner könnte sie zurückgeben).
  const handOver = async (u: User) => {
    setError(null);
    const ok = await confirm(
      `Die Instanz an ${u.name} übergeben?\n\n` +
        `${u.name} wird Owner: Notfallzugriff, Instanz-Sicherung, Konten löschen.\n` +
        'Du bist danach gewöhnlicher Admin und kannst das nicht selbst rückgängig machen.',
      { danger: true, confirmText: 'Übergeben' },
    );
    if (!ok) return;
    try {
      const r = await api.transferOwner(u.id);
      toast(`${r.owner} ist jetzt Owner dieser Instanz.`);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Löschen zeigt vorher, was daran hängt — und bietet den Export an, solange
  // es die Inhalte noch gibt. Vorher verschwand der persönliche Bereich
  // wortlos mit dem Konto.
  const remove = async (u: User) => {
    setError(null);
    let impact: Awaited<ReturnType<typeof api.deletionImpact>> | null = null;
    try {
      impact = await api.deletionImpact(u.id);
    } catch {
      /* Vorschau nicht verfügbar — unten wird das ausdrücklich gesagt */
    }
    const lines: string[] = [];
    // Ohne Vorschau darf der Dialog NICHT so aussehen, als wäre alles harmlos:
    // sonst bliebe von der Warnung genau der beruhigende Satz übrig, während
    // der persönliche Bereich trotzdem unwiederbringlich mitgelöscht wird.
    if (!impact) {
      lines.push(
        'Die Folgen konnten nicht geladen werden. Falls diese Person einen persönlichen Bereich hat, wird er mit allen Seiten unwiederbringlich mit gelöscht.',
      );
    }
    // ALLE persönlichen Bereiche, nicht nur der erste — gelöscht wird die ganze
    // Liste. Und die Mitgliederzahl gehört dazu: sie sagt, ob dort nur eigene
    // Notizen liegen.
    for (const p of impact?.personal ?? []) {
      lines.push(`Der persönliche Bereich „${p.name}" wird mit gelöscht (${p.pages} Seiten).`);
    }
    if (impact?.shared.length) {
      lines.push(
        `Bleibt erhalten, weil andere darin arbeiten: ${impact.shared
          .map((sw) => `„${sw.name}" (${sw.members} Mitglieder)`)
          .join(', ')} — die privaten Seiten dieser Person darin werden gelöscht.`,
      );
    }
    if (impact?.orphaned.length) {
      lines.push(
        `Ohne weiteren Verantwortlichen: ${impact.orphaned
          .map((o) => `„${o.name}" (${o.pages} Seiten)`)
          .join(', ')} — übernimmt der Owner.`,
      );
    }
    if (impact?.pages) {
      lines.push(`${impact.pages} Seiten in geteilten Workspaces bleiben bestehen.`);
    }
    lines.push('Stilllegen genügt meistens — dabei geht nichts verloren.');
    if (!(await confirm(`${u.name} endgültig löschen?\n\n${lines.join('\n')}`, { danger: true, confirmText: 'Löschen' }))) return;
    try {
      await api.deleteUser(u.id);
      setSelId(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const filtered = users.filter(
    (u) =>
      !query ||
      u.name.toLowerCase().includes(query.toLowerCase()) ||
      u.email.toLowerCase().includes(query.toLowerCase()),
  );
  const sel = users.find((u) => u.id === selId) ?? null;

  return (
    <Portal>
      <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dialog users-dialog" role="dialog" aria-modal="true" aria-label="Nutzerverwaltung">
          <div className="users-head">
            <h2>Nutzerverwaltung</h2>
            <button className="btn-sm" onClick={() => { setInviting(true); setSelId(null); }}>+ Nutzer</button>
          </div>
          {error && <div className="login-error">{error}</div>}
          <div className="users-body">
            <aside className="users-list-pane">
              <input
                className="users-search"
                placeholder="Suchen…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="users-list-scroll">
                {filtered.map((u) => (
                  <button
                    key={u.id}
                    className={'users-list-item' + (!inviting && selId === u.id ? ' active' : '')}
                    onClick={() => { setInviting(false); setSelId(u.id); }}
                  >
                    <Avatar user={u} size={28} />
                    <span className="users-li-text">
                      <span className="users-li-name">
                        {u.name}
                        {u.disabled && <span className="badge">stillgelegt</span>}
                        {u.orgRole === 'owner'
                          ? <span className="badge">owner</span>
                          : u.isAdmin && <span className="badge">admin</span>}
                      </span>
                      <span className="users-li-email">{u.email}</span>
                    </span>
                  </button>
                ))}
                {filtered.length === 0 && <div className="dialog-hint">Niemand gefunden.</div>}
              </div>
            </aside>

            <section className="users-detail-pane">
              {inviting ? (
                <InvitePanel
                  workspaces={access.workspaces}
                  onCancel={() => setInviting(false)}
                  onCreated={() => { setInviting(false); load(); }}
                />
              ) : sel ? (
                <>
                  <div className="users-detail-head">
                    <Avatar user={sel} size={48} />
                    <div className="users-detail-id">
                      <div className="users-detail-name">
                        {sel.name}
                        {sel.orgRole === 'owner'
                          ? <span className="badge">Instanz-Owner</span>
                          : sel.isAdmin && <span className="badge">Instanz-Admin</span>}
                      </div>
                      <div className="users-detail-email">{sel.email}</div>
                    </div>
                  </div>

                  {/* Der Owner betreibt die Instanz — er lässt sich hier weder
                      degradieren noch löschen, sonst stünde sie ohne
                      Verantwortlichen da. */}
                  <div className="users-detail-actions">
                    {sel.id !== me.id && sel.orgRole !== 'owner' && (
                      <button className="btn-sm" onClick={() => void toggleAdmin(sel)}>
                        {sel.isAdmin ? 'Admin-Rechte entziehen' : 'Zum Instanz-Admin machen'}
                      </button>
                    )}
                    {sel.id !== me.id && sel.orgRole !== 'owner' && (
                      <button className="btn-sm" onClick={() => void toggleDisabled(sel)}>
                        {sel.disabled ? 'Wieder aktivieren' : 'Konto stilllegen'}
                      </button>
                    )}
                    {/* Löschen vernichtet den persönlichen Bereich des Kontos.
                        Das ist Datenkontrolle und liegt beim Owner — ein Admin
                        legt still, dabei geht nichts verloren. */}
                    {sel.id !== me.id && sel.orgRole !== 'owner' && me.orgRole === 'owner' && (
                      <button className="btn-sm danger" onClick={() => void remove(sel)}>
                        Nutzer löschen
                      </button>
                    )}
                    {sel.id !== me.id && sel.orgRole !== 'owner' && me.orgRole !== 'owner' && (
                      <span className="dialog-hint">
                        Endgültig löschen kann nur der Owner — mit dem Konto verschwände auch
                        der persönliche Bereich dieser Person.
                      </span>
                    )}
                    {/* Übergabe: nur der Owner, nur an ein aktives Admin-Konto.
                        Ohne diesen Weg wäre die Rolle nicht weiterzureichen —
                        und zwei Fehlermeldungen raten genau dazu. */}
                    {me.orgRole === 'owner' && sel.id !== me.id && sel.isAdmin && !sel.disabled && (
                      <button className="btn-sm" onClick={() => void handOver(sel)}>
                        Instanz übergeben
                      </button>
                    )}
                    {sel.orgRole === 'owner' && (
                      <span className="dialog-hint">
                        Der Owner betreibt diese Instanz — seine Rolle wird hier nicht geändert.
                      </span>
                    )}
                  </div>

                  <h3 className="users-section-title">Workspace-Zugriff</h3>
                  <div className="ws-access-list">
                    {access.workspaces.map((ws) => {
                      const role = roleOf(sel.id, ws.id);
                      // Der Server lässt Rollenänderungen nur zu, wo sie
                      // zustehen: nie für sich selbst (dafür gibt es den
                      // Notfallzugriff), und als Admin nur in eigenen
                      // Workspaces. Die Oberfläche zeigt dieselbe Grenze,
                      // statt Klicks in ein 403 laufen zu lassen.
                      const mayEdit =
                        sel.id !== me.id &&
                        (me.orgRole === 'owner' || roleOf(me.id, ws.id) === 'admin');
                      const mayPeek = sel.id === me.id && me.orgRole === 'owner' && role === 'none';
                      return (
                        <div key={ws.id} className={'ws-access-row' + (role !== 'none' ? ' has-access' : '')}>
                          <span className="ws-access-name">{ws.name}</span>
                          {mayPeek && (
                            <button
                              className="btn-sm"
                              title="Befristete Einsicht mit Begründung — wird protokolliert und den Verantwortlichen angezeigt"
                              onClick={() => void requestBreakGlass(ws.id, ws.name)}
                            >
                              Notfallzugriff
                            </button>
                          )}
                          <div className="ws-role-seg">
                            {ROLES.map((r) => (
                              <button
                                key={r.v}
                                className={'ws-role-btn' + (role === r.v ? ' active' : '')}
                                disabled={!mayEdit}
                                title={
                                  mayEdit
                                    ? undefined
                                    : sel.id === me.id
                                      ? 'Eigenen Zugriff kann man sich hier nicht geben.'
                                      : 'Nur der Owner oder ein Admin dieses Workspace kann das ändern.'
                                }
                                onClick={() => void setRole(sel.id, ws.id, r.v)}
                              >
                                {r.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {access.workspaces.length === 0 && (
                      <div className="dialog-hint">Noch keine Workspaces.</div>
                    )}
                  </div>
                </>
              ) : (
                <div className="dialog-hint users-empty">Wähle links einen Nutzer.</div>
              )}
            </section>
          </div>
          <div className="dialog-actions">
            <button className="btn" onClick={onClose}>Schließen</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

// Einladen mit Workspace-Zuweisung: Name/E-Mail/Passwort, Instanz-Admin, und
// je Workspace eine Rolle (Standard: Kein Zugriff, damit man bewusst zuweist).
function InvitePanel({
  workspaces,
  onCancel,
  onCreated,
}: {
  workspaces: WsRef[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const ws = workspaces
        .map((w) => ({ id: w.id, role: roles[w.id] ?? 'none' }))
        .filter((w) => w.role !== 'none');
      await api.createUser({ name, email, password, isAdmin, workspaces: ws });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="invite-panel" onSubmit={submit}>
      <div className="users-detail-head">
        <div className="invite-avatar-placeholder">+</div>
        <div className="users-detail-id">
          <div className="users-detail-name">Neuen Nutzer anlegen</div>
          <div className="users-detail-email">Legt sofort ein Konto an — kein E-Mail-Versand.</div>
        </div>
      </div>
      <label className="profile-label">Name</label>
      <input className="prop-input profile-input" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="profile-label">E-Mail</label>
      <input className="prop-input profile-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="profile-label">Startpasswort (mind. 8 Zeichen)</label>
      <input className="prop-input profile-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <label className="check-label" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
        Instanz-Admin (darf alles verwalten)
      </label>

      <h3 className="users-section-title">Workspace-Zugriff</h3>
      <div className="ws-access-list">
        {workspaces.map((ws) => {
          const role = roles[ws.id] ?? 'none';
          return (
            <div key={ws.id} className={'ws-access-row' + (role !== 'none' ? ' has-access' : '')}>
              <span className="ws-access-name">{ws.name}</span>
              <div className="ws-role-seg">
                {ROLES.map((r) => (
                  <button
                    type="button"
                    key={r.v}
                    className={'ws-role-btn' + (role === r.v ? ' active' : '')}
                    onClick={() => setRoles((m) => ({ ...m, [ws.id]: r.v }))}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {error && <div className="login-error">{error}</div>}
      <div className="invite-actions">
        <button type="button" className="btn" onClick={onCancel}>Abbrechen</button>
        <button className="btn primary" type="submit" disabled={busy}>Nutzer anlegen</button>
      </div>
    </form>
  );
}

function TokensModal({ onClose }: { onClose: () => void }) {
  useExclusiveModal(onClose);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('write');
  const [wsMode, setWsMode] = useState<'all' | 'some'>('all');
  const [pickedWs, setPickedWs] = useState<string[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<'token' | 'cmd' | null>(null);
  const [publicBase, setPublicBase] = useState(window.location.origin);

  const load = () => void api.listTokens().then(setTokens);
  useEffect(() => {
    void api
      .publicBase()
      .then((r) => r.base && setPublicBase(r.base.replace(/\/$/, '')))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    void api.listWorkspaces().then(setWorkspaces);
  }, []);

  const wsName = (id: string) => workspaces.find((w) => w.id === id)?.name ?? id;
  const toggleWs = (id: string) =>
    setPickedWs((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    // Guard the fail-open: "specific workspaces" with nothing picked must not
    // silently create an all-workspaces token (the server rejects it too).
    if (wsMode === 'some' && pickedWs.length === 0) {
      toast('Bitte mindestens einen Workspace auswählen (oder „Alle Workspaces").');
      return;
    }
    const chosen = wsMode === 'some' ? pickedWs : [];
    const res = await api.createToken(name || 'API token', scope, chosen);
    setFresh(res.token);
    setName('');
    setWsMode('all');
    setPickedWs([]);
    setCopied(null);
    load();
  };

  // A ready-to-paste connection command. The base is the instance's PUBLIC
  // address (domain/tunnel) when one is configured — an agent host outside the
  // LAN can't reach the internal address this browser happens to use. The token
  // rides in the URL so clients without a headers UI work too.
  const mcpCommand = fresh ? `claude mcp add --transport http salt ${publicBase}/mcp/${fresh}` : '';

  return (
    <Portal>
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog">
        <h2>API tokens</h2>
        <p className="dialog-hint">
          Tokens let agents and scripts use the REST API and the MCP endpoint
          (<code>/mcp</code>) with <code>Authorization: Bearer &lt;token&gt;</code>.
        </p>
        {fresh && (
          <div className="token-fresh">
            <div>Copy this token now — it won't be shown again:</div>
            <code>{fresh}</code>
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(fresh);
                setCopied('token');
              }}
            >
              {copied === 'token' ? 'Copied ✓' : 'Copy token'}
            </button>
            <div style={{ marginTop: 10 }}>
              Or connect an agent in one step — paste this into your terminal:
            </div>
            <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{mcpCommand}</code>
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(mcpCommand);
                setCopied('cmd');
              }}
            >
              {copied === 'cmd' ? 'Copied ✓' : 'Copy MCP command'}
            </button>
          </div>
        )}
        <div className="user-list">
          {tokens.map((t) => (
            <div key={t.id} className="user-row">
              <span className="user-row-name">
                <Key size={13} /> {t.name}{' '}
                <span className={'token-scope ' + (t.scope === 'read' ? 'read' : 'write')}>
                  {t.scope === 'read' ? 'read-only' : 'read-write'}
                </span>
              </span>
              <span className="user-row-email">
                {t.workspaces.length === 0
                  ? 'all workspaces'
                  : t.workspaces.map(wsName).join(', ')}
                {' · '}
                {t.lastUsedAt ? `used ${t.lastUsedAt.slice(0, 10)}` : 'never used'}
              </span>
              <button
                className="icon-btn danger"
                title="Revoke"
                onClick={async () => {
                  await api.deleteToken(t.id);
                  load();
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {tokens.length === 0 && <div className="dialog-hint">No tokens yet.</div>}
        </div>
        <form className="user-add" onSubmit={create} style={{ flexWrap: 'wrap' }}>
          <input value={name} placeholder="Token name (e.g. claude-code)" onChange={(e) => setName(e.target.value)} />
          <select
            className="prop-select"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'read' | 'write')}
            title="Read-only tokens cannot create, edit, delete or upload"
          >
            <option value="write">Read-write</option>
            <option value="read">Read-only</option>
          </select>
          <select
            className="prop-select"
            value={wsMode}
            onChange={(e) => setWsMode(e.target.value as 'all' | 'some')}
            title="Limit which workspaces this token can reach"
          >
            <option value="all">All workspaces</option>
            <option value="some">Specific workspaces…</option>
          </select>
          <button className="btn primary" type="submit">Create token</button>
          {wsMode === 'some' && (
            <div className="token-ws-picker" style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
              {workspaces.map((w) => (
                <label key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={pickedWs.includes(w.id)}
                    onChange={() => toggleWs(w.id)}
                  />
                  {w.name}
                </label>
              ))}
              {workspaces.length === 0 && <span className="dialog-hint">No workspaces.</span>}
            </div>
          )}
        </form>
        <button className="btn dialog-close" onClick={onClose}>Close</button>
      </div>
    </div>
    </Portal>
  );
}
