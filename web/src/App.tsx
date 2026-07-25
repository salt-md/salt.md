import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type { Me, PageMeta, User, Workspace } from './types';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import TabBar from './components/TabBar';
import SearchModal from './components/SearchModal';
import IndexView from './components/IndexView';
import NotesList from './components/NotesList';
import Login from './components/Login';
import Setup from './components/Setup';
import InviteAccept from './components/InviteAccept';
import PublicForm from './components/PublicForm';
import { UploadBar, ImageLightbox } from './components/Overlays';
import Toaster from './components/Toaster';
import { DialogHost, confirm, promptText } from './dialog';
import { announceModal } from './modal';
import { toast } from './toast';
import Logo from './Logo';
import ThemeSwitch, { type ThemePref } from './ThemeSwitch';

// Feedback aus dem Mail-OAuth-Consent-Redirect (/?mailOauth=ok|<fehler>).
const mailOauthMsg = (() => {
  const qs = new URLSearchParams(window.location.search);
  const v = qs.get('mailOauth');
  if (v) {
    qs.delete('mailOauth');
    const rest = qs.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? '?' + rest : ''));
  }
  return v;
})();
if (mailOauthMsg) {
  setTimeout(() => toast(mailOauthMsg === 'ok' ? 'Mail-Versand verbunden ✓' : 'Mail-Verbindung: ' + mailOauthMsg), 400);
}

// Kept in sync with server.Version. A stale open tab after a deploy sees a
// different server version (via /api/me and the SSE hello) and is told to reload.
const BUILD_VERSION = '1.2.0';

function pageIdFromLocation(): string | null {
  const m = window.location.pathname.match(/^\/p\/([0-9a-f]+)$/);
  return m ? m[1] : null;
}

type Theme = 'light' | 'dark';

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [pages, setPages] = useState<PageMeta[] | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  // Der zuletzt geöffnete Workspace wird gemerkt. Ohne das landete man nach
  // jedem Neuladen wieder im ersten Workspace — wer überwiegend in einem
  // zweiten arbeitet, musste ihn bei jedem Seitenaufruf neu wählen.
  const [currentWs, setCurrentWs] = useState<string>(() => localStorage.getItem('salt-ws') ?? '');
  const [loadError, setLoadError] = useState(false);
  // Bear-style notes mode (middle notes column) — an explicit per-user setting
  // in the UserMenu, DEFAULT OFF so the first impression stays the classic
  // tree layout (user feedback: three parallel content areas felt chaotic).
  const [notesMode, setNotesMode] = useState(() => localStorage.getItem('salt-notes-mode') === '1');
  // Tag selected in the sidebar while in notes mode — filters the notes list.
  const [notesTag, setNotesTag] = useState<string | null>(null);
  // The notes list only exists ≥900px; below that the sidebar must keep its
  // document tree or mobile loses all navigation.
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const notesActive = notesMode && isDesktop;
  const toggleNotesMode = useCallback(() => {
    setNotesMode((cur) => {
      const next = !cur;
      localStorage.setItem('salt-notes-mode', next ? '1' : '0');
      if (!next) setNotesTag(null);
      return next;
    });
  }, []);
  // Ref mirror so the []-deps ⌥N handler always calls the current createPage.
  const createPageRef = useRef<((parentId: string | null) => Promise<void>) | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(pageIdFromLocation());
  // Open document tabs (Obsidian-style): an ordered list of page ids; the active
  // one is `currentId`. Seeded from the last session and the URL.
  const [openTabs, setOpenTabs] = useState<string[]>(() => {
    let seed: string[] = [];
    try {
      const s = JSON.parse(localStorage.getItem('salt-tabs') ?? '[]');
      if (Array.isArray(s)) seed = s.filter((x): x is string => typeof x === 'string');
    } catch {
      /* localStorage unavailable — tabs fall back to a single view */
    }
    const fromUrl = pageIdFromLocation();
    if (fromUrl && !seed.includes(fromUrl)) seed = [...seed, fromUrl];
    return seed;
  });
  // Refs mirror the latest values so the stable useCallback handlers below can
  // read them without being re-created on every navigation.
  const activeRef = useRef<string | null>(currentId);
  const tabsRef = useRef<string[]>(openTabs);
  useEffect(() => {
    activeRef.current = currentId;
  }, [currentId]);
  useEffect(() => {
    tabsRef.current = openTabs;
    try {
      localStorage.setItem('salt-tabs', JSON.stringify(openTabs));
    } catch {
      /* best-effort persistence */
    }
  }, [openTabs]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop-only: collapse the sidebar entirely (mobile uses the drawer). The
  // editor's hamburger reopens it. Persisted so it stays collapsed across loads.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('salt-sidebar-collapsed') === '1',
  );
  useEffect(() => {
    try {
      localStorage.setItem('salt-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
    } catch {
      /* best-effort */
    }
  }, [sidebarCollapsed]);
  // After clicking "einklappen" the pointer is still over the sidebar, so the
  // hover-reveal would instantly show it again ("the click did nothing"). Lock
  // the reveal until the pointer has actually left the sidebar area once.
  const [hoverLock, setHoverLock] = useState(false);
  useEffect(() => {
    if (!hoverLock) return;
    const onMove = (e: MouseEvent) => {
      if (e.clientX > 300) setHoverLock(false);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [hoverLock]);
  // The hamburger both opens the mobile drawer and un-collapses on desktop.
  const openSidebar = () => {
    setSidebarOpen(true);
    setSidebarCollapsed(false);
  };
  // Gespeichert wird die WAHL ('auto' eingeschlossen), angewendet das daraus
  // abgeleitete Design. Wer vor dieser Änderung schon 'light'/'dark' gespeichert
  // hatte, behält es — das war eine bewusste Einstellung, die ich nicht
  // stillschweigend überschreibe. Neu ist 'auto' die Voreinstellung.
  const [themePref, setThemePref] = useState<ThemePref>(() => {
    const saved = localStorage.getItem('salt-theme');
    return saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto';
  });
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  // Bei 'auto' muss ein Wechsel der Systemeinstellung SOFORT durchschlagen —
  // sonst wäre „automatisch" nur eine Momentaufnahme beim Laden.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme: Theme = themePref === 'auto' ? (systemDark ? 'dark' : 'light') : themePref;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('salt-theme', themePref);
  }, [theme, themePref]);

  const loadFavorites = useCallback(async () => {
    try {
      setFavorites(await api.listFavorites());
    } catch {
      /* keep current favorites on transient failure */
    }
  }, []);

  // Pages reload on SSE events; favorites are per-user and reloaded only on
  // login/mount, so a page-change broadcast can't clobber an in-flight
  // optimistic favorite toggle.
  const loadPages = useCallback(async () => {
    try {
      setPages(await api.listPages());
      setLoadError(false);
    } catch (e) {
      if ((e as Error).message !== 'unauthorized') setLoadError(true);
    }
  }, []);

  const loadWorkspaces = useCallback(async () => {
    try {
      const ws = await api.listWorkspaces();
      setWorkspaces(ws);
      // Der gemerkte Workspace gilt nur, wenn es ihn noch gibt und man noch
      // Mitglied ist — sonst zurück auf den ersten erreichbaren.
      setCurrentWs((cur) => (cur && ws.some((w) => w.id === cur) ? cur : ws[0]?.id ?? ''));
    } catch {
      /* keep current */
    }
  }, []);

  // Tag colour overrides for the current workspace (lower-case tag → colour).
  const [tagColors, setTagColors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!currentWs) return;
    try {
      localStorage.setItem('salt-ws', currentWs);
    } catch {
      /* private mode */
    }
    let alive = true;
    void api.tagColors(currentWs).then((c) => alive && setTagColors(c)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [currentWs]);
  const setTagColor = useCallback(
    async (tag: string, color: string) => {
      const key = tag.toLowerCase();
      setTagColors((prev) => {
        const next = { ...prev };
        if (!color || color === 'default') delete next[key];
        else next[key] = color;
        return next;
      });
      try {
        await api.setTagColor(currentWs, tag, color);
      } catch {
        void api.tagColors(currentWs).then(setTagColors).catch(() => {});
      }
    },
    [currentWs],
  );

  const loadAll = useCallback(async () => {
    await Promise.all([loadPages(), loadFavorites(), loadWorkspaces()]);
  }, [loadPages, loadFavorites, loadWorkspaces]);

  const toggleFavorite = useCallback(
    async (id: string) => {
      const willAdd = !favorites.includes(id);
      setFavorites((prev) =>
        willAdd ? [...prev, id] : prev.filter((f) => f !== id),
      );
      try {
        if (willAdd) await api.addFavorite(id);
        else await api.removeFavorite(id);
      } catch {
        void loadFavorites(); // reconcile on failure
      }
    },
    [favorites, loadFavorites],
  );

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setMe(m);
        if (m.version && m.version !== BUILD_VERSION) {
          toast('Neue Version verfügbar — Seite neu laden');
        }
        if (m.authenticated) void loadAll();
      })
      .catch(() => setLoadError(true));
  }, [loadAll]);

  useEffect(() => {
    const onUnauthorized = () =>
      setMe((prev) => ({
        setupRequired: prev?.setupRequired ?? false,
        authenticated: false,
        user: null,
        version: prev?.version ?? BUILD_VERSION,
      }));
    // Back/forward: restore the exact tab set from the history entry's state
    // (set by pushTabHistory). Falls back to the URL id for entries with no
    // snapshot (e.g. the very first load), reopening a tab only then.
    const onPop = (e: PopStateEvent) => {
      const st = e.state as { tabs?: string[]; active?: string | null } | null;
      if (st && Array.isArray(st.tabs)) {
        setOpenTabs(st.tabs);
        setCurrentId(st.active ?? null);
        return;
      }
      const id = pageIdFromLocation();
      setCurrentId(id);
      if (id) setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    };
    // Clicking an inline @-mention (rendered by BlockNote) dispatches this.
    // Inlined (not via `navigate`) so the listener needs no deps and can't
    // hit a temporal-dead-zone on the later useCallback; navigates the active
    // tab in place, matching a normal link click.
    const onLinkNav = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id) return;
      history.pushState(null, '', `/p/${id}`);
      setCurrentId(id);
      setSidebarOpen(false);
      setOpenTabs((prev) => {
        if (prev.includes(id)) return prev;
        const active = activeRef.current;
        if (active && prev.includes(active)) return prev.map((t) => (t === active ? id : t));
        return [...prev, id];
      });
    };
    window.addEventListener('salt:unauthorized', onUnauthorized);
    window.addEventListener('popstate', onPop);
    window.addEventListener('salt:navigate', onLinkNav);
    return () => {
      window.removeEventListener('salt:unauthorized', onUnauthorized);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('salt:navigate', onLinkNav);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ⌥N = new note (⌘N is reserved by browsers and can't be intercepted).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyN') {
        e.preventDefault();
        void createPageRef.current?.(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Live updates: whenever anyone (or an agent via the API) changes the page
  // tree, the server broadcasts an SSE event and we refetch.
  const reloadTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!me?.authenticated) return;
    const es = new EventSource('/api/events');
    let warnedVersion = false;
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type: string; version?: string };
        if (msg.type === 'hello' && msg.version && msg.version !== BUILD_VERSION && !warnedVersion) {
          warnedVersion = true;
          toast('Neue Version verfügbar — Seite neu laden');
        }
        if (msg.type === 'pages') {
          window.clearTimeout(reloadTimer.current);
          reloadTimer.current = window.setTimeout(() => void loadPages(), 250);
        }
      } catch {
        /* ignore malformed events */
      }
    };
    return () => {
      window.clearTimeout(reloadTimer.current);
      es.close();
    };
  }, [me?.authenticated, loadPages]);

  // Any modal opening collapses the sidebar drawer (mobile) — a popup and the
  // menu should never be visible at once.
  useEffect(() => {
    const onModal = () => setSidebarOpen(false);
    window.addEventListener('salt:modal', onModal);
    return () => window.removeEventListener('salt:modal', onModal);
  }, []);

  const rememberRecent = (id: string) => {
    try {
      const cur: string[] = JSON.parse(localStorage.getItem('salt-recents') ?? '[]');
      const next = [id, ...cur.filter((x) => x !== id)].slice(0, 8);
      localStorage.setItem('salt-recents', JSON.stringify(next));
    } catch {
      /* localStorage unavailable — recents are a nice-to-have */
    }
  };

  // Each history entry carries a snapshot of the tab set + active id in its
  // state, so back/forward restore the EXACT prior tabs instead of the URL id
  // being re-appended as a phantom tab (which happens with in-place navigation).
  const pushTabHistory = (tabs: string[], id: string | null, replace: boolean) => {
    const url = id ? `/p/${id}` : '/';
    const state = { tabs, active: id };
    if (replace) history.replaceState(state, '', url);
    else history.pushState(state, '', url);
  };

  // navigate activates `id`. Like a browser tab, it reuses an already-open tab
  // if `id` is open, otherwise it navigates the *active* tab in place (or opens
  // the first tab if none is active). Use openInNewTab to add a background tab.
  const navigate = useCallback((id: string | null, replace = false) => {
    setIndexOpen(false); // any navigation leaves the full-screen index overlay
    let nextTabs = tabsRef.current;
    if (id && !tabsRef.current.includes(id)) {
      const active = activeRef.current;
      nextTabs =
        active && tabsRef.current.includes(active)
          ? tabsRef.current.map((t) => (t === active ? id : t)) // navigate active tab
          : [...tabsRef.current, id];
    }
    pushTabHistory(nextTabs, id, replace);
    setOpenTabs(nextTabs);
    setCurrentId(id);
    setSidebarOpen(false); // close the mobile drawer after picking a page
    if (id && !replace) rememberRecent(id);
  }, []);

  // openInNewTab adds `id` as a new tab right after the active one and focuses it.
  const openInNewTab = useCallback((id: string) => {
    setIndexOpen(false);
    const prev = tabsRef.current;
    let nextTabs = prev;
    if (!prev.includes(id)) {
      const i = activeRef.current ? prev.indexOf(activeRef.current) : -1;
      nextTabs = i < 0 ? [...prev, id] : [...prev.slice(0, i + 1), id, ...prev.slice(i + 1)];
    }
    pushTabHistory(nextTabs, id, false);
    setOpenTabs(nextTabs);
    setCurrentId(id);
    setSidebarOpen(false);
    rememberRecent(id);
  }, []);

  // closeTab removes a tab; if it was active, the neighbour that slides into its
  // slot (else the previous one, else nothing) becomes active.
  const closeTab = useCallback((id: string) => {
    const prev = tabsRef.current;
    const i = prev.indexOf(id);
    if (i < 0) return;
    const next = prev.filter((x) => x !== id);
    setOpenTabs(next);
    if (activeRef.current === id) {
      const neighbour = next[i] ?? next[i - 1] ?? null;
      pushTabHistory(next, neighbour, true);
      setCurrentId(neighbour);
    }
  }, []);

  // Ctrl+Alt+←/→ cycles open tabs. metaKey is intentionally excluded: Cmd+Alt+←/→
  // is the macOS browser tab-switch shortcut. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const el = document.activeElement as HTMLElement | null;
        if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
        const tabs = tabsRef.current;
        if (tabs.length < 2) return;
        e.preventDefault();
        const i = activeRef.current ? tabs.indexOf(activeRef.current) : -1;
        const d = e.key === 'ArrowRight' ? 1 : -1;
        navigate(tabs[(i + d + tabs.length) % tabs.length]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  // Pick a landing page when nothing is selected, and bounce away from a page
  // that was trashed. IMPORTANT: a selected id that is simply absent from the
  // tree list is still valid — database rows are children of a collection and
  // are deliberately excluded from /api/pages, so clicking one must NOT be
  // treated as an invalid selection (that caused a jump back to the home page).
  // Genuinely-gone pages are handled by the editor's onMissing callback.
  // Keep a tab only if its page is live in the tree, or it is the active page.
  // This drops trashed pages and stale ids left in localStorage (e.g. pages
  // deleted in another session), so no "Untitled" ghost tabs accumulate. The
  // trade-off: a database row (absent from /api/pages) survives only while it
  // is the active tab — an accepted minor limitation, not data loss.
  useEffect(() => {
    if (!pages) return;
    const alive = new Set(pages.filter((p) => !p.trashed).map((p) => p.id));
    setOpenTabs((prev) => {
      const next = prev.filter((id) => alive.has(id) || id === currentId);
      return next.length === prev.length && next.every((v, i) => v === prev[i]) ? prev : next;
    });
  }, [pages, currentId]);

  useEffect(() => {
    if (!pages) return;
    // Don't hijack the /invite/<token> route: an authenticated invitee must stay
    // on the invite screen long enough to accept, not get replaced with a page.
    if (/^\/invite\/[a-f0-9]+$/.test(window.location.pathname)) return;
    if (currentId) {
      const cur = pages.find((p) => p.id === currentId);
      if (!cur || !cur.trashed) return; // in-tree-and-live, OR a row not in the tree → keep
      // else: the current page is trashed → fall through and pick another
    }
    // Prefer a still-open tab over jumping into the tree, so closing/​trashing the
    // active page lands on a neighbouring tab rather than the first page.
    const openAlive = tabsRef.current.find((id) => {
      const p = pages.find((pp) => pp.id === id);
      return p && !p.trashed && id !== currentId;
    });
    if (openAlive) {
      navigate(openAlive, true);
      return;
    }
    const first =
      pages.find((p) => !p.trashed && !p.parentId) ?? pages.find((p) => !p.trashed);
    navigate(first ? first.id : null, true);
  }, [pages, currentId, navigate]);

  const createPage = useCallback(
    async (parentId: string | null, type: 'doc' | 'collection' = 'doc') => {
      // Root pages land in the selected workspace; children inherit the parent's.
      const p = await api.createPage(parentId, '', type, undefined, parentId ? undefined : currentWs);
      setPages((prev) => (prev ? [...prev, p] : [p]));
      navigate(p.id);
    },
    [navigate, currentWs],
  );
  createPageRef.current = createPage;

  const updateMeta = useCallback((id: string, patch: Partial<PageMeta>) => {
    setPages((prev) => prev?.map((p) => (p.id === id ? { ...p, ...patch } : p)) ?? prev);
  }, []);

  // Import for the empty-state (no pages yet). The primary import entry point is
  // the page ⋯-menu; this keeps a Notion-style zip/markdown import reachable
  // before any page exists.
  const emptyImportRef = useRef<HTMLInputElement>(null);
  const onEmptyImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        if (file.name.toLowerCase().endsWith('.zip')) {
          const r = await api.importZip(file);
          toast(`Import: ${r.created} Seiten${r.skipped ? `, ${r.skipped} übersprungen` : ''}`);
          void loadPages();
        } else {
          const text = await file.text();
          const r = await api.importMarkdown(null, '', text);
          toast('Seite importiert');
          void loadPages();
          navigate(r.id);
        }
      } catch (err) {
        toast((err as Error).message || 'Import fehlgeschlagen');
      }
    },
    [loadPages, navigate],
  );

  const trashPage = useCallback(
    async (id: string) => {
      await api.trashPage(id);
      await loadPages();
    },
    [loadPages],
  );

  const duplicatePage = useCallback(
    async (id: string) => {
      try {
        const r = await api.duplicatePage(id);
        await loadPages();
        navigate(r.id);
      } catch {
        toast('Duplizieren fehlgeschlagen');
      }
    },
    [loadPages, navigate],
  );

  const restorePage = useCallback(
    async (id: string) => {
      await api.restorePage(id);
      await loadPages();
    },
    [loadPages],
  );

  const deleteForever = useCallback(
    async (id: string) => {
      if (!(await confirm('Delete this page and all its sub-pages forever?', { danger: true, confirmText: 'Löschen' }))) return;
      await api.deleteForever(id);
      await loadPages();
    },
    [loadPages],
  );

  const movePage = useCallback(
    async (id: string, parentId: string | null, position: number) => {
      await api.updatePage(id, { parentId, position });
      const fresh = await api.listPages();
      setPages(fresh);
      // Self-heal float precision: if two siblings ended up closer than this,
      // renumber them to clean integers so midpoints can't exhaust f64.
      const siblings = fresh
        .filter((p) => !p.trashed && (p.parentId ?? null) === parentId)
        .map((p) => p.position)
        .sort((a, b) => a - b);
      const tooDense = siblings.some((v, i) => i > 0 && v - siblings[i - 1] < 1e-6);
      if (tooDense) {
        // Auf oberster Ebene braucht der Server den Workspace: sonst müsste er
        // raten, welche Wurzelseiten gemeint sind — und traf früher alle der
        // ganzen Instanz.
        await api.reindexSiblings(parentId, parentId ? undefined : currentWs).catch(() => {});
        setPages(await api.listPages());
      }
    },
    [currentWs],
  );

  const handleMissing = useCallback(
    (id: string) => {
      setPages((prev) => prev?.filter((p) => p.id !== id) ?? prev);
      closeTab(id); // a genuinely-gone page closes its tab (rows stay — they 200)
      void loadPages();
    },
    [loadPages, closeTab],
  );

  const pagesById = useMemo(
    () => new Map((pages ?? []).map((p) => [p.id, p])),
    [pages],
  );

  // A viewer (read-only workspace role) may not edit; the doc editor renders
  // read-only so a viewer isn't teased with an editable-looking page whose
  // writes the server would only reject.
  const canEditCurrent = useMemo(() => {
    if (!currentId) return true;
    const page = pagesById.get(currentId);
    if (!page) return true;
    const role = workspaces.find((w) => w.id === page.workspaceId)?.role;
    return role !== 'viewer';
  }, [currentId, pagesById, workspaces]);

  const onAuthed = useCallback(
    (user: User) => {
      setMe({ setupRequired: false, authenticated: true, user, version: BUILD_VERSION });
      setSearchOpen(false);
      void loadAll();
    },
    [loadAll],
  );

  if (loadError && !pages) {
    return (
      <div className="empty-state">
        <div className="empty-emoji">🍂</div>
        <h2>Cannot reach the server</h2>
        <p>Salt.md could not load your workspace.</p>
        <button className="btn primary" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  // Public form: /form/<token>. Fully public — renders before any auth/me gate
  // so anyone with the link can submit without an account (or even while `me`
  // is still loading).
  const formMatch = window.location.pathname.match(/^\/form\/([a-f0-9]+)$/);
  if (formMatch) return <PublicForm token={formMatch[1]} />;

  // Invite-accept flow: /invite/<token>. A signed-out visitor sets up (or signs
  // into) an account and joins; a signed-in visitor joins as their current
  // account with one click. Handling both stops an already-logged-in invitee
  // from being silently bounced to the landing page without ever joining.
  const inviteMatch = window.location.pathname.match(/^\/invite\/([a-f0-9]+)$/);
  if (inviteMatch && me) {
    if (!me.authenticated) {
      return <InviteAccept token={inviteMatch[1]} onSuccess={onAuthed} />;
    }
    if (me.user) {
      return (
        <InviteAccept token={inviteMatch[1]} currentUser={me.user} onSuccess={onAuthed} />
      );
    }
  }
  // Auf den Anmeldemasken gibt es noch keine Seitenleiste — der Schalter
  // schwebt deshalb frei in der Ecke. Wer nachts auf die Loginseite kommt,
  // soll sie nicht weiß angeleuchtet bekommen, ohne etwas tun zu können.
  const authThemeSwitch = (
    <div className="auth-theme-switch">
      <ThemeSwitch value={themePref} onChange={setThemePref} />
    </div>
  );
  if (me?.setupRequired)
    return (
      <>
        {authThemeSwitch}
        <Setup onSuccess={onAuthed} />
      </>
    );
  if (me && !me.authenticated)
    return (
      <>
        {authThemeSwitch}
        <Login onSuccess={onAuthed} />
      </>
    );
  if (!pages || !me?.user) return <div className="app-loading"><Logo size={40} /></div>;

  const toaster = <Toaster />;

  return (
    <div className={'app' + (sidebarCollapsed ? ' sidebar-collapsed' : '') + (hoverLock ? ' hover-lock' : '')}>
      {/* Collapsed-sidebar hover zone (desktop): hovering the left edge slides
          the sidebar in as an overlay without permanently un-collapsing it. */}
      {sidebarCollapsed && <div className="sidebar-hotzone" />}
      {sidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
      )}
      <Sidebar
        onUserChanged={(u) => setMe((prev) => (prev ? { ...prev, user: u } : prev))}
        canCreateWorkspace={!!me?.user?.isAdmin || me?.allowUserWorkspaces !== false}
        pages={pages}
        favorites={favorites}
        workspaces={workspaces}
        currentWs={currentWs}
        tagColors={tagColors}
        onSwitchWorkspace={setCurrentWs}
        onWorkspacesChanged={loadWorkspaces}
        user={me.user}
        currentId={currentId}
        open={sidebarOpen}
        onCollapse={() => {
          // Ein Button für beide Welten: mobil ist die Seitenleiste ein Drawer,
          // "einklappen" heißt dort schlicht zu. Auf dem Desktop wird sie zur
          // Hover-Overlay — der collapsed-Zustand gilt nur dort, sonst bliebe
          // er nach einem Handy-Tipp als unsichtbarer Nebeneffekt hängen.
          setSidebarOpen(false);
          if (window.matchMedia('(min-width: 769px)').matches) {
            setSidebarCollapsed(true);
            setHoverLock(true);
          }
        }}
        collapsed={sidebarCollapsed}
        onExpand={() => {
          setSidebarCollapsed(false);
          setHoverLock(false);
        }}
        onNavigate={navigate}
        onOpenInNewTab={openInNewTab}
        onCreate={createPage}
        onTrash={trashPage}
        onDuplicate={duplicatePage}
        onRestore={restorePage}
        onDeleteForever={deleteForever}
        onMove={movePage}
        onToggleFavorite={toggleFavorite}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenIndex={() => {
          announceModal(); // close any open modal + collapse the sidebar
          setIndexOpen(true);
        }}
        theme={theme}
        themePref={themePref}
        onSetTheme={setThemePref}
        onLogout={async () => {
          await api.logout();
          window.location.href = '/';
        }}
        notesMode={notesActive}
        activeTag={notesTag}
        onSelectTag={setNotesTag}
        notesModeSetting={notesMode}
        onToggleNotesMode={toggleNotesMode}
      />
      {notesActive && (
        <NotesList
          pages={pagesById}
          currentWs={currentWs}
          activeId={currentId}
          tagColors={tagColors}
          tagFilter={notesTag}
          onClearTag={() => setNotesTag(null)}
          onNavigate={navigate}
          onCreate={() => void createPage(null)}
        />
      )}
      <main className="main">
        {indexOpen ? (
          <IndexView
            pages={pages}
            onNavigate={(id) => {
              setIndexOpen(false);
              navigate(id);
            }}
            onClose={() => setIndexOpen(false)}
          />
        ) : currentId ? (
          <>
            <TabBar
              tabs={openTabs}
              activeId={currentId}
              pagesById={pagesById}
              onSelect={navigate}
              onClose={closeTab}
            />
            <Editor
              key={currentId}
              pageId={currentId}
              pagesById={pagesById}
              user={me.user}
              theme={theme}
              canEdit={canEditCurrent}
              favorite={favorites.includes(currentId)}
              tagColors={tagColors}
              onSetTagColor={setTagColor}
              onMenu={openSidebar}
              onToggleFavorite={toggleFavorite}
              onMetaChange={updateMeta}
              onMissing={handleMissing}
              onNavigate={navigate}
              onCreatePage={createPage}
              onPagesChanged={loadPages}
            />
          </>
        ) : workspaces.length === 0 ? (
          // Ohne jeden Workspace gab es bisher nur eine leere Fläche: die App
          // zeigte "keine Seiten" und jeder Knopf lief ins Leere, weil Seiten
          // einen Workspace brauchen. Seit W102 bekommt jedes Konto einen
          // eigenen Bereich — bleibt trotzdem einer übrig (Zuweisung entzogen,
          // Anlegen fehlgeschlagen), sagen wir wenigstens, was los ist.
          <div className="empty-state">
            <button className="menu-btn empty-menu-btn" onClick={openSidebar}>
              ☰
            </button>
            <div className="empty-emoji"><Logo size={52} /></div>
            <h2>Kein Workspace</h2>
            <p>
              Dein Konto gehört derzeit zu keinem Workspace. Bitte einen Admin um Zugang — oder
              leg dir einen eigenen an, falls die Instanz das erlaubt.
            </p>
            {me?.allowUserWorkspaces && (
              <div className="empty-actions">
                <button
                  className="btn primary"
                  onClick={() => {
                    void (async () => {
                      const name = await promptText('Name des neuen Workspace?', { placeholder: 'z.B. Persönlich' });
                      if (!name?.trim()) return;
                      try {
                        const ws = await api.createWorkspace(name.trim());
                        await loadWorkspaces();
                        setCurrentWs(ws.id);
                      } catch (e) {
                        toast((e as Error).message || 'Konnte nicht angelegt werden');
                      }
                    })();
                  }}
                >
                  Workspace anlegen
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="empty-state">
            <button className="menu-btn empty-menu-btn" onClick={openSidebar}>
              ☰
            </button>
            <div className="empty-emoji"><Logo size={52} /></div>
            <h2>No pages yet</h2>
            <p>Create your first page — or import from Notion (.zip) / Markdown (.md).</p>
            <div className="empty-actions">
              <button className="btn primary" onClick={() => void createPage(null)}>
                New page
              </button>
              <button className="btn" onClick={() => emptyImportRef.current?.click()}>
                Import (.md / .zip)
              </button>
            </div>
            <input
              ref={emptyImportRef}
              type="file"
              accept=".md,.markdown,.zip"
              style={{ display: 'none' }}
              onChange={(e) => void onEmptyImport(e)}
            />
          </div>
        )}
      </main>
      {searchOpen && (
        <SearchModal
          recent={(() => {
            try {
              const ids: string[] = JSON.parse(localStorage.getItem('salt-recents') ?? '[]');
              return ids
                .map((id) => pagesById.get(id))
                .filter((p): p is PageMeta => !!p && !p.trashed)
                .map((p) => ({ id: p.id, title: p.title, icon: p.icon }));
            } catch {
              return [];
            }
          })()}
          onClose={() => setSearchOpen(false)}
          onNavigate={(id) => {
            setSearchOpen(false);
            navigate(id);
          }}
        />
      )}
      {toaster}
      <DialogHost />
      <UploadBar />
      <ImageLightbox />
    </div>
  );
}
