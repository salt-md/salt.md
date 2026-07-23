import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { toast } from '../toast';
import type { PageMeta } from '../types';
import { PageIcon } from '../pageIcon';

type SortKey = 'title' | 'in' | 'out' | 'updated';
type Mode = 'liste' | 'baum';

// "All pages" index: every page (documents + databases, excluding database
// rows) — as a sortable link-count table OR as the plain indented tree the way
// an agent reads the structure (mirrors the MCP list_pages output), each node
// carrying a stable Markdown link. Read-only; touches nothing in the block /
// collab store.
export default function IndexView({
  pages,
  onNavigate,
  onClose,
}: {
  pages: PageMeta[];
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const [edges, setEdges] = useState<{ source: string; target: string }[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('title');
  const [mode, setMode] = useState<Mode>('liste');

  useEffect(() => {
    void api.graph().then((g) => setEdges(g.edges)).catch(() => {});
  }, []);

  const { outCount, inCount } = useMemo(() => {
    const out = new Map<string, number>();
    const inc = new Map<string, number>();
    for (const e of edges) {
      out.set(e.source, (out.get(e.source) ?? 0) + 1);
      inc.set(e.target, (inc.get(e.target) ?? 0) + 1);
    }
    return { outCount: out, inCount: inc };
  }, [edges]);

  const live = useMemo(() => pages.filter((p) => !p.trashed), [pages]);

  const rows = useMemo(() => {
    const q = query.toLowerCase();
    const list = live
      .filter((p) => (p.title || 'Untitled').toLowerCase().includes(q))
      .map((p) => ({
        page: p,
        out: outCount.get(p.id) ?? 0,
        in: inCount.get(p.id) ?? 0,
      }));
    list.sort((a, b) => {
      switch (sort) {
        case 'in':
          return b.in - a.in || a.page.title.localeCompare(b.page.title);
        case 'out':
          return b.out - a.out || a.page.title.localeCompare(b.page.title);
        case 'updated':
          return (b.page.updatedAt || '').localeCompare(a.page.updatedAt || '');
        default:
          return (a.page.title || 'Untitled').localeCompare(b.page.title || 'Untitled');
      }
    });
    return list;
  }, [live, query, sort, outCount, inCount]);

  const orphans = rows.filter((r) => r.in === 0 && r.out === 0).length;

  // Parent → children map for the tree view (same hierarchy the sidebar shows).
  const childrenMap = useMemo(() => {
    const ids = new Set(live.map((p) => p.id));
    const m = new Map<string, PageMeta[]>();
    for (const p of live) {
      const key = p.parentId && ids.has(p.parentId) ? p.parentId : '';
      m.set(key, [...(m.get(key) ?? []), p]);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.title || '').localeCompare(b.title || ''));
    }
    return m;
  }, [live]);

  const copyMd = (id: string) => {
    void navigator.clipboard?.writeText(window.location.origin + '/api/export/' + id);
    toast('Markdown-Link kopiert');
  };

  const q = query.toLowerCase();
  const treeRows: React.ReactNode[] = [];
  // Depth-first walk that mirrors the sidebar hierarchy. A node stays visible
  // if it or any descendant matches the filter; returns whether a match was
  // found in its subtree so parents can keep themselves on screen.
  const renderSubtree = (key: string, depth: number): boolean => {
    let anyMatch = false;
    for (const p of childrenMap.get(key) ?? []) {
      const before = treeRows.length;
      const descendantMatch = renderSubtree(p.id, depth + 1);
      const matches = (p.title || 'Untitled').toLowerCase().includes(q);
      if (query && !matches && !descendantMatch) {
        // Drop any descendant rows we tentatively rendered for a non-matching branch.
        treeRows.length = before;
        continue;
      }
      anyMatch = anyMatch || matches || descendantMatch;
      const isDb = p.type === 'collection';
      // Insert this node BEFORE its already-rendered descendants.
      treeRows.splice(before, 0,
        <div className="idx-node" style={{ paddingLeft: 6 + depth * 18 }} key={p.id}>
          <button className="idx-node-main" onClick={() => onNavigate(p.id)} title={p.id}>
            <span className="idx-node-icon"><PageIcon icon={p.icon} size={14} fallback={isDb ? '🗄' : '📄'} /></span>
            <span className={'idx-node-title' + (query && matches ? ' idx-hit' : '')}>{p.title || 'Untitled'}</span>
            {isDb && <span className="index-badge">DB</span>}
          </button>
          <code className="idx-node-id">{p.id.slice(0, 8)}</code>
          <button className="idx-md" title="Markdown-Link kopieren" onClick={() => copyMd(p.id)}>md</button>
        </div>,
      );
    }
    return anyMatch;
  };
  if (mode === 'baum') renderSubtree('', 0);

  return (
    <div className="index-view">
      <div className="index-head">
        <h1>📑 Index — alle Seiten</h1>
        <button className="btn-sm" onClick={onClose}>Schließen</button>
      </div>
      <div className="index-controls">
        <div className="index-modes">
          <button className={'index-mode' + (mode === 'liste' ? ' active' : '')} onClick={() => setMode('liste')}>Liste</button>
          <button className={'index-mode' + (mode === 'baum' ? ' active' : '')} onClick={() => setMode('baum')}>Baum · Agent-Sicht</button>
        </div>
        <input
          className="prop-input index-search"
          placeholder="Seiten filtern…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Seiten filtern"
        />
        {mode === 'liste' && (
          <select className="prop-select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sortieren">
            <option value="title">Name (A–Z)</option>
            <option value="in">Meiste Backlinks</option>
            <option value="out">Meiste ausgehende Links</option>
            <option value="updated">Zuletzt geändert</option>
          </select>
        )}
        <span className="index-stat">{rows.length} Seiten · {orphans} ohne Links</span>
      </div>

      {mode === 'liste' ? (
        <div className="table-wrap">
          <table className="db-table index-table">
            <thead>
              <tr>
                <th>Seite</th>
                <th title="Ausgehende @-Links">→ Links</th>
                <th title="Eingehende Links (Backlinks)">← Backlinks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ page, out, in: inc }) => (
                <tr key={page.id}>
                  <td>
                    <button className="db-title-link" onClick={() => onNavigate(page.id)}>
                      {page.icon && <span className="inline-icon"><PageIcon icon={page.icon} size={14} /> </span>}
                      {page.title || 'Untitled'}
                      {page.type === 'collection' && <span className="index-badge">DB</span>}
                    </button>
                  </td>
                  <td>{out || ''}</td>
                  <td>{inc || ''}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="db-empty">Keine Seiten.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="idx-tree-wrap">
          <p className="dialog-hint idx-tree-hint">
            So liest ein Agent die Struktur deines Workspace (wie <code>list_pages</code> über MCP). Jede
            Zeile hat einen stabilen Markdown-Link (<code>md</code> kopieren) — alles bleibt durchsuchbares
            Markdown, egal wo es liegt.
          </p>
          <div className="idx-tree">
            {treeRows.length ? treeRows : <div className="db-empty">Keine Seiten.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
