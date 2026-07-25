import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { PageMeta, User, Workspace } from '../types';
import UserMenu from './UserMenu';
import WorkspaceMembers from './WorkspaceMembers';
import { promptText } from '../dialog';
import { toast } from '../toast';
import Portal from './Portal';
import IconPicker from './IconPicker';
import { PageIcon } from '../pageIcon';
import AgentConnectModal from './AgentConnect';
import BreakGlassLog from './BreakGlassLog';
import { useExclusiveModal, useMenuDismiss } from '../modal';
import { Sun, Moon, Search, Network, Plus, Table2, FileText, Trash2, LayoutTemplate, Tag, ChevronRight, ChevronDown, Users, Check, Download, Upload, Image, PanelLeftClose, PanelLeftOpen, Pencil, Star, ShieldAlert } from 'lucide-react';
import { tagColorClass } from '../tags';
import ThemeSwitch, { type ThemePref } from '../ThemeSwitch';

interface Props {
  pages: PageMeta[];
  favorites: string[];
  workspaces: Workspace[];
  currentWs: string;
  tagColors: Record<string, string>;
  onSwitchWorkspace: (id: string) => void;
  onWorkspacesChanged: () => void;
  user: User;
  onUserChanged?: (u: User) => void;
  // Instanz erlaubt Nicht-Admins das Anlegen von Workspaces? (W97)
  canCreateWorkspace?: boolean;
  currentId: string | null;
  open: boolean;
  onCollapse: () => void;
  onNavigate: (id: string) => void;
  onOpenInNewTab: (id: string) => void;
  onCreate: (parentId: string | null, type?: 'doc' | 'collection') => void;
  onTrash: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
  onMove: (id: string, parentId: string | null, position: number) => void;
  onToggleFavorite: (id: string) => void;
  onOpenSearch: () => void;
  onOpenIndex: () => void;
  theme: 'light' | 'dark';
  themePref: ThemePref;
  onSetTheme: (v: ThemePref) => void;
  onLogout: () => void;
  // Bear-style notes mode: the notes list (middle column) is the only place
  // documents appear, so the sidebar drops its document tree and its tag chips
  // filter THAT list instead of the tree.
  notesMode?: boolean;
  activeTag?: string | null;
  onSelectTag?: (tag: string | null) => void;
  // Raw user setting (independent of viewport) + toggle, shown in the UserMenu.
  notesModeSetting?: boolean;
  onToggleNotesMode?: () => void;
  // Desktop collapse state: when collapsed, the sidebar appears as a hover
  // overlay and the collapse button flips into a "pin open" button — so users
  // can re-pin right from the overlay instead of hunting the hamburger behind it.
  collapsed?: boolean;
  onExpand?: () => void;
}

interface DropTarget {
  id: string;
  zone: 'before' | 'after' | 'inside';
}

// Everything TreeItem needs from Sidebar. TreeItem lives at module level so
// its component identity is stable — defining it inside Sidebar would remount
// the whole tree (and kill drag state) on every render.
interface TreeCtx {
  childrenMap: Map<string, PageMeta[]>;
  expanded: Set<string>;
  currentId: string | null;
  favorites: Set<string>;
  dropTarget: DropTarget | null;
  menuFor: string | null;
  onNavigate: (id: string) => void;
  onOpenInNewTab: (id: string) => void;
  toggleExpand: (id: string) => void;
  onCreateChild: (id: string) => void;
  setMenuFor: (id: string | null) => void;
  onTrash: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  workspaces: Workspace[];
  onMoveToWorkspace: (pageId: string, wsId: string, wsName: string) => void;
  dragStart: (id: string, e: React.DragEvent) => void;
  dragOver: (p: PageMeta, e: React.DragEvent) => void;
  dragLeave: (id: string) => void;
  drop: (p: PageMeta, e: React.DragEvent) => void;
  dragEnd: () => void;
}

// DbRows lazily loads and lists a database's rows when it is expanded in the
// tree — Notion-style "open a database to see its entries".
function DbRows({
  collectionId,
  depth,
  onNavigate,
}: {
  collectionId: string;
  depth: number;
  onNavigate: (id: string) => void;
}) {
  const [rows, setRows] = useState<{ id: string; title: string; icon: string }[] | null>(null);
  useEffect(() => {
    let alive = true;
    void api
      .collectionRows(collectionId, { limit: 50 })
      .then((res) => alive && setRows(res.rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon }))))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [collectionId]);
  const pad = { paddingLeft: 6 + depth * 14 };
  if (rows === null) return <div className="tree-db-empty" style={pad}>Lädt…</div>;
  if (rows.length === 0) return <div className="tree-db-empty" style={pad}>Keine Einträge</div>;
  return (
    <div className="tree-db-rows">
      {rows.map((r) => (
        <div key={r.id} className="tree-db-row" style={pad} onClick={() => onNavigate(r.id)}>
          <span className="tree-icon"><PageIcon icon={r.icon} size={14} fallback={<FileText size={14} />} /></span>
          <span className="tree-title">{r.title || 'Untitled'}</span>
        </div>
      ))}
    </div>
  );
}

// A collapsible sidebar section with a count and its own "new" action.
// Sections keep the sidebar navigable once a workspace grows: collapse what you
// don't need instead of scrolling one endless list. The open/closed state is
// remembered per section.
function SidebarSection({
  id,
  label,
  icon,
  count,
  createTitle,
  onCreate,
  defaultOpen = true,
  children,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  count: number;
  createTitle?: string;
  onCreate?: () => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const key = 'salt-sec-' + id;
  const [open, setOpen] = useState(() => {
    const v = localStorage.getItem(key);
    return v === null ? defaultOpen : v === '1';
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(key, o ? '0' : '1');
      } catch {
        /* private mode */
      }
      return !o;
    });

  return (
    <div className={'sb-section' + (open ? ' open' : '')}>
      <div className="sb-section-head">
        {/* Ein Topic sieht aus wie eine Zeile, nur kräftiger: Icon links, Titel,
            Anzahl, Chevron rechts. Keine Mikro-Überschrift mehr — eine einzige
            Zeilensprache für die ganze Seitenleiste. */}
        <button className="sb-section-toggle" onClick={toggle} aria-expanded={open}>
          <span className="sb-section-icon">{icon}</span>
          <span className="sb-section-label">{label}</span>
          <span className="sb-section-count">{count}</span>
          <span className="sb-section-caret">
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
        </button>
        {onCreate && (
          <button
            className="sb-section-add"
            title={createTitle}
            aria-label={createTitle}
            onClick={(e) => {
              e.stopPropagation();
              if (!open) toggle();
              onCreate();
            }}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      {open && <div className="sb-section-body">{children}</div>}
    </div>
  );
}

// One flat row — no chevron, no nesting. Used by the favourites and template
// lists, where the tree hierarchy would be noise.
function FlatRow({
  p,
  active,
  parentLabel,
  onNavigate,
  action,
}: {
  p: PageMeta;
  active: boolean;
  parentLabel?: string;
  onNavigate: (id: string) => void;
  action?: React.ReactNode;
}) {
  return (
    <div className={'tree-item sb-flat' + (active ? ' active' : '')} onClick={() => onNavigate(p.id)}>
      <span className="chevron spacer" />
      <span className="tree-icon">
        <PageIcon
          icon={p.icon}
          size={15}
          fallback={p.type === 'collection' ? <Table2 size={15} /> : <FileText size={15} />}
        />
      </span>
      <span className="sb-flat-text">
        <span className="tree-title">{p.title || 'Untitled'}</span>
        {parentLabel && <span className="sb-flat-parent">{parentLabel}</span>}
      </span>
      {action && (
        <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
          {action}
        </span>
      )}
    </div>
  );
}

function TreeItem({ p, depth, ctx }: { p: PageMeta; depth: number; ctx: TreeCtx }) {
  const kids = ctx.childrenMap.get(p.id) ?? [];
  const isDb = p.type === 'collection';
  // Databases have no tree children (their rows are excluded from /api/pages) but
  // can be expanded to lazily reveal their rows — so they get a chevron too.
  const hasExpand = kids.length > 0 || isDb;
  const isExpanded = ctx.expanded.has(p.id);
  const dt = ctx.dropTarget?.id === p.id ? ctx.dropTarget.zone : null;
  // Row context menu (⋯): close on outside click / Escape, not just mouse-leave.
  const actionsRef = useRef<HTMLSpanElement>(null);
  useMenuDismiss(ctx.menuFor === p.id, actionsRef, () => ctx.setMenuFor(null));
  return (
    <div>
      <div
        className={
          'tree-item' +
          (p.id === ctx.currentId ? ' active' : '') +
          (dt === 'inside' ? ' drop-inside' : '') +
          (dt === 'before' ? ' drop-before' : '') +
          (dt === 'after' ? ' drop-after' : '')
        }
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable
        onDragStart={(e) => ctx.dragStart(p.id, e)}
        onDragOver={(e) => ctx.dragOver(p, e)}
        onDragLeave={() => ctx.dragLeave(p.id)}
        onDrop={(e) => ctx.drop(p, e)}
        onDragEnd={ctx.dragEnd}
        onClick={(e) => (e.metaKey || e.ctrlKey ? ctx.onOpenInNewTab(p.id) : ctx.onNavigate(p.id))}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            ctx.onOpenInNewTab(p.id);
          }
        }}
      >
        {hasExpand ? (
          <button
            className="chevron"
            onClick={(e) => {
              e.stopPropagation();
              ctx.toggleExpand(p.id);
            }}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="chevron spacer" />
        )}
        <span className="tree-icon"><PageIcon icon={p.icon} size={15} fallback={p.type === 'collection' ? <Table2 size={15} /> : <FileText size={15} />} /></span>
        <span className="tree-title">{p.title || 'Untitled'}</span>
        <span className="tree-actions" onClick={(e) => e.stopPropagation()} ref={actionsRef}>
          <button title="Add sub-page" onClick={() => ctx.onCreateChild(p.id)}>
            +
          </button>
          <button
            title="More"
            onClick={() => ctx.setMenuFor(ctx.menuFor === p.id ? null : p.id)}
          >
            ⋯
          </button>
          {ctx.menuFor === p.id && (
            <div className="menu">
              <button
                onClick={() => {
                  ctx.setMenuFor(null);
                  ctx.onToggleFavorite(p.id);
                }}
              >
                {ctx.favorites.has(p.id) ? '★ Remove from favorites' : '☆ Add to favorites'}
              </button>
              <button
                onClick={() => {
                  ctx.setMenuFor(null);
                  ctx.onDuplicate(p.id);
                }}
              >
                ⧉ Duplizieren
              </button>
              {ctx.workspaces.length > 1 && (
                <div className="menu-sub">
                  <div className="menu-label">In Workspace verschieben</div>
                  {ctx.workspaces
                    .filter((w) => w.id !== p.workspaceId)
                    .map((w) => (
                      <button
                        key={w.id}
                        onClick={() => {
                          ctx.setMenuFor(null);
                          ctx.onMoveToWorkspace(p.id, w.id, w.name);
                        }}
                      >
                        → {w.name}
                      </button>
                    ))}
                </div>
              )}
              <button
                onClick={() => {
                  ctx.setMenuFor(null);
                  void api
                    .updatePage(p.id, { isTemplate: !p.isTemplate })
                    .catch(() => toast('Template-Markierung fehlgeschlagen'));
                }}
              >
                {p.isTemplate ? '📋 Template-Markierung entfernen' : '📋 Als Template markieren'}
              </button>
              <button
                onClick={() => {
                  ctx.setMenuFor(null);
                  api.download(`/api/export/${p.id}`);
                }}
              >
                ⤓ Export Markdown
              </button>
              <button
                className="danger"
                onClick={() => {
                  ctx.setMenuFor(null);
                  ctx.onTrash(p.id);
                }}
              >
                🗑 Move to trash
              </button>
            </div>
          )}
        </span>
      </div>
      {isExpanded && isDb && <DbRows collectionId={p.id} depth={depth + 1} onNavigate={ctx.onNavigate} />}
      {isExpanded &&
        !isDb &&
        kids.map((k) => <TreeItem key={k.id} p={k} depth={depth + 1} ctx={ctx} />)}
    </div>
  );
}

export default function Sidebar({
  pages,
  favorites,
  workspaces,
  currentWs,
  tagColors,
  onSwitchWorkspace,
  onWorkspacesChanged,
  user,
  onUserChanged,
  canCreateWorkspace = true,
  currentId,
  open,
  onCollapse,
  onNavigate,
  onOpenInNewTab,
  onCreate,
  onTrash,
  onDuplicate,
  onRestore,
  onDeleteForever,
  onMove,
  onToggleFavorite,
  onOpenSearch,
  onOpenIndex,
  theme,
  themePref,
  onSetTheme,
  onLogout,
  notesMode = false,
  activeTag = null,
  onSelectTag,
  notesModeSetting = false,
  onToggleNotesMode,
  collapsed = false,
  onExpand,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [trashOpen, setTrashOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragId = useRef<string | null>(null);
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const byIdAll = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const favPages = useMemo(
    () =>
      favorites
        .map((id) => byIdAll.get(id))
        .filter((p): p is PageMeta => !!p && !p.trashed),
    [favorites, byIdAll],
  );

  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const wsMenuRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(wsMenuOpen, wsMenuRef, () => setWsMenuOpen(false));
  const [membersOpen, setMembersOpen] = useState(false);
  const [wsImageOpen, setWsImageOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  // Only show the pages of the selected workspace (fall back to all if the
  // list hasn't loaded a workspace id yet).
  const inWs = (p: PageMeta) => !currentWs || p.workspaceId === currentWs;

  // Tag counts across the current workspace's live pages (derived locally from
  // the already-loaded tree list — no extra request).
  // Aggregate case-insensitively (key by lower-case, keep first-seen spelling)
  // so "Work" and "work" are one chip — matching the server's tag dedupe.
  const tagCounts = useMemo(() => {
    const count = new Map<string, number>();
    const label = new Map<string, string>();
    for (const p of pages) {
      if (p.trashed || !inWs(p)) continue;
      for (const t of p.tags ?? []) {
        const k = t.toLowerCase();
        if (!label.has(k)) label.set(k, t);
        count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
    return [...count.entries()]
      .map(([k, n]) => [label.get(k) as string, n] as [string, number])
      .sort((a, b) => b[1] - a[1] || a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, currentWs]);
  const taggedPages = useMemo(
    () =>
      tagFilter
        ? pages.filter(
            (p) =>
              !p.trashed &&
              inWs(p) &&
              (p.tags ?? []).some((t) => t.toLowerCase() === tagFilter.toLowerCase()),
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, currentWs, tagFilter],
  );

  const templatePages = useMemo(
    () => pages.filter((p) => p.isTemplate && !p.trashed && inWs(p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, currentWs],
  );

  const instantiateTemplate = async (id: string) => {
    try {
      const r = await api.duplicatePage(id, true);
      onNavigate(r.id);
    } catch {
      toast('Template konnte nicht verwendet werden');
    }
  };

  const { childrenMap, parentKeyOf, trashRoots } = useMemo(() => {
    const visible = pages.filter((p) => !p.trashed && inWs(p));
    const visibleIds = new Set(visible.map((p) => p.id));
    const childrenMap = new Map<string, PageMeta[]>();
    const parentKeyOf = new Map<string, string>();
    for (const p of visible) {
      const key = p.parentId && visibleIds.has(p.parentId) ? p.parentId : '';
      parentKeyOf.set(p.id, key);
      childrenMap.set(key, [...(childrenMap.get(key) ?? []), p]);
    }
    for (const list of childrenMap.values()) {
      list.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    }
    const trashedIds = new Set(pages.filter((p) => p.trashed).map((p) => p.id));
    const trashRoots = pages.filter(
      (p) => p.trashed && inWs(p) && (!p.parentId || !trashedIds.has(p.parentId)),
    );
    return { childrenMap, parentKeyOf, trashRoots };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, currentWs]);

  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);

  const isAncestor = (maybeAncestor: string, id: string): boolean => {
    let cur = byId.get(id);
    let guard = 0;
    while (cur?.parentId && guard++ < 100) {
      if (cur.parentId === maybeAncestor) return true;
      cur = byId.get(cur.parentId);
    }
    return false;
  };

  const canDropOn = (targetId: string) => {
    const id = dragId.current;
    return !!id && id !== targetId && !isAncestor(id, targetId);
  };

  const expand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleDrop = (target: PageMeta, zone: DropTarget['zone']) => {
    const id = dragId.current;
    if (!id || !canDropOn(target.id)) return;
    if (zone === 'inside') {
      const kids = (childrenMap.get(target.id) ?? []).filter((k) => k.id !== id);
      const pos = kids.length ? kids[kids.length - 1].position + 1 : 1;
      onMove(id, target.id, pos);
      expand(target.id);
    } else {
      const key = parentKeyOf.get(target.id) ?? '';
      const siblings = (childrenMap.get(key) ?? []).filter((k) => k.id !== id);
      const idx = siblings.findIndex((s) => s.id === target.id);
      let pos: number;
      if (zone === 'before') {
        const prev = siblings[idx - 1];
        pos = prev ? (prev.position + target.position) / 2 : target.position - 1;
      } else {
        const next = siblings[idx + 1];
        pos = next ? (target.position + next.position) / 2 : target.position + 1;
      }
      onMove(id, key === '' ? null : key, pos);
    }
  };

  const ctx: TreeCtx = {
    childrenMap,
    expanded,
    onOpenInNewTab,
    currentId,
    favorites: favSet,
    dropTarget,
    menuFor,
    onNavigate,
    toggleExpand,
    onCreateChild: (id) => {
      onCreate(id);
      expand(id);
    },
    setMenuFor,
    onTrash,
    onDuplicate,
    onToggleFavorite,
    workspaces,
    onMoveToWorkspace: (pageId, wsId, wsName) => {
      // Der Umzug nimmt den ganzen Unterbaum mit und legt die Seite im Ziel
      // auf oberster Ebene ab — der bisherige Elternteil bleibt zurück.
      void api
        .updatePage(pageId, { workspaceId: wsId })
        .then(() => {
          toast(`Nach „${wsName}" verschoben`);
          // Der Seitenbaum aktualisiert sich über den Änderungs-Feed des
          // Servers (pagesChanged); hier nur die Workspace-Zähler nachziehen.
          onWorkspacesChanged();
        })
        .catch((e: Error) => toast(e.message || 'Verschieben fehlgeschlagen'));
    },
    dragStart: (id, e) => {
      dragId.current = id;
      // Firefox ignores drags without data.
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
    },
    dragOver: (p, e) => {
      if (!canDropOn(p.id)) return; // no preventDefault → browser shows no-drop
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const zone: DropTarget['zone'] =
        y < rect.height * 0.3 ? 'before' : y > rect.height * 0.7 ? 'after' : 'inside';
      setDropTarget((t) => (t?.id === p.id && t.zone === zone ? t : { id: p.id, zone }));
    },
    dragLeave: (id) => setDropTarget((t) => (t?.id === id ? null : t)),
    drop: (p, e) => {
      e.preventDefault();
      const t = dropTarget;
      setDropTarget(null);
      if (t?.id === p.id) handleDrop(p, t.zone);
    },
    dragEnd: () => {
      dragId.current = null;
      setDropTarget(null);
    },
  };

  const activeWs = workspaces.find((w) => w.id === currentWs);
  // Split the top level into documents vs databases so the sidebar shows them
  // as clearly separated sections (nested items stay under their parent).
  const topLevel = childrenMap.get('') ?? [];
  const topDocs = topLevel.filter((p) => p.type !== 'collection');
  const topDbs = topLevel.filter((p) => p.type === 'collection');
  // Filtering searches the WHOLE section, not just its top level — a nested
  // page you can't see is exactly the one you're trying to find. Hits render
  // flat (with their parent as context) because tree indentation is noise once
  // the list is already narrowed down.
  const allDocs = useMemo(
    () => pages.filter((p) => !p.trashed && !p.isTemplate && inWs(p) && p.type !== 'collection'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, currentWs],
  );
  const allDbs = useMemo(
    () => pages.filter((p) => !p.trashed && inWs(p) && p.type === 'collection'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, currentWs],
  );
  const renameWorkspace = async () => {
    if (!activeWs) return;
    const name = await promptText('Workspace umbenennen', {
      defaultValue: activeWs.name,
      placeholder: 'Neuer Name',
      confirmText: 'Umbenennen',
    });
    if (!name?.trim() || name.trim() === activeWs.name) return;
    try {
      await api.updateWorkspace(activeWs.id, { name: name.trim() });
      onWorkspacesChanged();
      toast('Workspace umbenannt');
    } catch (e) {
      toast((e as Error).message || 'Umbenennen fehlgeschlagen');
    }
  };

  // Deleting takes every page in the workspace with it, so the name has to be
  // typed out — a yes/no dialog is too easy to click through by accident.
  const deleteWorkspace = async () => {
    if (!activeWs) return;
    const typed = await promptText(
      `„${activeWs.name}" und ALLE Seiten darin unwiderruflich löschen?\n\nTippe zur Bestätigung den Namen des Workspace ein:`,
      { placeholder: activeWs.name, confirmText: 'Endgültig löschen' },
    );
    if (typed === null) return;
    try {
      await api.deleteWorkspace(activeWs.id, typed.trim());
      toast('Workspace gelöscht');
      const next = workspaces.find((w) => w.id !== activeWs.id);
      onWorkspacesChanged();
      if (next) onSwitchWorkspace(next.id);
    } catch (e) {
      toast((e as Error).message || 'Löschen fehlgeschlagen');
    }
  };

  const newWorkspace = async () => {
    const name = await promptText('Name des neuen Workspace?', { placeholder: 'z.B. Team' });
    if (!name?.trim()) return;
    try {
      const ws = await api.createWorkspace(name.trim());
      onWorkspacesChanged();
      onSwitchWorkspace(ws.id);
      setWsMenuOpen(false);
    } catch {
      toast('Workspace konnte nicht erstellt werden');
    }
  };

  const [bgLogOpen, setBgLogOpen] = useState(false);
  // "Für alle öffnen": neue Konten treten diesem Workspace automatisch bei.
  // Ersetzt die alte stille Regel, nach der jeder Neuzugang im ältesten
  // Workspace landete.
  const toggleAutoJoin = async () => {
    if (!activeWs) return;
    const next = !activeWs.autoJoin;
    try {
      await api.updateWorkspace(activeWs.id, { autoJoin: next });
      onWorkspacesChanged();
      toast(
        next
          ? `„${activeWs.name}" steht ab jetzt jedem neuen Konto offen.`
          : `„${activeWs.name}" wird neuen Konten nicht mehr zugewiesen.`,
      );
    } catch (e) {
      toast((e as Error).message || 'Konnte nicht geändert werden');
    }
  };

  const wsImportRef = useRef<HTMLInputElement | null>(null);
  const importWorkspace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // gleiche Datei erneut wählbar
    if (!file) return;
    toast('Workspace wird importiert…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/workspaces/import', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error || `Import fehlgeschlagen (HTTP ${res.status})`);
      }
      const out = (await res.json()) as { workspaceId: string; name: string; pages: number };
      toast(`„${out.name}" importiert — ${out.pages} Seiten`);
      onWorkspacesChanged();
      onSwitchWorkspace(out.workspaceId);
    } catch (err) {
      toast((err as Error).message || 'Import fehlgeschlagen');
    }
  };

  return (
    <aside className={'sidebar' + (open ? ' open' : '')}>
      <div className="sidebar-header">
        <div className="ws-switcher" ref={wsMenuRef}>
          <button className="ws-btn" onClick={() => setWsMenuOpen((o) => !o)}>
            <WorkspaceAvatar ws={activeWs} />
            <strong>{activeWs?.name ?? 'Salt.md'}</strong>
            <ChevronDown size={14} className="ws-caret" />
          </button>
          {wsMenuOpen && (
            <div className="menu ws-menu">
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  className={'ws-menu-item' + (w.id === currentWs ? ' active' : '')}
                  onClick={() => {
                    onSwitchWorkspace(w.id);
                    setWsMenuOpen(false);
                  }}
                >
                  <WorkspaceAvatar ws={w} />
                  <span className="ws-menu-name">{w.name}</span>
                  {w.personal && <span className="ws-tag">eigener Bereich</span>}
                  {w.autoJoin && !w.personal && <span className="ws-tag">für alle</span>}
                  {w.id === currentWs && <Check size={14} />}
                </button>
              ))}
              <div className="menu-sep" />
              {activeWs?.role === 'admin' && (
                <button className="menu-item" onClick={() => { setWsMenuOpen(false); void renameWorkspace(); }}>
                  <Pencil size={15} /> Workspace umbenennen
                </button>
              )}
              {activeWs?.role === 'admin' && (
                <button className="menu-item" onClick={() => { setWsMenuOpen(false); setWsImageOpen(true); }}>
                  <Image size={15} /> Workspace-Bild
                </button>
              )}
              {currentWs && (
                <button className="menu-item" onClick={() => { setWsMenuOpen(false); setMembersOpen(true); }}>
                  <Users size={15} /> Mitglieder
                </button>
              )}
              {user.orgRole === 'owner' && activeWs && !activeWs.personal && (
                <button
                  className="menu-item"
                  title="Jedes neu angelegte Konto wird automatisch Mitglied dieses Workspace"
                  onClick={() => { setWsMenuOpen(false); void toggleAutoJoin(); }}
                >
                  <Users size={15} />
                  {activeWs.autoJoin ? 'Nicht mehr für alle öffnen' : 'Für alle neuen Nutzer öffnen'}
                </button>
              )}
              {activeWs?.role === 'admin' && (
                <button
                  className="menu-item"
                  title="Wer hat sich als Instanz-Owner Einsicht verschafft — und warum"
                  onClick={() => { setWsMenuOpen(false); setBgLogOpen(true); }}
                >
                  <ShieldAlert size={15} /> Notfallzugriffe
                </button>
              )}
              {currentWs && (
                <button
                  className="menu-item"
                  title="Natives Archiv: Seiten, Datenbanken, Dateien & Tags — 1:1 in einer anderen Instanz importierbar"
                  onClick={() => { setWsMenuOpen(false); api.download(`/api/workspaces/${currentWs}/export`); }}
                >
                  <Download size={15} /> Workspace exportieren
                </button>
              )}
              {currentWs && (
                <button
                  className="menu-item"
                  title="Nur die Inhalte dieses Workspace als Markdown-Dateien"
                  onClick={() => { setWsMenuOpen(false); api.download(`/api/export?workspace=${currentWs}`); }}
                >
                  <FileText size={15} /> Als Markdown exportieren
                </button>
              )}
              {canCreateWorkspace && (
                <button className="menu-item" onClick={() => { setWsMenuOpen(false); wsImportRef.current?.click(); }}>
                  <Upload size={15} /> Workspace importieren…
                </button>
              )}
              {canCreateWorkspace && (
                <button className="menu-item" onClick={newWorkspace}>
                  <Plus size={15} /> Neuer Workspace
                </button>
              )}
              {activeWs?.role === 'admin' && workspaces.length > 1 && (
                <button
                  className="menu-item danger"
                  onClick={() => { setWsMenuOpen(false); void deleteWorkspace(); }}
                >
                  <Trash2 size={15} /> Workspace löschen
                </button>
              )}
            </div>
          )}
          <input
            ref={wsImportRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={(e) => void importWorkspace(e)}
          />
        </div>
        <div className="sidebar-header-actions">
          <button className="icon-btn" title="Index — alle Seiten & Links" onClick={onOpenIndex}>
            <Network size={17} />
          </button>
          {collapsed ? (
            <button
              className="icon-btn collapse-btn pin-btn"
              title="Seitenleiste anpinnen"
              onClick={() => onExpand?.()}
            >
              <PanelLeftOpen size={17} />
            </button>
          ) : (
            <button
              className="icon-btn collapse-btn"
              title="Seitenleiste einklappen"
              onClick={(e) => {
                // This button lives inside the sidebar, so after the click it keeps
                // focus and the collapsed sidebar would stay revealed via the
                // :focus-within rule. Blur it so the sidebar actually slides away.
                e.currentTarget.blur();
                onCollapse();
              }}
            >
              <PanelLeftClose size={17} />
            </button>
          )}
        </div>
      </div>
      <button className="sidebar-search" onClick={onOpenSearch}>
        <span className="sidebar-item-label"><Search size={15} /> Search</span>
        <span className="kbd">⌘K</span>
      </button>
      {favPages.length > 0 && (
        <SidebarSection id="fav" label="Favoriten" icon={<Star size={17} />} count={favPages.length}>
          {favPages.map((p) => (
              <FlatRow
                key={p.id}
                p={p}
                active={p.id === currentId}
                onNavigate={onNavigate}
                action={
                  <button title="Aus Favoriten entfernen" onClick={() => onToggleFavorite(p.id)}>
                    ★
                  </button>
                }
              />
            ))
          }
        </SidebarSection>
      )}
      {tagCounts.length > 0 && (
        <SidebarSection id="tags" label="Tags" icon={<Tag size={17} />} count={tagCounts.length}>
          <div className="tag-cloud">
              {tagCounts.map(([t, n]) => (
                <button
                  key={t}
                  className={
                    'tag-chip ' +
                    tagColorClass(t, tagColors) +
                    ((notesMode ? activeTag === t : tagFilter === t) ? ' active' : '')
                  }
                  onClick={() =>
                    notesMode
                      ? onSelectTag?.(activeTag === t ? null : t)
                      : setTagFilter((cur) => (cur === t ? null : t))
                  }
                  title={`${n} Seite${n === 1 ? '' : 'n'}`}
                >
                  #{t} <span className="tag-chip-count">{n}</span>
                </button>
              ))}
          </div>
        </SidebarSection>
      )}
      {tagFilter ? (
        <div className="tree tag-filtered">
          <div className="tag-filter-banner">
            <span>
              <Tag size={13} /> #{tagFilter}
            </span>
            <button className="tag-filter-clear" onClick={() => setTagFilter(null)}>
              Filter aufheben ×
            </button>
          </div>
          {taggedPages.length === 0 && <div className="section-label">Keine Seiten.</div>}
          {taggedPages.map((p) => (
            <div
              key={p.id}
              className={'tree-item' + (p.id === currentId ? ' active' : '')}
              style={{ paddingLeft: 6 }}
              onClick={() => onNavigate(p.id)}
            >
              <span className="chevron spacer" />
              <span className="tree-icon">
                <PageIcon icon={p.icon} size={15} fallback={p.type === 'collection' ? <Table2 size={15} /> : <FileText size={15} />} />
              </span>
              <span className="tree-title">{p.title || 'Untitled'}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="tree">
          {/* In notes mode the middle column IS the document list — repeating
              the tree here would be pure duplication (user feedback W58). */}
          {!notesMode && (
            <SidebarSection
              id="docs"
              label="Dokumente"
              icon={<FileText size={17} />}
              count={allDocs.length}
              createTitle="Neue Seite"
              onCreate={() => onCreate(null)}
            >
              {topDocs.length ? (
                topDocs.map((p) => <TreeItem key={p.id} p={p} depth={0} ctx={ctx} />)
              ) : (
                <div className="sb-empty">Noch keine Seiten</div>
              )}
            </SidebarSection>
          )}
          <SidebarSection
            id="dbs"
            label="Datenbanken"
            icon={<Table2 size={17} />}
            count={allDbs.length}
            createTitle="Neue Datenbank"
            onCreate={() => onCreate(null, 'collection')}
          >
            {topDbs.length ? (
              topDbs.map((p) => <TreeItem key={p.id} p={p} depth={0} ctx={ctx} />)
            ) : (
              <div className="sb-empty">Noch keine Datenbank</div>
            )}
          </SidebarSection>
        </div>
      )}
      {templatePages.length > 0 && (
        <SidebarSection id="tpl" label="Vorlagen" icon={<LayoutTemplate size={17} />} count={templatePages.length} defaultOpen={false}>
          {templatePages.map((p) => (
              <div
                key={p.id}
                className={'tree-item sb-flat' + (p.id === currentId ? ' active' : '')}
                onClick={() => onNavigate(p.id)}
              >
                <span className="chevron spacer" />
                <span className="tree-icon">
                  <PageIcon icon={p.icon} size={15} fallback={<LayoutTemplate size={15} />} />
                </span>
                <span className="tree-title">{p.title || 'Untitled'}</span>
                <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
                  <button title="Neue Seite aus dieser Vorlage" onClick={() => void instantiateTemplate(p.id)}>
                    ＋
                  </button>
                </span>
              </div>
            ))
          }
        </SidebarSection>
      )}
      {trashRoots.length > 0 && (
        <div className="trash-section">
          <button className="trash-toggle" onClick={() => setTrashOpen(!trashOpen)}>
            <span className="sidebar-item-label"><Trash2 size={15} /> Trash</span> <span className="trash-count">{trashRoots.length}</span>
          </button>
          {trashOpen &&
            trashRoots.map((p) => (
              <div key={p.id} className="trash-item">
                <span className="tree-icon"><PageIcon icon={p.icon} size={15} fallback={<FileText size={15} />} /></span>
                <span className="tree-title">{p.title || 'Untitled'}</span>
                <button title="Restore" onClick={() => onRestore(p.id)}>
                  ↩
                </button>
                <button
                  title="Delete forever"
                  className="danger"
                  onClick={() => onDeleteForever(p.id)}
                >
                  ✕
                </button>
              </div>
            ))}
        </div>
      )}
      <div className="sidebar-footer">
        <div className="sidebar-footer-row">
          <UserMenu
            user={user}
            onUserChanged={onUserChanged}
            onLogout={onLogout}
            onOpenAgents={() => setAgentOpen(true)}
            notesMode={notesModeSetting}
            onToggleNotesMode={onToggleNotesMode}
          />
          <ThemeSwitch value={themePref} onChange={onSetTheme} />
        </div>
        {membersOpen && currentWs && (
          <WorkspaceMembers
            workspaceId={currentWs}
            myUserId={user.id}
            myRole={activeWs?.role ?? 'member'}
            onClose={() => setMembersOpen(false)}
            onChanged={onWorkspacesChanged}
          />
        )}
        {bgLogOpen && currentWs && (
          <BreakGlassLog
            workspaceId={currentWs}
            workspaceName={activeWs?.name ?? 'Workspace'}
            onClose={() => setBgLogOpen(false)}
          />
        )}
        {agentOpen && (
          <AgentConnectModal workspaces={workspaces} currentWs={currentWs} onClose={() => setAgentOpen(false)} />
        )}
        {wsImageOpen && activeWs && (
          <WorkspaceImageModal
            ws={activeWs}
            onClose={() => setWsImageOpen(false)}
            onChanged={onWorkspacesChanged}
          />
        )}
      </div>
    </aside>
  );
}

// WorkspaceAvatar: the workspace's uploaded logo, else its emoji, else its
// initial in a colour derived from the name — replaces the old 🧂 placeholder.
function WorkspaceAvatar({ ws }: { ws?: Workspace }) {
  if (ws?.image) return <img className="ws-img" src={ws.image} alt="" />;
  if (ws?.icon) return <span className="ws-emoji">{ws.icon}</span>;
  const name = ws?.name ?? 'Salt.md';
  return <span className={'ws-letter ' + tagColorClass(name)}>{name.charAt(0).toUpperCase()}</span>;
}

// WorkspaceImageModal: pick an emoji or upload a logo image for the workspace.
function WorkspaceImageModal({
  ws,
  onClose,
  onChanged,
}: {
  ws: Workspace;
  onClose: () => void;
  onChanged: () => void;
}) {
  useExclusiveModal(onClose);
  const [emoji, setEmoji] = useState(ws.icon);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveEmoji = async (val: string = emoji) => {
    if (!val.trim()) return; // never let an empty "save" wipe an existing logo
    setBusy(true);
    try {
      // Setting an emoji clears any image, and vice-versa (one identity at a time).
      await api.updateWorkspace(ws.id, { icon: val.trim(), image: '' });
      onChanged();
      onClose();
    } catch (e) {
      toast((e as Error).message || 'Speichern fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const url = await api.upload(file);
      await api.updateWorkspace(ws.id, { image: url, icon: '' });
      onChanged();
      onClose();
    } catch (err) {
      toast((err as Error).message || 'Upload fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await api.updateWorkspace(ws.id, { icon: '', image: '' });
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="dialog" role="dialog" aria-modal="true" aria-label="Workspace-Bild">
          <h2>Workspace-Bild</h2>
          <p className="dialog-hint">Wähle ein Emoji oder lade ein Logo (z.&nbsp;B. Firmen- oder Projekt-Logo) hoch.</p>
          <label className="dialog-hint">Emoji</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
            <button className="btn" onClick={() => setPickerOpen((o) => !o)}>
              {emoji || '🙂'} Auswählen…
            </button>
            <input
              className="prop-input"
              style={{ width: 90, textAlign: 'center', fontSize: 20 }}
              value={emoji}
              placeholder="oder tippen"
              maxLength={4}
              onChange={(e) => setEmoji(e.target.value)}
            />
            <button className="btn primary" disabled={busy || !emoji.trim()} onClick={() => void saveEmoji()}>Speichern</button>
            {pickerOpen && (
              <IconPicker
                onPick={(e) => {
                  setPickerOpen(false);
                  setEmoji(e);
                  void saveEmoji(e);
                }}
                onRemove={() => {
                  setPickerOpen(false);
                  setEmoji('');
                }}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
          <div className="menu-sep" style={{ margin: '12px 0' }} />
          <label className="dialog-hint">Logo hochladen</label>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => void uploadImage(e)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>Bild wählen…</button>
            {(ws.icon || ws.image) && (
              <button className="btn danger" disabled={busy} onClick={() => void clear()}>Entfernen</button>
            )}
          </div>
          <button className="btn dialog-close" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </Portal>
  );
}
