import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Comment, Revision } from '../types';
import Portal from './Portal';
import { confirm } from '../dialog';
import { useExclusiveModal } from '../modal';
import { toast } from '../toast';

function when(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function HistoryModal({
  pageId,
  onClose,
  onRestored,
}: {
  pageId: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  useExclusiveModal(onClose);
  const load = () => void api.listRevisions(pageId).then(setRevisions).catch(() => {});
  useEffect(load, [pageId]);

  const restore = async (rev: Revision) => {
    if (!(await confirm(`Diese Version vom ${when(rev.createdAt)} wiederherstellen? Der aktuelle Stand wird als Version gesichert.`))) return;
    try {
      await api.restoreRevision(pageId, rev.id);
      toast('Version wiederhergestellt');
      onRestored();
      onClose();
    } catch (e) {
      toast((e as Error).message || 'Wiederherstellen fehlgeschlagen');
    }
  };

  return (
    <Portal>
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Versionsverlauf">
        <h2>Versionsverlauf</h2>
        <p className="dialog-hint">Snapshots werden beim Speichern angelegt (max. alle 2 Min., neueste 50).</p>
        <div className="user-list">
          {revisions.map((r) => (
            <div key={r.id} className="user-row">
              <span className="user-row-name">🕘 {when(r.createdAt)}</span>
              <span className="user-row-email">{r.authorName || 'unbekannt'}</span>
              <button className="btn-sm" onClick={() => void restore(r)}>Wiederherstellen</button>
            </div>
          ))}
          {revisions.length === 0 && <div className="dialog-hint">Noch keine Versionen.</div>}
        </div>
        <button className="btn dialog-close" onClick={onClose}>Schließen</button>
      </div>
    </div>
    </Portal>
  );
}

export function CommentsModal({
  pageId,
  myUserId,
  onClose,
}: {
  pageId: string;
  myUserId: string;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  useExclusiveModal(onClose);
  const load = () => void api.listComments(pageId).then(setComments).catch(() => {});
  useEffect(load, [pageId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      await api.createComment(pageId, body.trim());
      setBody('');
      load();
    } catch (err) {
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

  const visible = comments.filter((c) => showResolved || !c.resolvedAt);

  return (
    <Portal>
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Kommentare">
        <h2>Kommentare</h2>
        <label className="check-label">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Erledigte anzeigen
        </label>
        <div className="comment-list">
          {visible.map((c) => (
            <div key={c.id} className={'comment' + (c.resolvedAt ? ' resolved' : '')}>
              <div className="comment-head">
                <strong>{c.authorName || 'unbekannt'}</strong>
                <span className="comment-time">{when(c.createdAt)}</span>
              </div>
              <div className="comment-body">{c.body}</div>
              <div className="comment-actions">
                <button className="btn-sm" onClick={() => void toggleResolve(c)}>
                  {c.resolvedAt ? 'Wieder öffnen' : '✓ Erledigt'}
                </button>
                {c.authorId === myUserId && (
                  <button className="btn-sm danger" onClick={() => void remove(c)}>Löschen</button>
                )}
              </div>
            </div>
          ))}
          {visible.length === 0 && <div className="dialog-hint">Noch keine Kommentare.</div>}
        </div>
        <form className="user-add" onSubmit={add}>
          <input value={body} placeholder="Kommentar schreiben…" onChange={(e) => setBody(e.target.value)} />
          <button className="btn primary" type="submit">Senden</button>
        </form>
        <button className="btn dialog-close" onClick={onClose}>Schließen</button>
      </div>
    </div>
    </Portal>
  );
}
