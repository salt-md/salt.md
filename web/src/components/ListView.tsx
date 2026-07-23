import type { PropDef, PropOption } from '../types';
import PropertyValue from './PropertyValue';
import { tagColorClass } from '../tags';
import { PageIcon } from '../pageIcon';

interface Row {
  id: string;
  title: string;
  icon: string;
  props: Record<string, unknown>;
  tags?: string[];
}

// Eine Listen-Ansicht ist bewusst KEINE schmale Tabelle: kein Spaltenraster,
// keine Kopfzeile, kein horizontales Scrollen. Der Titel führt, die Eigen-
// schaften stehen dezent dahinter. Das ist die ruhige Ansicht für Notizen —
// wer Werte vergleichen oder in Spalten lesen will, nimmt die Tabelle.
export default function ListView({
  rows,
  schema,
  emptyLabel,
  tagColors,
  onNavigate,
  onSetProp,
  onSetOptions,
}: {
  rows: Row[];
  schema: PropDef[];
  emptyLabel: string;
  tagColors: Record<string, string>;
  onNavigate: (id: string) => void;
  onSetProp: (rowId: string, propId: string, value: unknown) => void;
  onSetOptions: (propId: string, options: PropOption[]) => void;
}) {
  if (rows.length === 0) {
    return <div className="db-empty">{emptyLabel}</div>;
  }
  // Eine Liste lebt von Ruhe: nur die ersten Eigenschaften begleiten den Titel,
  // sonst wird die Zeile doch wieder zur Tabelle.
  const inline = schema.slice(0, 3);

  return (
    <div className="list-view">
      {rows.map((r) => (
        <div key={r.id} className="list-row" onClick={() => onNavigate(r.id)}>
          <span className="list-row-icon">
            <PageIcon icon={r.icon} size={17} fallback="📄" />
          </span>
          <span className="list-row-title">{r.title || 'Untitled'}</span>
          {r.tags && r.tags.length > 0 && (
            <span className="list-row-tags">
              {r.tags.map((t) => (
                <span key={t} className={'tag-chip ' + tagColorClass(t, tagColors)}>
                  #{t}
                </span>
              ))}
            </span>
          )}
          {inline.length > 0 && (
            // Die Zellen bleiben bearbeitbar (Select-Popover wie überall) — der
            // Klick darf deshalb nicht bis zur Zeile durchschlagen.
            <span className="list-row-props" onClick={(e) => e.stopPropagation()}>
              {inline.map((p) => (
                <PropertyValue
                  key={p.id}
                  def={p}
                  value={r.props?.[p.id]}
                  compact
                  onChange={(v) => onSetProp(r.id, p.id, v)}
                  onOptionsChange={(opts) => onSetOptions(p.id, opts)}
                />
              ))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
