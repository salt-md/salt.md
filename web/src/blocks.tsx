import { useEffect, useState } from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { Table2 } from 'lucide-react';
import { useBlockCtx } from './blockContext';
import { PageIcon } from './pageIcon';
import CollectionView from './components/CollectionView';

// Custom Salt.md block types (Welle 17): callout, table of contents, bookmark.
// Multi-column comes from @blocknote/xl-multi-column and is wired in pageLink.tsx.

// safeHref collapses any non-http(s)/mailto URL to '#'. A bookmark url can be
// planted via realtime collab or the API (which bypass the input handler's
// https:// normalization), so `javascript:` values must never reach an <a href>.
function safeHref(u: string): string {
  try {
    const p = new URL(u, window.location.origin).protocol.toLowerCase();
    return p === 'http:' || p === 'https:' || p === 'mailto:' ? u : '#';
  } catch {
    return '#';
  }
}

// ---- Callout ----
// An emphasized box with a leading emoji. Clicking the emoji cycles through a
// preset list (kept simple on purpose — no popover to fight the editor focus).

const CALLOUT_EMOJIS = ['💡', '⚠️', '❗', '✅', '📌', '🔥', 'ℹ️'];

export const calloutSpec = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: {
      emoji: { default: '💡' },
    },
    content: 'inline',
  } as const,
  {
    render: (props) => {
      const { block, editor, contentRef } = props;
      const emoji = (block.props as { emoji: string }).emoji || '💡';
      const cycle = () => {
        const i = CALLOUT_EMOJIS.indexOf(emoji);
        const next = CALLOUT_EMOJIS[(i + 1) % CALLOUT_EMOJIS.length];
        editor.updateBlock(block, { props: { emoji: next } } as never);
      };
      return (
        <div className="bn-callout">
          <button
            type="button"
            className="bn-callout-emoji"
            contentEditable={false}
            title="Symbol wechseln"
            onClick={cycle}
          >
            {emoji}
          </button>
          <div className="bn-callout-content" ref={contentRef} />
        </div>
      );
    },
  },
);

// ---- Table of contents ----
// Lists the document's headings; clicking scrolls to the heading. Recomputed
// on every document change while mounted.

interface TocEntry {
  id: string;
  level: number;
  text: string;
}

function collectHeadings(blocks: unknown[], out: TocEntry[]) {
  for (const b of blocks as {
    id?: string;
    type?: string;
    props?: { level?: number };
    content?: { text?: string }[];
    children?: unknown[];
  }[]) {
    if (b?.type === 'heading' && b.id) {
      const text = (b.content ?? [])
        .map((c) => c.text ?? '')
        .join('')
        .trim();
      out.push({ id: b.id, level: b.props?.level ?? 1, text: text || 'Untitled' });
    }
    if (b?.children?.length) collectHeadings(b.children, out);
  }
}

export const tocSpec = createReactBlockSpec(
  {
    type: 'toc',
    propSchema: {},
    content: 'none',
  } as const,
  {
    render: (props) => {
      const { editor } = props;
      const [entries, setEntries] = useState<TocEntry[]>([]);
      useEffect(() => {
        const compute = () => {
          const out: TocEntry[] = [];
          collectHeadings(editor.document as unknown[], out);
          setEntries(out);
        };
        compute();
        const unsub = editor.onChange?.(compute);
        return () => {
          if (typeof unsub === 'function') unsub();
        };
      }, [editor]);
      return (
        <div className="bn-toc" contentEditable={false}>
          <div className="bn-toc-title">Inhalt</div>
          {entries.length === 0 && <div className="bn-toc-empty">Keine Überschriften.</div>}
          {entries.map((e) => (
            <button
              key={e.id}
              type="button"
              className="bn-toc-entry"
              style={{ paddingLeft: 8 + (e.level - 1) * 14 }}
              onClick={() => {
                document
                  .querySelector(`[data-id="${e.id}"]`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {e.text}
            </button>
          ))}
        </div>
      );
    },
  },
);

// ---- Bookmark / embed ----
// Paste a URL: YouTube/Vimeo render as an embedded player, everything else as
// a link card. Stored as a plain {url} prop so export stays trivial.

function embedSrc(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube-nocookie.com/embed/${v}`;
    }
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    }
    if (host === 'vimeo.com') {
      const id = u.pathname.slice(1).split('/')[0];
      if (/^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export const bookmarkSpec = createReactBlockSpec(
  {
    type: 'bookmark',
    propSchema: {
      url: { default: '' },
    },
    content: 'none',
  } as const,
  {
    render: (props) => {
      const { block, editor } = props;
      const url = (block.props as { url: string }).url;
      const [draft, setDraft] = useState('');

      if (!url) {
        return (
          <div className="bn-bookmark-input" contentEditable={false}>
            <input
              className="prop-input"
              placeholder="Link einfügen (https://…) und Enter drücken"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && draft.trim()) {
                  let u = draft.trim();
                  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
                  editor.updateBlock(block, { props: { url: u } } as never);
                }
              }}
            />
          </div>
        );
      }

      const src = embedSrc(url);
      if (src) {
        return (
          <div className="bn-embed" contentEditable={false}>
            <iframe
              src={src}
              title={url}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        );
      }
      let host = url;
      try {
        host = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        /* keep raw */
      }
      return (
        <a
          className="bn-bookmark"
          href={safeHref(url)}
          target="_blank"
          rel="noopener noreferrer"
          contentEditable={false}
        >
          <span className="bn-bookmark-icon">🔖</span>
          <span className="bn-bookmark-body">
            <span className="bn-bookmark-url">{url}</span>
            <span className="bn-bookmark-host">{host}</span>
          </span>
        </a>
      );
    },
  },
);

// ---- Eingebettete Datenbank ----
//
// Notions Modell: eine Datenbank ist kein Seitentyp, sondern ein BLOCK. Sie
// kann als eigene Seite stehen ODER mitten in einem Dokument liegen, mit Text
// darüber und darunter. Dieser Block ist die zweite Variante.
//
// Gespeichert wird nur die Id der Datenbank — die Datenbank selbst bleibt EIN
// Objekt an EINEM Ort. Der Block ist eine Ansicht darauf, keine Kopie. Damit
// kann dieselbe Datenbank in mehreren Dokumenten auftauchen, und eine Änderung
// ist überall sofort sichtbar.
//
// Der Grund für diesen Block: bisher musste man ein Einleitungsdokument UND
// eine Datenbank getrennt anlegen, weil eine Datenbankseite keinen Textkörper
// haben kann. Jetzt gehört beides in ein Dokument.

export const databaseSpec = createReactBlockSpec(
  {
    type: 'database',
    propSchema: {
      collectionId: { default: '' },
    },
    content: 'none',
  } as const,
  {
    render: (props) => {
      const { block, editor } = props;
      const collectionId = (block.props as { collectionId: string }).collectionId;
      const { pagesById, tagColors, onNavigate, onPagesChanged } = useBlockCtx();
      const [q, setQ] = useState('');

      if (!collectionId) {
        const dbs = [...pagesById.values()]
          .filter((p) => p.type === 'collection' && !p.trashed)
          .filter((p) => (p.title || '').toLowerCase().includes(q.trim().toLowerCase()));
        return (
          <div className="bn-db-picker" contentEditable={false}>
            <input
              className="prop-input"
              placeholder="Datenbank suchen…"
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <div className="bn-db-picker-list">
              {dbs.length === 0 && <div className="bn-db-picker-empty">Keine Datenbank gefunden</div>}
              {dbs.slice(0, 8).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => editor.updateBlock(block, { props: { collectionId: d.id } } as never)}
                >
                  <PageIcon icon={d.icon} size={15} fallback={<Table2 size={15} />} />{' '}
                  {d.title || 'Untitled'}
                </button>
              ))}
            </div>
          </div>
        );
      }

      const db = pagesById.get(collectionId);
      if (!db) {
        // Gelöscht, oder in einem Workspace, den dieser Leser nicht sehen darf.
        // Kein Absturz, sondern ein ehrlicher Hinweis.
        return (
          <div className="bn-db-missing" contentEditable={false}>
            Diese Datenbank ist nicht (mehr) verfügbar.
          </div>
        );
      }
      return (
        <div className="bn-db-embed" contentEditable={false}>
          <button className="bn-db-title" type="button" onClick={() => onNavigate(collectionId)}>
            <PageIcon icon={db.icon} size={16} fallback={<Table2 size={16} />} /> {db.title || 'Untitled'}
            <span className="bn-db-open">Als Seite öffnen ↗</span>
          </button>
          <CollectionView
            collectionId={collectionId}
            pages={pagesById}
            tagColors={tagColors}
            onNavigate={onNavigate}
            onPagesChanged={onPagesChanged}
          />
        </div>
      );
    },
  },
);
