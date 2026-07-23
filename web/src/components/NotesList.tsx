import { useMemo, useState } from 'react';
import { SquarePen } from 'lucide-react';
import { PageMeta } from '../types';
import { PageIcon } from '../pageIcon';
import { tagColorClass } from '../tags';

// Bear-style middle column: a flat, recency-sorted list of note cards with
// snippet + thumbnail previews. Documents only — databases and their rows keep
// living in the sidebar tree; this pane is the "simple notes app" surface.

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = new Date(t);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d >= yesterday) return 'Gestern';
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}

interface Props {
  pages: Map<string, PageMeta>;
  currentWs: string;
  activeId: string | null;
  tagColors: Record<string, string>;
  tagFilter?: string | null;
  onClearTag?: () => void;
  onNavigate: (id: string) => void;
  onCreate: () => void;
}

export default function NotesList({ pages, currentWs, activeId, tagColors, tagFilter, onClearTag, onNavigate, onCreate }: Props) {
  const [list, setList] = useState<'all' | 'untagged'>('all');

  const notes = useMemo(() => {
    const all = [...pages.values()];
    const out = all.filter((p) => {
      if (p.trashed || p.isTemplate || p.type !== 'doc') return false;
      if (currentWs && p.workspaceId !== currentWs) return false;
      // Rows of a database are not standalone notes.
      const parent = p.parentId ? pages.get(p.parentId) : undefined;
      if (parent?.type === 'collection') return false;
      if (tagFilter) {
        return p.tags.some((t) => t.toLowerCase() === tagFilter.toLowerCase());
      }
      if (list === 'untagged' && p.tags.length > 0) return false;
      return true;
    });
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return out;
  }, [pages, currentWs, list, tagFilter]);

  return (
    <div className="notes-list">
      <div className="notes-head">
        <span className="notes-title">Notizen</span>
        <span className="notes-count">{notes.length}</span>
        <div className="notes-head-actions">
          <button className="notes-ic-btn" title="Neue Notiz (⌥N)" onClick={onCreate}>
            <SquarePen size={16} />
          </button>
        </div>
      </div>
      {tagFilter ? (
        <div className="notes-filters">
          <button className={'on notes-tagfilter ' + tagColorClass(tagFilter, tagColors)} onClick={onClearTag}>
            #{tagFilter} ×
          </button>
        </div>
      ) : (
        <div className="notes-filters">
          <button className={list === 'all' ? 'on' : ''} onClick={() => setList('all')}>
            Alle
          </button>
          <button className={list === 'untagged' ? 'on' : ''} onClick={() => setList('untagged')}>
            Ohne Tag
          </button>
        </div>
      )}
      <div className="notes-scroll">
        {notes.map((n) => (
          <button
            key={n.id}
            className={'note-card' + (n.id === activeId ? ' active' : '')}
            onClick={() => onNavigate(n.id)}
          >
            <span className="note-card-main">
              <span className="note-card-title">
                {n.icon && (
                  <span className="note-card-ic">
                    <PageIcon icon={n.icon} size={15} />
                  </span>
                )}
                {n.title || 'Ohne Titel'}
              </span>
              {n.snippet && <span className="note-card-snippet">{n.snippet}</span>}
              <span className="note-card-meta">
                <span className="note-card-time">{relTime(n.updatedAt)}</span>
                {n.tags.slice(0, 2).map((t) => (
                  <span key={t} className={'row-tag ' + tagColorClass(t, tagColors)}>
                    #{t}
                  </span>
                ))}
              </span>
            </span>
            {n.thumb && <img className="note-card-thumb" src={n.thumb} alt="" loading="lazy" />}
          </button>
        ))}
        {notes.length === 0 && (
          <div className="notes-empty">
            {tagFilter
              ? `Keine Notizen mit #${tagFilter}.`
              : list === 'untagged'
                ? 'Alles ist getaggt. 🎉'
                : 'Noch keine Notizen — leg die erste an.'}
          </div>
        )}
      </div>
    </div>
  );
}
