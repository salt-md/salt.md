import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import type { Comment } from '../types';
import { Check, Trash2 } from 'lucide-react';

// Kommentare als Abschnitt am Ende des Dokuments — so wie Notion es macht.
//
// Zwei Fassungen davor waren falsch. Erst ein Dialog (drei Ebenen tief, legt
// sich über den Text). Dann eine angedockte Spalte, die Breite beanspruchte
// und bei einer Seite ohne Kommentare bloß „Noch keine Kommentare" anzeigte —
// ein leeres Fenster neben einem vollen Dokument. Beim genauen Hinsehen macht
// Notion gar keine Spalte: dort stehen die Kommentare unten im Fluss, direkt
// unter dem Inhalt. Genau dort gehören sie hin — immer sichtbar, ohne Schalter,
// und sie nehmen nur so viel Platz, wie sie brauchen.

function when(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  if (mins < 60 * 24) return `vor ${Math.round(mins / 60)} Std.`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Farbe aus dem Namen ableiten, damit dieselbe Person immer dieselbe bekommt.
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
}: {
  pageId: string;
  myUserId: string;
  onCountChange?: (n: number) => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

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
      // Der eigene Beitrag soll sichtbar sein, nicht unterhalb des Randes.
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 1e6, behavior: 'smooth' }));
    } catch (err) {
      setBody(text); // nichts verschlucken, wenn das Senden scheitert
      toast((err as Error).message || 'Kommentar fehlgeschlagen');
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

  return (
    <section className="comments-section" id="kommentare" aria-label="Kommentare">
      <h2 className="cp-title">
        Kommentare
        {open.length > 0 && <span className="cp-count">{open.length}</span>}
      </h2>

      {resolved.length > 0 && (
        <label className="cp-toggle">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
          />
          {resolved.length} erledigte anzeigen
        </label>
      )}

      <div className="cp-list" ref={listRef}>
        {visible.map((c) => {
          const name = c.authorName || 'unbekannt';
          return (
            <article key={c.id} className={'cp-item' + (c.resolvedAt ? ' is-resolved' : '')}>
              <div className="cp-item-head">
                {/* Echte Nutzerfarbe/-bild vom Server (JOIN in pageComments) —
                    die gewuerfelte nameColor bleibt nur als Rueckfall fuer
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
                  title={c.resolvedAt ? 'Wieder öffnen' : 'Als erledigt markieren'}
                  onClick={() => void toggleResolve(c)}
                >
                  <Check size={13} /> {c.resolvedAt ? 'Wieder öffnen' : 'Erledigt'}
                </button>
                {c.authorId === myUserId && (
                  <button className="cp-act danger" title="Löschen" onClick={() => void remove(c)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {/* Kein „Noch keine Kommentare" mehr: das Eingabefeld darunter sagt
            das Gleiche, ohne eine leere Meldung zu sein. */}
      </div>

      <form className="cp-compose" onSubmit={add}>
        <textarea
          value={body}
          rows={2}
          placeholder="Kommentar schreiben…"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // ⌘/Strg+Enter sendet — Enter selbst macht einen Absatz, weil
            // Kommentare oft mehrzeilig sind.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add(e);
          }}
        />
        <button className="btn primary cp-send" type="submit" disabled={!body.trim()}>
          Senden
        </button>
      </form>
    </section>
  );
}
