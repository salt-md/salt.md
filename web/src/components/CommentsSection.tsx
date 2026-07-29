import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import type { Comment } from '../types';
import { Check, ChevronDown, MessageSquareText, Trash2 } from 'lucide-react';
import { formatRelative } from '../format';
import { t } from '../i18n';

// Comments as a section at the end of the document — the way Notion does it.
//
// Two earlier versions got it wrong. First a dialog (three levels deep, laid
// over the text). Then a docked column that claimed width and, on a page with
// no comments, showed nothing but "No comments yet" — an empty pane beside a
// full document. Look closely and Notion has no column at all: the comments sit
// at the bottom of the flow, directly under the content.
//
// Third correction (this one): the section is COLLAPSED to a single slim row
// until it is opened. The always-open version put a tall header + compose box
// on every fresh page — a comments form was the most prominent thing on an
// empty document. The row still carries the open-comment count, so nothing is
// hidden that matters; the topbar button opens it via the event below.

/** Editor's topbar button says "open the comments" through this event. */
export const OPEN_COMMENTS_EVENT = 'salt:comments-open';

const when = (iso: string) => formatRelative(iso);

// Derive the colour from the name, so the same person always gets the same one.
export function nameColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hues = [210, 145, 275, 25, 340, 190, 95, 55];
  return `hsl(${hues[h % hues.length]} 55% 45%)`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export default function CommentsSection({
  pageId,
  myUserId,
  onCountChange,
  hidden,
}: {
  pageId: string;
  myUserId: string;
  onCountChange?: (n: number) => void;
  /** Row completely off (topbar toggle). Stays mounted so the badge count
      in the topbar keeps loading. */
  hidden?: boolean;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Collapse again when navigating to another page — the state belongs to the
  // page, not to the mounted component instance (Editor keeps it mounted).
  useEffect(() => setExpanded(false), [pageId]);

  // The topbar comment button scrolls here AND opens the section.
  useEffect(() => {
    const openUp = () => setExpanded(true);
    window.addEventListener(OPEN_COMMENTS_EVENT, openUp);
    return () => window.removeEventListener(OPEN_COMMENTS_EVENT, openUp);
  }, []);

  const load = () =>
    void api
      .listComments(pageId)
      .then((list) => {
        setComments(list);
        onCountChange?.(list.filter((c) => !c.resolvedAt).length);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [pageId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setBody('');
    try {
      await api.createComment(pageId, text);
      load();
      // Your own contribution should be visible, not below the fold.
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e6, behavior: 'smooth' }));
    } catch (err) {
      setBody(text); // swallow nothing if sending fails
      toast((err as Error).message || t('Could not post the comment'));
    }
  };

  const toggleResolve = async (c: Comment) => {
    await api.resolveComment(c.id, !c.resolvedAt).catch(() => {});
    load();
  };
  const remove = async (c: Comment) => {
    await api.deleteComment(c.id).catch(() => {});
    load();
  };

  const open = comments.filter((c) => !c.resolvedAt);
  const resolved = comments.filter((c) => c.resolvedAt);
  const visible = showResolved ? comments : open;

  if (hidden) return null;

  return (
    <section
      className={'comments-section' + (expanded ? ' is-open' : '')}
      id="kommentare"
      aria-label={t('Comments')}
    >
      <button
        type="button"
        className="cp-bar"
        aria-expanded={expanded}
        onClick={() => setExpanded((o) => !o)}
      >
        <MessageSquareText size={15} />
        <span>{t('Comments')}</span>
        {open.length > 0 && <span className="cp-count">{open.length}</span>}
        <ChevronDown size={14} className="cp-chev" aria-hidden />
      </button>

      {expanded && (
        <>
      {resolved.length > 0 && (
        <label className="cp-toggle">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          {t('Show {n} resolved', { n: resolved.length })}
        </label>
      )}

      <div className="cp-list" ref={listRef}>
        {visible.map((c) => {
          const name = c.authorName || t('unknown');
          return (
            <article key={c.id} className={'cp-item' + (c.resolvedAt ? ' is-resolved' : '')}>
              <div className="cp-item-head">
                {/* Echte Nutzerfarbe/-bild vom Server (JOIN in pageComments) —
                    the diced nameColor remains only as a fallback for
                    Kommentare geloeschter Konten. */}
                <span
                  className="cp-avatar"
                  style={{ background: c.authorAvatar ? 'transparent' : c.authorColor || nameColor(name) }}
                >
                  {c.authorAvatar ? <img src={c.authorAvatar} alt="" /> : initials(name)}
                </span>
                <span className="cp-author">{name}</span>
                <time className="cp-time">{when(c.createdAt)}</time>
              </div>
              <div className="cp-body">{c.body}</div>
              <div className="cp-actions">
                <button
                  className="cp-act"
                  title={c.resolvedAt ? t('Reopen') : t('Mark as resolved')}
                  onClick={() => void toggleResolve(c)}
                >
                  <Check size={13} /> {c.resolvedAt ? t('Reopen') : t('Resolved')}
                </button>
                {c.authorId === myUserId && (
                  <button className="cp-act danger" title={t('Delete')} onClick={() => void remove(c)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {/* No more "No comments yet": the input below says the same thing
            without being an empty message. */}
      </div>

      <form className="cp-compose" onSubmit={add}>
        <textarea
          value={body}
          rows={2}
          placeholder={t('Write a comment…')}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // ⌘/Ctrl+Enter sends — Enter itself makes a paragraph, because
            // comments are often more than one line.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add(e);
          }}
        />
        <button className="btn primary cp-send" type="submit" disabled={!body.trim()}>
          {t('Send')}
        </button>
      </form>
        </>
      )}
    </section>
  );
}
