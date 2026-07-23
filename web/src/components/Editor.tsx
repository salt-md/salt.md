import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from '@blocknote/react';
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core';
import { en as coreEn } from '@blocknote/core/locales';
import {
  getMultiColumnSlashMenuItems,
  multiColumnDropCursor,
  locales as multiColumnLocales,
} from '@blocknote/xl-multi-column';
import { BlockNoteView } from '@blocknote/mantine';
import { api } from '../api';
import { toast } from '../toast';
import type { Backlink, CollectionConfig, Page, PageMeta, PropOption, User } from '../types';
import { SaltProvider } from '../collab';
import PropertyValue from './PropertyValue';
import { saltSchema } from '../pageLink';
import IconPicker from './IconPicker';
import { PageIcon } from '../pageIcon';
import { BlockContext } from '../blockContext';
import CollectionView from './CollectionView';
import { HistoryModal } from './PageHistory';
import CommentsSection, { initials } from './CommentsSection';
import { usePeers, setPeers, clearPeers } from '../presence';
import { tagColorClass, TAG_PALETTE } from '../tags';
import { collectTags, suggestTags } from '../tagSuggest';
import { useMenuDismiss } from '../modal';
import { Menu, Star, Lock, LockOpen, Globe, MessageSquare, History, MoreHorizontal, Printer, FileCode, FileText, Upload, AlignLeft, Check, Image as ImageIcon , Smile } from 'lucide-react';

export interface EditorProps {
  pageId: string;
  pagesById: Map<string, PageMeta>;
  user: User;
  theme: 'light' | 'dark';
  canEdit: boolean;
  favorite: boolean;
  tagColors: Record<string, string>;
  onSetTagColor: (tag: string, color: string) => void;
  onMenu: () => void;
  onToggleFavorite: (id: string) => void;
  onMetaChange: (id: string, patch: Partial<PageMeta>) => void;
  onMissing: (id: string) => void;
  onNavigate: (id: string | null) => void;
  onCreatePage: (parentId: string | null, type?: 'doc' | 'collection') => void;
  onPagesChanged: () => void;
}

export default function Editor(props: EditorProps) {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setPage(null);
    setError(null);
    api
      .getPage(props.pageId)
      .then((p) => {
        if (alive) setPage(p);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [props.pageId, nonce]);

  if (error) {
    return (
      <div className="editor-error">
        <p>This page could not be loaded.</p>
        <button className="btn" onClick={() => props.onMissing(props.pageId)}>
          Back to workspace
        </button>
      </div>
    );
  }
  if (!page) return <div className="editor-loading" />;

  // The content renders INSIDE PageHeader's .page-body scroller so cover,
  // title and content scroll away together (only the topbar stays fixed).
  return (
    <div className="editor-page">
      <PageHeader
        page={page}
        {...props}
        onLocalMeta={(patch) => setPage((p) => (p ? { ...p, ...patch } : p))}
      >
        {page.type === 'collection' ? (
          <CollectionView
            key={page.id}
            collectionId={page.id}
            pages={props.pagesById}
            tagColors={props.tagColors}
            onNavigate={props.onNavigate}
            onPagesChanged={props.onPagesChanged}
          />
        ) : (
          <CollabEditor
            key={page.id}
            page={page}
            user={props.user}
            theme={props.theme}
            canEdit={props.canEdit}
            pagesById={props.pagesById}
            tagColors={props.tagColors}
            onNavigate={props.onNavigate}
            onCreatePage={props.onCreatePage}
            onPagesChanged={props.onPagesChanged}
            onReset={() => setNonce((n) => n + 1)}
          />
        )}
      </PageHeader>
    </div>
  );
}

// ---- shared header (breadcrumbs, title, icon) ----

const COVER_GRADIENTS = [
  // Light → dark (left → right): the page icon docks at the LEFT edge, so the
  // pale end sits behind it and keeps emoji/dark icons readable.
  'gradient:linear-gradient(120deg,#4fa872,#2f7d4f)',
  'gradient:linear-gradient(120deg,#6aa9e0,#3b6fb5)',
  'gradient:linear-gradient(120deg,#e0c56a,#b58a3b)',
  'gradient:linear-gradient(120deg,#b07de0,#7d4fb0)',
  'gradient:linear-gradient(120deg,#e0846a,#c4554d)',
  'gradient:linear-gradient(120deg,#6ad0d0,#3ba0a8)',
  // W96: mehr Auswahl — weiche Zwei- und Dreiklaenge (Aurora/Sonnenuntergang/
  // Meer), weiterhin hell nach dunkel, damit das Seiten-Emoji links lesbar
  // andockt. Serverseitig laesst validCover jeden reinen Gradient durch.
  'gradient:linear-gradient(120deg,#ffd3a5,#fd6585)',
  'gradient:linear-gradient(120deg,#a8edea,#5b86e5)',
  'gradient:linear-gradient(120deg,#f6d365,#fda085)',
  'gradient:linear-gradient(120deg,#d4fc79,#4a934a)',
  'gradient:linear-gradient(120deg,#e0c3fc,#8e63c9)',
  'gradient:linear-gradient(120deg,#f5efe6,#b8a389)',
  'gradient:linear-gradient(120deg,#fbc2eb,#a18cd1)',
  'gradient:linear-gradient(120deg,#fddb92,#d1858c)',
  'gradient:linear-gradient(120deg,#9be2d5,#2c7a7b)',
  'gradient:linear-gradient(120deg,#c9d6ff,#5c6bc0)',
  'gradient:linear-gradient(135deg,#ffecd2,#fcb69f 55%,#e0846a)',
  'gradient:linear-gradient(135deg,#a1c4fd,#c2e9fb 45%,#6aa9e0)',
];

function coverStyle(cover: string): React.CSSProperties {
  if (cover.startsWith('gradient:')) return { background: cover.slice('gradient:'.length) };
  return { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' };
}

const TAG_COLOR_LABELS: Record<string, string> = {
  gray: 'Grau',
  brown: 'Braun',
  orange: 'Orange',
  yellow: 'Gelb',
  green: 'Grün',
  blue: 'Blau',
  purple: 'Lila',
  pink: 'Rosa',
  red: 'Rot',
};

// A tag chip with a Notion-style colour picker: click the label to choose a
// colour (or "Standard" = automatic), the × removes the tag.
function TagChip({
  tag,
  colors,
  canEdit,
  onRemove,
  onSetColor,
}: {
  tag: string;
  colors: Record<string, string>;
  canEdit: boolean;
  onRemove: () => void;
  onSetColor: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  useMenuDismiss(open, wrapRef, () => setOpen(false));
  const current = colors[tag.toLowerCase()] || '';
  return (
    <span className={'page-tag ' + tagColorClass(tag, colors)} ref={wrapRef}>
      <button
        className="page-tag-label"
        onClick={() => canEdit && setOpen((o) => !o)}
        title={canEdit ? 'Farbe ändern' : undefined}
      >
        #{tag}
      </button>
      {canEdit && (
        <button
          className="page-tag-x"
          title="Tag entfernen"
          aria-label={`Tag ${tag} entfernen`}
          onClick={onRemove}
        >
          ×
        </button>
      )}
      {open && (
        <div className="menu tag-color-menu">
          <div className="menu-label">Farbe</div>
          <button
            className="tag-color-opt"
            onClick={() => {
              onSetColor('');
              setOpen(false);
            }}
          >
            <span className="tag-swatch tag-gray" />
            <span className="tag-color-name">Standard</span>
            {!current && <Check size={14} />}
          </button>
          {TAG_PALETTE.map((c) => (
            <button
              key={c}
              className="tag-color-opt"
              onClick={() => {
                onSetColor(c);
                setOpen(false);
              }}
            >
              <span className={'tag-swatch tag-' + c} />
              <span className="tag-color-name">{TAG_COLOR_LABELS[c]}</span>
              {current === c && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// RowProperties renders a database row's typed properties as a Notion-style
// panel under the title (label · value), so a row's page shows its Status,
// Priorität, etc. as real fields — not as text dumped into the body. Shown only
// when the page is a child of a collection. Reuses the same PropertyValue cells
// (and inline option editing) as the table/board.
function RowProperties({
  pageId,
  parentId,
  initialProps,
  canEdit,
}: {
  pageId: string;
  parentId: string;
  initialProps: Record<string, unknown>;
  canEdit: boolean;
}) {
  const [config, setConfig] = useState<CollectionConfig | null>(null);
  const [props, setProps] = useState<Record<string, unknown>>(initialProps ?? {});

  useEffect(() => {
    setProps(initialProps ?? {});
  }, [pageId, initialProps]);

  useEffect(() => {
    let alive = true;
    api
      .getCollection(parentId)
      .then((c) => alive && setConfig(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [parentId]);

  if (!config || config.schema.length === 0) return null;

  const setProp = async (propId: string, value: unknown) => {
    setProps((p) => ({ ...p, [propId]: value }));
    try {
      await api.updatePage(pageId, { propsPatch: { [propId]: value } });
    } catch {
      toast('Eigenschaft nicht gespeichert');
    }
  };
  const setOptions = async (propId: string, options: PropOption[]) => {
    const next: CollectionConfig = {
      ...config,
      schema: config.schema.map((p) => (p.id === propId ? { ...p, options } : p)),
    };
    setConfig(next);
    try {
      await api.putCollection(parentId, next);
    } catch {
      toast('Optionen nicht gespeichert');
    }
  };

  return (
    <div className="row-props">
      {config.schema.map((p) => (
        <div key={p.id} className="row-prop">
          <div className="row-prop-label" title={p.name}>
            {p.name}
          </div>
          <div className="row-prop-value">
            <PropertyValue
              def={p}
              value={props[p.id]}
              onChange={canEdit ? (v) => setProp(p.id, v) : undefined}
              onOptionsChange={canEdit ? (o) => setOptions(p.id, o) : undefined}
              readOnly={!canEdit}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function PageHeader({
  page,
  pageId,
  favorite,
  user,
  canEdit,
  tagColors,
  onSetTagColor,
  onMenu,
  onToggleFavorite,
  onMetaChange,
  onNavigate,
  onLocalMeta,
  onPagesChanged,
  pagesById,
  children,
}: EditorProps & {
  page: Page;
  onLocalMeta: (patch: Partial<PageMeta>) => void;
  children?: React.ReactNode;
}) {
  const [title, setTitle] = useState(page.title);
  const [tags, setTags] = useState<string[]>(page.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [tagSuggestOpen, setTagSuggestOpen] = useState(false);
  const [tagSel, setTagSel] = useState(0);
  const [description, setDescription] = useState(page.description ?? '');
  const [showDesc, setShowDesc] = useState(!!page.description);
  const importInput = useRef<HTMLInputElement>(null);
  const [icon, setIcon] = useState(page.icon);
  const [cover, setCover] = useState(page.cover);
  const [visibility, setVisibility] = useState(page.visibility);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareExpiry, setShareExpiry] = useState(0); // days; 0 = never
  const [sharePassword, setSharePassword] = useState('');
  const [overflowOpen, setOverflowOpen] = useState(false);
  // Dropdowns must close on an outside click / Escape, not just mouse-leave.
  const shareWrapRef = useRef<HTMLDivElement>(null);
  const overflowWrapRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(shareOpen, shareWrapRef, () => setShareOpen(false));
  useMenuDismiss(overflowOpen, overflowWrapRef, () => setOverflowOpen(false));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openComments, setOpenComments] = useState(0);
  const peers = usePeers(pageId);
  // Der Zaehler in der Kopfzeile soll stimmen, bevor man nach unten gescrollt
  // hat — man soll SEHEN, dass es Kommentare gibt, ohne danach zu suchen.
  useEffect(() => {
    let alive = true;
    api
      .listComments(pageId)
      .then((l) => alive && setOpenComments(l.filter((c) => !c.resolvedAt).length))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pageId]);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [coverMenuOpen, setCoverMenuOpen] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingMeta = useRef<{ title?: string; icon?: string; cover?: string; tags?: string[]; description?: string }>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Grow the title to fit its text (any length wraps to as many lines as needed,
  // like Notion) — on every edit and whenever the page (and thus title) changes.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    };
    fit();
    // scrollHeight haengt an der BREITE. Wird die Spalte schmaler — Fenster
    // verkleinern, Seitenleiste einklappen —, bricht der Titel auf mehr Zeilen
    // um, ohne dass sich der Text aendert. Ohne Nachmessen blieb die alte Hoehe
    // stehen und die letzte Zeile verschwand hinter den Knoepfen darunter.
    //
    // Beobachtet wird der ELTERNTEIL, nicht das Feld selbst: fit() aendert die
    // Hoehe des Feldes, und wer ein Element in dessen eigener Rueckmeldung
    // veraendert, erzeugt eine Schleife — die der Browser still abschaltet.
    // Genau daran ist die erste Fassung gescheitert.
    const box = el.parentElement;
    if (!box) return;
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [title]);

  useEffect(() => {
    setTitle(page.title);
    setIcon(page.icon);
    setCover(page.cover);
    setVisibility(page.visibility);
  }, [page.title, page.icon, page.cover, page.visibility]);

  // Toggle a `scrolled` class on the page body (with hysteresis so it never
  // flaps) — CSS uses it to shrink the docked page icon once the collapsed
  // cover strip is pinned.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    let scrolled = false;
    const onScroll = () => {
      const s = el.scrollTop;
      if (!scrolled && s > 110) {
        scrolled = true;
        el.classList.add('scrolled');
      } else if (scrolled && s < 90) {
        scrolled = false;
        el.classList.remove('scrolled');
      }
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const togglePrivate = () => {
    const next = visibility === 'private' ? 'workspace' : 'private';
    setVisibility(next);
    api.updatePage(pageId, { visibility: next }).catch(() => toast('Sichtbarkeit nicht gespeichert'));
  };

  const createShare = async (days: number, password: string) => {
    try {
      const res = await api.sharePage(pageId, days, password);
      // Absolute URL on the external domain when configured; else current origin.
      setShareUrl(res.url.startsWith('http') ? res.url : location.origin + res.url);
    } catch {
      toast('Teilen fehlgeschlagen');
    }
  };

  const openShare = async () => {
    setShareOpen((o) => !o);
    if (!shareUrl) await createShare(shareExpiry, sharePassword);
  };

  const changeExpiry = async (days: number) => {
    setShareExpiry(days);
    // Re-mint the link with the new settings (the server replaces the old token).
    await createShare(days, sharePassword);
  };

  const stopShare = async () => {
    await api.unsharePage(pageId).catch(() => {});
    setShareUrl(null);
    setShareOpen(false);
  };

  const saveMeta = (patch: { title?: string; icon?: string; cover?: string; tags?: string[]; description?: string }) => {
    onMetaChange(pageId, patch);
    onLocalMeta(patch);
    // Accumulate across fields so a title edit followed quickly by a cover
    // change doesn't cancel the title write — a single shared timer flushes
    // the merged patch.
    Object.assign(pendingMeta.current, patch);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const merged = pendingMeta.current;
      pendingMeta.current = {};
      api.updatePage(pageId, merged).catch(() => {
        Object.assign(pendingMeta.current, merged); // keep for a later retry
        toast('Titel/Icon nicht gespeichert');
      });
    }, 500);
  };

  // Tags: client-side clean (strip '#', dedupe) is cosmetic — the server
  // re-normalizes authoritatively on save.
  const commitTags = (next: string[]) => {
    const clean: string[] = [];
    const seen = new Set<string>();
    for (let t of next) {
      t = t.trim().replace(/^#/, '').replace(/\s+/g, '-');
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      clean.push(t);
    }
    setTags(clean);
    saveMeta({ tags: clean });
  };
  const addTag = (value?: string) => {
    const v = value ?? tagDraft;
    if (v.trim()) {
      commitTags([...tags, v]);
      setTagDraft('');
      setTagSuggestOpen(false);
      setTagSel(0);
    }
  };
  const removeTag = (t: string) => commitTags(tags.filter((x) => x !== t));

  // Alle bereits vergebenen Tags stecken schon in den Seiten-Metadaten — dafür
  // braucht es keinen zusätzlichen Request.
  const allTags = useMemo(() => collectTags(pagesById.values()), [pagesById]);
  const tagHits = useMemo(
    () => (tagSuggestOpen ? suggestTags(allTags, tagDraft, tags) : []),
    [tagSuggestOpen, allTags, tagDraft, tags],
  );

  const changeDescription = (v: string) => {
    setDescription(v);
    saveMeta({ description: v });
  };
  const removeDescription = () => {
    setShowDesc(false);
    changeDescription('');
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith('.zip')) {
        const r = await api.importZip(file);
        toast(`Import: ${r.created} Seiten${r.skipped ? `, ${r.skipped} übersprungen` : ''}`);
        onPagesChanged();
      } else {
        const text = await file.text();
        const r = await api.importMarkdown(null, '', text);
        toast('Seite importiert');
        onPagesChanged();
        onNavigate(r.id);
      }
    } catch (err) {
      toast((err as Error).message || 'Import fehlgeschlagen');
    }
  };

  const setCoverValue = (value: string) => {
    setCover(value);
    setCoverMenuOpen(false);
    saveMeta({ cover: value });
  };

  const onCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const url = await api.upload(file);
    setCoverValue(url);
  };

  const breadcrumbs = useMemo(() => {
    const chain: PageMeta[] = [];
    // Database rows are excluded from the tree map, so seed the chain from the
    // loaded page itself when it isn't in pagesById — otherwise a row would show
    // no breadcrumb at all.
    let cur: PageMeta | undefined = pagesById.get(pageId) ?? page;
    let guard = 0;
    while (cur && guard++ < 30) {
      chain.unshift(cur);
      cur = cur.parentId ? pagesById.get(cur.parentId) : undefined;
    }
    return chain;
  }, [pagesById, pageId, page]);

  return (
    <>
      <header className="topbar">
        <button className="menu-btn topbar-menu" title="Menu" onClick={onMenu}>
          <Menu size={18} />
        </button>
        <nav className="breadcrumbs">
          {breadcrumbs.map((b, i) => (
            <span key={b.id} className="crumb-wrap">
              {i > 0 && <span className="crumb-sep">/</span>}
              <button className="crumb" onClick={() => onNavigate(b.id)}>
                {(() => {
                  const ic = b.id === pageId ? icon : b.icon;
                  const tt = (b.id === pageId ? title : b.title) || 'Untitled';
                  return (
                    <>
                      {ic && (
                        <>
                          <PageIcon icon={ic} size={13} />{' '}
                        </>
                      )}
                      {tt}
                    </>
                  );
                })()}
              </button>
            </span>
          ))}
        </nav>
        <div className="topbar-right">
          {/* Wer sonst gerade auf der Seite ist. Die Praesenz wurde bisher zwar
              gesendet (awareness), aber NIRGENDS angezeigt — man arbeitete zu
              zweit im selben Dokument, ohne es zu merken. */}
          {peers.length > 0 && (
            <div className="presence" title={peers.map((p) => p.name).join(', ') + ' auch hier'}>
              {peers.slice(0, 3).map((p, i) => (
                <span key={i} className="presence-dot" style={{ background: p.avatar ? 'transparent' : p.color }}>
                  {p.avatar ? <img src={p.avatar} alt="" /> : initials(p.name)}
                </span>
              ))}
              {peers.length > 3 && <span className="presence-dot more">+{peers.length - 3}</span>}
            </div>
          )}
          <button
            className="icon-btn"
            title="Zu den Kommentaren springen"
            onClick={() =>
              document.getElementById('kommentare')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            <MessageSquare size={17} />
            {openComments > 0 && <span className="badge-count">{openComments}</span>}
          </button>
          <button
            className={'icon-btn' + (favorite ? ' active-star' : '')}
            title={favorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => onToggleFavorite(pageId)}
          >
            <Star size={17} fill={favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            className={'icon-btn' + (visibility === 'private' ? ' active-star' : '')}
            title={visibility === 'private' ? 'Private (only you) — click to share with workspace' : 'Visible to workspace — click to make private'}
            onClick={togglePrivate}
          >
            {visibility === 'private' ? <Lock size={17} /> : <LockOpen size={17} />}
          </button>
          <div className="share-wrap" ref={shareWrapRef}>
            <button className="icon-btn" title="Share to web (read-only link)" onClick={openShare}>
              <Globe size={17} />
            </button>
            {shareOpen && (
              <div className="menu share-menu">
                <div className="share-hint">Anyone with this link can view this page (read-only).</div>
                <input className="share-input" readOnly value={shareUrl ?? 'Creating…'} onFocus={(e) => e.currentTarget.select()} />
                <label className="share-expiry">
                  Expires:
                  <select
                    className="prop-select"
                    value={shareExpiry}
                    onChange={(e) => void changeExpiry(Number(e.target.value))}
                  >
                    <option value={0}>Never</option>
                    <option value={1}>In 1 day</option>
                    <option value={7}>In 7 days</option>
                    <option value={30}>In 30 days</option>
                  </select>
                </label>
                <input
                  className="share-input"
                  type="password"
                  placeholder="Passwort (optional)"
                  value={sharePassword}
                  onChange={(e) => setSharePassword(e.target.value)}
                  onBlur={() => void createShare(shareExpiry, sharePassword)}
                />
                <div className="share-actions">
                  <button
                    className="btn-sm"
                    onClick={() => shareUrl && void navigator.clipboard.writeText(shareUrl)}
                  >
                    Copy
                  </button>
                  <button className="btn-sm danger" onClick={stopShare}>
                    Stop sharing
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="share-wrap" ref={overflowWrapRef}>
            <button
              className="icon-btn"
              title="Mehr"
              aria-label="Weitere Aktionen"
              onClick={() => setOverflowOpen((o) => !o)}
            >
              <MoreHorizontal size={17} />
            </button>
            <input
              ref={importInput}
              type="file"
              accept=".md,.markdown,.zip"
              style={{ display: 'none' }}
              onChange={(e) => void onImportFile(e)}
            />
            {overflowOpen && (
              <div className="menu overflow-menu">
                {canEdit && !showDesc && !description && (
                  <button
                    className="menu-item"
                    onClick={() => {
                      setOverflowOpen(false);
                      setShowDesc(true);
                    }}
                  >
                    <AlignLeft size={15} /> Beschreibung hinzufügen
                  </button>
                )}
                {canEdit && (showDesc || description) && (
                  <button
                    className="menu-item"
                    onClick={() => {
                      setOverflowOpen(false);
                      removeDescription();
                    }}
                  >
                    <AlignLeft size={15} /> Beschreibung entfernen
                  </button>
                )}
                <button
                  className="menu-item"
                  onClick={() => {
                    setOverflowOpen(false);
                    document.getElementById('kommentare')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  <MessageSquare size={15} /> Zu den Kommentaren
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setOverflowOpen(false);
                    setHistoryOpen(true);
                  }}
                >
                  <History size={15} /> Versionsverlauf
                </button>
                {canEdit && (
                  <button
                    className="menu-item"
                    onClick={() => {
                      importInput.current?.click();
                      setOverflowOpen(false);
                    }}
                  >
                    <Upload size={15} /> Import (.md / .zip)
                  </button>
                )}
                <div className="menu-sep" />
                <div className="menu-label">Exportieren</div>
                <button
                  className="menu-item"
                  onClick={() => {
                    api.download(`/api/export/${pageId}`);
                    setOverflowOpen(false);
                  }}
                >
                  <FileText size={15} /> Markdown (.md)
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    api.download(`/api/export/${pageId}?format=html`);
                    setOverflowOpen(false);
                  }}
                >
                  <FileCode size={15} /> Web-Seite (.html)
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setOverflowOpen(false);
                    if (page.type === 'collection') {
                      setTimeout(() => window.print(), 50);
                    } else {
                      // A clean standalone print/PDF view — works on mobile too,
                      // where window.print() is a no-op (share → save as PDF).
                      window.open(`/api/export/${pageId}?format=html&print=1`, '_blank');
                    }
                  }}
                >
                  <Printer size={15} /> Drucken / als PDF
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {/* Everything below the topbar scrolls as ONE page (Notion-style): the
          cover, icon, title, tags and the content leave the screen together —
          only the slim topbar stays. Crucial on mobile, where a static header
          left just a tiny scrolling window. */}
      <div className={'page-body' + (cover ? ' has-cover' : '')} ref={bodyRef}>
      {cover && (
        <div className="page-cover" style={coverStyle(cover)}>
          <div className="page-cover-actions">
            <input
              ref={coverInput}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={onCoverFile}
            />
            <button className="cover-btn" onClick={() => setCoverMenuOpen((o) => !o)}>
              Change cover
            </button>
            <button className="cover-btn" onClick={() => setCoverValue('')}>
              Remove
            </button>
            {coverMenuOpen && (
              <CoverMenu
                onGradient={setCoverValue}
                onUpload={() => coverInput.current?.click()}
                onClose={() => setCoverMenuOpen(false)}
              />
            )}
          </div>
        </div>
      )}
      {/* The icon row lives OUTSIDE .page-head so it can dock (sticky) on the
          collapsed cover strip while scrolling — the big emoji stays fully
          visible instead of sliding half-hidden under the banner. */}
      <div className={'page-icon-row' + (page.type === 'collection' ? ' page-icon-row--db' : '')}>
        {icon && (
          <button className="page-icon icon-trigger" onClick={() => setIconPickerOpen((o) => !o)}>
            <PageIcon icon={icon} size={54} />
          </button>
        )}
        {iconPickerOpen && (
          <IconPicker
            pageId={pageId}
            onPick={(e) => {
              setIcon(e);
              setIconPickerOpen(false);
              saveMeta({ icon: e });
            }}
            onRemove={() => {
              setIcon('');
              setIconPickerOpen(false);
              saveMeta({ icon: '' });
            }}
            onClose={() => setIconPickerOpen(false)}
          />
        )}
        {historyOpen && (
          <HistoryModal
            pageId={pageId}
            onClose={() => setHistoryOpen(false)}
            onRestored={onPagesChanged}
          />
        )}
      </div>
      <div className={'page-head' + (cover ? ' with-cover' : '') + (page.type === 'collection' ? ' page-head--db' : '')}>
        <textarea
          ref={titleRef}
          className="page-title"
          value={title}
          placeholder="Untitled"
          rows={1}
          onChange={(e) => {
            setTitle(e.target.value);
            saveMeta({ title: e.target.value });
          }}
          onKeyDown={(e) => {
            // A title is a single line of text: Enter never inserts a newline
            // (it jumps into the body instead of breaking the title).
            if (e.key === 'Enter') {
              e.preventDefault();
              bodyRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
            }
          }}
        />
        {/* Immer sichtbare Anlege-Zeile UNTER dem Titel (statt hover-versteckter
            Buttons — auf Touch-Geräten unerreichbar, sobald ein Cover da war).
            Zeigt nur, was noch fehlt: Emoji, Cover, Beschreibung. */}
        {canEdit && (!icon || !cover || (!showDesc && !description)) && (
          <div className="head-adders">
            <input
              ref={coverInput}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={onCoverFile}
            />
            {!icon && (
              <button className="add-btn" onClick={() => setIconPickerOpen((o) => !o)}>
                <Smile size={14} /> Emoji
              </button>
            )}
            {!cover && (
              <button className="add-btn cover-trigger" onClick={() => setCoverMenuOpen((o) => !o)}>
                <ImageIcon size={14} /> Cover
              </button>
            )}
            {!showDesc && !description && (
              <button className="add-btn" onClick={() => setShowDesc(true)}>
                <AlignLeft size={14} /> Beschreibung
              </button>
            )}
            {/* Cover-Menü nur hier, solange KEIN Cover existiert — mit Cover
                rendert der "Change cover"-Button oben rechts (W32c: zwei
                Instanzen am selben State fressen sich gegenseitig die Klicks). */}
            {!cover && coverMenuOpen && (
              <CoverMenu
                onGradient={setCoverValue}
                onUpload={() => coverInput.current?.click()}
                onClose={() => setCoverMenuOpen(false)}
              />
            )}
          </div>
        )}
        {(showDesc || description) && (
          <div className="page-description">
            {canEdit ? (
              <textarea
                value={description}
                placeholder="Beschreibung hinzufügen…"
                rows={1}
                autoFocus={showDesc && !description}
                onChange={(e) => {
                  changeDescription(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onBlur={(e) => {
                  if (!e.target.value.trim()) setShowDesc(false);
                }}
                ref={(el) => {
                  if (el) {
                    el.style.height = 'auto';
                    el.style.height = el.scrollHeight + 'px';
                  }
                }}
              />
            ) : (
              <div>{description}</div>
            )}
          </div>
        )}
        {(canEdit || tags.length > 0) && (
          <div className="page-tags">
            {tags.map((t) => (
              <TagChip
                key={t}
                tag={t}
                colors={tagColors}
                canEdit={canEdit}
                onRemove={() => removeTag(t)}
                onSetColor={(c) => onSetTagColor(t, c)}
              />
            ))}
            {canEdit && (
              <span className="tag-input-wrap">
                <input
                  className="page-tag-input"
                  value={tagDraft}
                  placeholder={tags.length ? '+ Tag' : '+ Tag hinzufügen'}
                  onChange={(e) => {
                    setTagDraft(e.target.value);
                    setTagSuggestOpen(true);
                    setTagSel(0);
                  }}
                  onFocus={() => setTagSuggestOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      if (!tagHits.length) return;
                      e.preventDefault();
                      const d = e.key === 'ArrowDown' ? 1 : -1;
                      setTagSel((i) => (i + d + tagHits.length) % tagHits.length);
                    } else if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
                      // Ein hervorgehobener Vorschlag gewinnt gegen den Rohtext —
                      // sonst legt Enter doch wieder eine Dublette an.
                      const pick = tagSuggestOpen ? tagHits[tagSel] : undefined;
                      if (!pick && !tagDraft.trim()) return; // Tab darf normal weiterspringen
                      e.preventDefault();
                      addTag(pick?.tag);
                    } else if (e.key === 'Escape') {
                      setTagSuggestOpen(false);
                    } else if (e.key === 'Backspace' && !tagDraft && tags.length) {
                      removeTag(tags[tags.length - 1]);
                    }
                  }}
                  onBlur={() => {
                    // Klicks auf einen Vorschlag feuern erst nach dem Blur.
                    setTimeout(() => {
                      setTagSuggestOpen(false);
                      addTag();
                    }, 120);
                  }}
                />
                {tagSuggestOpen && tagHits.length > 0 && (
                  <div className="tag-suggest">
                    {tagHits.map((s, i) => (
                      <button
                        key={s.tag}
                        type="button"
                        className={'tag-suggest-item' + (i === tagSel ? ' on' : '')}
                        onMouseDown={(e) => e.preventDefault()} // Blur zuvorkommen
                        onClick={() => addTag(s.tag)}
                      >
                        <span className={'tag-chip ' + tagColorClass(s.tag, tagColors)}>#{s.tag}</span>
                        <span className="tag-suggest-count">{s.count}</span>
                        {s.similar && <span className="tag-suggest-hint">ähnlich</span>}
                      </button>
                    ))}
                  </div>
                )}
              </span>
            )}
          </div>
        )}
        {page.parentId && pagesById.get(page.parentId)?.type === 'collection' && (
          <RowProperties
            pageId={pageId}
            parentId={page.parentId}
            initialProps={page.props}
            canEdit={canEdit}
          />
        )}
      </div>
      {children}
      {/* Kommentare gehoeren ans Ende des Dokuments, nicht in eine Spalte
          daneben — siehe CommentsSection. Nur bei Dokumenten und Zeilen; eine
          Datenbank-Seite hat unten ihre Tabelle, darunter waere es verloren. */}
      {page.type !== 'collection' && (
        <div className="comments-wrap">
          <CommentsSection pageId={pageId} myUserId={user.id} onCountChange={setOpenComments} />
        </div>
      )}
      </div>
    </>
  );
}

function CoverMenu({
  onGradient,
  onUpload,
  onClose,
}: {
  onGradient: (value: string) => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      // Ignore this menu's own triggers (they toggle it); a click on the icon
      // trigger correctly falls through and closes the cover menu.
      if (t.closest?.('.cover-trigger, .cover-btn')) return;
      if (ref.current && !ref.current.contains(t)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  return (
    <div className="cover-menu" ref={ref}>
      <button className="cover-upload" onClick={onUpload}>
        ⤒ Upload image
      </button>
      <div className="cover-grid">
        {COVER_GRADIENTS.map((g) => (
          <button
            key={g}
            className="cover-swatch"
            style={{ background: g.slice('gradient:'.length) }}
            onClick={() => onGradient(g)}
          />
        ))}
      </div>
    </div>
  );
}

// ---- realtime block editor ----

interface CollabProps {
  page: Page;
  user: User;
  theme: 'light' | 'dark';
  canEdit: boolean;
  pagesById: Map<string, PageMeta>;
  tagColors: Record<string, string>;
  onNavigate: (id: string | null) => void;
  onCreatePage: (parentId: string | null, type?: 'doc' | 'collection') => void;
  onPagesChanged: () => void;
  onReset: () => void;
}

function CollabEditor({ page, user, theme, canEdit, onReset, ...rest }: CollabProps) {
  const [ready, setReady] = useState(false);
  const providerRef = useRef<SaltProvider | null>(null);

  // One provider per mounted page.
  const provider = useMemo(() => {
    const p = new SaltProvider(
      page.id,
      (isNew) => {
        // Seed a brand-new CRDT doc from the page's stored content once.
        if (isNew && Array.isArray(page.content) && page.content.length > 0) {
          seedRef.current = page.content;
        }
        setReady(true);
      },
      onReset,
    );
    p.awareness.setLocalStateField('user', { name: user.name, color: user.color, avatar: user.avatar });
    // Die Awareness kannte die anderen laengst — nur sah man sie nie. Hier
    // werden sie in den Praesenz-Speicher geschrieben, den die Kopfzeile liest.
    const pushPeers = () => {
      const mine = p.awareness.clientID;
      const out: { name: string; color: string; avatar?: string }[] = [];
      p.awareness.getStates().forEach((state: Record<string, unknown>, id: number) => {
        if (id === mine) return;
        const u = state.user as { name?: string; color?: string; avatar?: string } | undefined;
        if (u?.name) out.push({ name: u.name, color: u.color || '#888', avatar: u.avatar });
      });
      setPeers(page.id, out);
    };
    p.awareness.on('change', pushPeers);
    pushPeers();
    providerRef.current = p;
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  const seedRef = useRef<unknown[] | null>(null);

  useEffect(() => {
    return () => {
      clearPeers(page.id);
      provider.destroy();
    };
  }, [provider]);

  if (!ready) return <div className="editor-loading" />;
  return (
    <BlockContent
      provider={provider}
      seed={seedRef.current}
      hadContent={Array.isArray(page.content) && page.content.length > 0}
      user={user}
      theme={theme}
      canEdit={canEdit}
      {...rest}
    />
  );
}

// A BlockNote document counts as "empty" when it's a single empty paragraph.
function isEffectivelyEmpty(doc: unknown[]): boolean {
  if (!Array.isArray(doc) || doc.length === 0) return true;
  if (doc.length > 1) return false;
  const b = doc[0] as { type?: string; content?: unknown[] };
  return b?.type === 'paragraph' && (!b.content || b.content.length === 0);
}

function BlockContent({
  provider,
  seed,
  hadContent,
  user,
  theme,
  canEdit,
  pagesById,
  tagColors,
  onNavigate,
  onCreatePage,
  onPagesChanged,
}: {
  provider: SaltProvider;
  seed: unknown[] | null;
  hadContent: boolean;
  user: User;
  theme: 'light' | 'dark';
  canEdit: boolean;
  pagesById: Map<string, PageMeta>;
  tagColors: Record<string, string>;
  onNavigate: (id: string | null) => void;
  onCreatePage: (parentId: string | null, type?: 'doc' | 'collection') => void;
  onPagesChanged: () => void;
}) {
  const editor = useCreateBlockNote({
    schema: saltSchema,
    collaboration: {
      provider,
      fragment: provider.doc.getXmlFragment('blocknote'),
      user: { name: user.name, color: user.color },
    },
    uploadFile: (file: File) => api.upload(file),
    // Column layout: edge-drop cursor + its dictionary entries.
    dropCursor: multiColumnDropCursor,
    dictionary: { ...coreEn, multi_column: multiColumnLocales.en },
  });

  // Slash menu: default items + column layout + our custom blocks.
  const getSlashItems = async (query: string) => {
    const custom = [
      {
        title: 'Callout',
        subtext: 'Hervorgehobener Hinweis mit Emoji',
        aliases: ['callout', 'hinweis', 'info', 'warnung'],
        group: 'Basic blocks',
        icon: <span>💡</span>,
        onItemClick: () =>
          insertOrUpdateBlockForSlashMenu(editor, { type: 'callout' } as never),
      },
      {
        title: 'Bookmark / Embed',
        subtext: 'Link-Karte oder YouTube/Vimeo-Player',
        aliases: ['bookmark', 'embed', 'link', 'video', 'youtube'],
        group: 'Media',
        icon: <span>🔖</span>,
        onItemClick: () =>
          insertOrUpdateBlockForSlashMenu(editor, { type: 'bookmark' } as never),
      },
      {
        title: 'Datenbank einbetten',
        subtext: 'Eine vorhandene Datenbank mitten im Dokument anzeigen',
        aliases: ['datenbank', 'database', 'db', 'tabelle', 'board', 'kanban'],
        group: 'Basic blocks',
        icon: <span>▦</span>,
        onItemClick: () =>
          insertOrUpdateBlockForSlashMenu(editor, { type: 'database' } as never),
      },
      {
        title: 'Inhaltsverzeichnis',
        subtext: 'Auto-Liste aller Überschriften',
        aliases: ['toc', 'inhalt', 'inhaltsverzeichnis', 'outline'],
        group: 'Basic blocks',
        icon: <span>📑</span>,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'toc' } as never),
      },
    ];
    return filterSuggestionItems(
      [
        ...getDefaultReactSlashMenuItems(editor),
        ...getMultiColumnSlashMenuItems(editor),
        ...custom,
      ],
      query,
    );
  };

  // Page-link menu (shared by the "@" mention trigger and the "[[" wiki-link
  // trigger): existing pages plus a "create new page" action.
  const buildLinkItems = async (query: string) => {
    const q = query.toLowerCase();
    const matches = [...pagesById.values()]
      .filter((p) => !p.trashed && p.id !== provider.pageId)
      .filter((p) => (p.title || 'Untitled').toLowerCase().includes(q))
      .slice(0, 12);
    const items = matches.map((p) => ({
      title: p.title || 'Untitled',
      subtext: p.type === 'collection' ? 'Database' : 'Page',
      onItemClick: () =>
        editor.insertInlineContent([
          { type: 'pageLink', props: { pageId: p.id, label: p.title || 'Untitled' } },
          ' ',
        ]),
    }));
    if (query.trim()) {
      items.push({
        title: `Create "${query.trim()}"`,
        subtext: 'New page',
        onItemClick: async () => {
          try {
            const created = await api.createPage(null, query.trim());
            onPagesChanged();
            editor.insertInlineContent([
              { type: 'pageLink', props: { pageId: created.id, label: created.title || query.trim() } },
              ' ',
            ]);
          } catch (e) {
            console.error('Salt.md: failed to create page from mention', e);
          }
        },
      });
    }
    return items;
  };

  const getMentionItems = (query: string) => buildLinkItems(query);
  // Wiki-links: the trigger is "[" (BlockNote uses single-char triggers), so the
  // text after it starts with a second "[" when the user types "[[". We strip
  // stray brackets ("[[Page]]") before matching.
  const getWikiItems = (raw: string) => buildLinkItems(raw.replace(/^\[+/, '').replace(/\]+$/, ''));

  // Seed initial content into an empty shared doc exactly once. If seeding
  // throws (e.g. a block shape BlockNote rejects), we must NOT enter the
  // materialize path, or the debounced write would persist an empty document
  // over the real stored content.
  const seededRef = useRef(false);
  const seedFailed = useRef(false);
  useEffect(() => {
    if (seededRef.current || !seed || seed.length === 0) return;
    seededRef.current = true;
    const frag = provider.doc.getXmlFragment('blocknote');
    if (frag.length === 0) {
      try {
        editor.replaceBlocks(editor.document, seed as never);
      } catch (e) {
        seedFailed.current = true;
        console.error('Salt.md: failed to seed page content', e);
      }
    }
  }, [editor, provider, seed]);

  // Persist a materialized copy to pages.content so search, export, backlinks
  // and the Markdown/MCP API see current text. Debounced; skips the CRDT reset.
  const matTimer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  useEffect(() => {
    const flush = (keepalive: boolean) => {
      if (seedFailed.current || !dirty.current) return;
      const doc = editor.document;
      // Guard against clobbering stored content with an accidentally-empty doc.
      if (hadContent && isEffectivelyEmpty(doc)) return;
      dirty.current = false;
      if (keepalive) {
        // Unmount (e.g. following a link chip): a normal fetch would be
        // cancelled, so use keepalive to guarantee the write — otherwise the
        // just-inserted @-mention's backlink would never be recorded.
        void fetch(`/api/pages/${provider.pageId}?materialize=1`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: doc }),
          keepalive: true,
        });
      } else {
        api.updatePage(provider.pageId, { content: doc }, { materialize: true }).catch(() => {
          dirty.current = true; // retry on next change / unmount flush
          toast('Seiteninhalt nicht gespeichert');
        });
      }
    };
    const persist = () => {
      dirty.current = true;
      window.clearTimeout(matTimer.current);
      matTimer.current = window.setTimeout(() => flush(false), 1500);
    };
    const unsub = editor.onChange?.(persist);
    return () => {
      window.clearTimeout(matTimer.current);
      flush(true); // flush any pending edit before this editor unmounts
      if (typeof unsub === 'function') unsub();
    };
  }, [editor, provider, hadContent]);

  return (
    <div className="editor-scroll">
      <div className="editor-inner">
        {/* Der Datenbank-Block rendert innerhalb des Editors und kommt sonst
            nicht an Seitenliste, Tag-Farben und Navigation heran. */}
        <BlockContext.Provider value={{ pagesById, tagColors, onNavigate, onPagesChanged }}>
        <BlockNoteView editor={editor} theme={theme} editable={canEdit} slashMenu={false}>
          <SuggestionMenuController triggerCharacter="/" getItems={getSlashItems} />
          <SuggestionMenuController
            triggerCharacter="@"
            getItems={getMentionItems}
          />
          <SuggestionMenuController
            triggerCharacter="["
            getItems={getWikiItems}
          />
        </BlockNoteView>
        </BlockContext.Provider>
        <Backlinks pageId={provider.pageId} pagesById={pagesById} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

// "Linked references" — other pages that @-mention this one.
function Backlinks({
  pageId,
  pagesById,
  onNavigate,
}: {
  pageId: string;
  pagesById: Map<string, PageMeta>;
  onNavigate: (id: string | null) => void;
}) {
  const [links, setLinks] = useState<Backlink[]>([]);
  // Refetch when the page changes or the page list updates — App rebuilds the
  // pagesById map on every reload, so depending on its identity catches new
  // links from tree changes (size-only deps would miss same-count updates).
  useEffect(() => {
    let alive = true;
    api
      .backlinks(pageId)
      .then((l) => alive && setLinks(l))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pageId, pagesById]);

  if (links.length === 0) return null;
  return (
    <div className="backlinks">
      <div className="backlinks-head">🔗 Linked references · {links.length}</div>
      {links.map((l) => (
        <button key={l.id} className="backlink-item" onClick={() => onNavigate(l.id)}>
          <span className="tree-icon"><PageIcon icon={l.icon} size={14} fallback="📄" /></span>
          {l.title || 'Untitled'}
        </button>
      ))}
    </div>
  );
}
