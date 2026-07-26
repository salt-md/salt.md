import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CollectionConfig, PropDef, PropType, ViewDef } from '../types';
import Portal from './Portal';
import { useExclusiveModal } from '../modal';
import { OPTION_HEXES, optionPalette } from '../selectOptions';
import { Check } from 'lucide-react';
import { t } from '../i18n';

const TYPES: { value: PropType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multiselect', label: 'Multi-select' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
  // The server has long known url (validPropTypes) and MCP advertises it —
  // only the interface never offered it and quietly treated it as text.
  { value: 'url', label: 'URL' },
  { value: 'person', label: 'Person' },
  { value: 'relation', label: 'Relation' },
  { value: 'rollup', label: 'Rollup' },
  { value: 'formula', label: 'Formula' },
];

const AGGS: { value: NonNullable<PropDef['rollupAgg']>; label: string }[] = [
  { value: 'sum', label: 'Sum' },
  { value: 'count', label: 'Count' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];

const OPTION_COLORS = OPTION_HEXES;

// Fallback colour for options that have none: before W89 the import handed
// out no colour, and a chip with `background: undefined + '2e'` is invisible —
// which is exactly what made the schema editor look broken. Derived from the
// name, so the same option always gets the same shade.
function autoOptionColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return OPTION_HEXES[h % OPTION_HEXES.length];
}

let idCounter = 0;
const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `p${++idCounter}`;

export default function SchemaEditor({
  config,
  collections,
  onSave,
  onClose,
}: {
  config: CollectionConfig;
  collections?: { id: string; title: string }[];
  onSave: (c: CollectionConfig) => Promise<void>;
  onClose: () => void;
}) {
  const [schema, setSchema] = useState<PropDef[]>(config.schema);
  const [views, setViews] = useState<ViewDef[]>(config.views);
  useExclusiveModal(onClose);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<PropType>('select');
  // Welcher Options-Chip gerade seinen Farbwaehler offen hat ("propId:optId").
  const [colorPick, setColorPick] = useState<string | null>(null);

  const setOptionColor = (propId: string, optId: string, hex: string) =>
    setSchema((prev) =>
      prev.map((p) =>
        p.id === propId
          ? { ...p, options: (p.options ?? []).map((o) => (o.id === optId ? { ...o, color: hex } : o)) }
          : p,
      ),
    );

  // Schemas of collections referenced by relation props, so rollup config can
  // list the target's properties. Fetched lazily and cached by collection id.
  const [targetSchemas, setTargetSchemas] = useState<Record<string, PropDef[]>>({});
  const targets = collections ?? [];

  useEffect(() => {
    const wanted = new Set(
      schema.filter((p) => p.type === 'relation' && p.relationCollection).map((p) => p.relationCollection!),
    );
    for (const cid of wanted) {
      if (targetSchemas[cid]) continue;
      void api
        .getCollection(cid)
        .then((c) => setTargetSchemas((prev) => ({ ...prev, [cid]: c.schema })))
        .catch(() => {});
    }
  }, [schema, targetSchemas]);

  const addProp = () => {
    const name = newName.trim() || 'Property';
    let id = slug(name);
    while (schema.some((p) => p.id === id)) id += '_';
    const def: PropDef = { id, name, type: newType };
    if (newType === 'select' || newType === 'multiselect') def.options = [];
    if (newType === 'rollup') def.rollupAgg = 'sum';
    setSchema([...schema, def]);
    setNewName('');
  };

  const updateProp = (id: string, patch: Partial<PropDef>) =>
    setSchema((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  // Changing a property's type (Q23) is non-destructive: existing row values
  // stay in pages.props and are coerced at render — a text→number switch keeps
  // the raw string, which simply shows blank in a number cell rather than
  // deleting anyone's data. We only adjust the schema-side config here.
  const changeType = (id: string, type: PropType) => {
    setSchema((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next: PropDef = { ...p, type };
        if (type === 'select' || type === 'multiselect') next.options = p.options ?? [];
        if (type === 'rollup' && !next.rollupAgg) next.rollupAgg = 'sum';
        return next;
      }),
    );
  };

  const addOption = (propId: string, name: string) => {
    if (!name.trim()) return;
    setSchema((prev) =>
      prev.map((p) => {
        if (p.id !== propId) return p;
        const options = p.options ?? [];
        // Distinct names can slug to the same id ("In Progress" vs
        // "in-progress"); suffix collisions so no option is silently dropped.
        let oid = slug(name);
        while (options.some((o) => o.id === oid)) oid += '_';
        return {
          ...p,
          options: [
            ...options,
            { id: oid, name: name.trim(), color: OPTION_COLORS[options.length % OPTION_COLORS.length] },
          ],
        };
      }),
    );
  };

  const removeProp = (id: string) => setSchema((prev) => prev.filter((p) => p.id !== id));

  const save = async () => {
    // Every option WITHOUT a colour gets the fallback written in on save.
    // Otherwise the editor shows a colour (the fallback) while the board shows
    // grey — because only the stored colour counts there. After saving the two
    // agree, and export and MCP see real colours too.
    const colored = schema.map((p) =>
      p.type === 'select' || p.type === 'multiselect'
        ? { ...p, options: (p.options ?? []).map((o) => (o.color ? o : { ...o, color: autoOptionColor(o.name) })) }
        : p,
    );

    // Keep board views pointing at a valid select property, and drop any
    // filters/sort that reference a property the user just deleted.
    const propIds = new Set(colored.map((p) => p.id));
    const selectProps = colored.filter((p) => p.type === 'select' || p.type === 'multiselect');
    const dateProps = colored.filter((p) => p.type === 'date');
    const fixedViews = views.map((v) => {
      const next = { ...v };
      if (v.type === 'board' && !propIds.has(v.groupBy ?? '')) {
        next.groupBy = selectProps[0]?.id ?? '';
      }
      if (v.type === 'calendar' && !propIds.has(v.dateProp ?? '')) {
        next.dateProp = dateProps[0]?.id ?? '';
      }
      if (v.filters) next.filters = v.filters.filter((f) => propIds.has(f.property));
      if (v.sort && !propIds.has(v.sort.property)) next.sort = null;
      if (v.hidden) next.hidden = v.hidden.filter((id) => propIds.has(id));
      return next;
    });
    await onSave({ schema: colored, views: fixedViews });
    onClose();
  };

  const toggleBoardView = () => {
    if (views.some((v) => v.type === 'board')) {
      setViews(views.filter((v) => v.type !== 'board'));
    } else {
      const groupBy = schema.find((p) => p.type === 'select')?.id ?? '';
      setViews([{ id: 'board', name: 'Board', type: 'board', groupBy }, ...views]);
    }
  };

  const toggleGalleryView = () => {
    if (views.some((v) => v.type === 'gallery')) {
      setViews(views.filter((v) => v.type !== 'gallery'));
    } else {
      setViews([...views, { id: 'gallery', name: 'Gallery', type: 'gallery' }]);
    }
  };

  const toggleCalendarView = () => {
    if (views.some((v) => v.type === 'calendar')) {
      setViews(views.filter((v) => v.type !== 'calendar'));
    } else {
      const dateProp = schema.find((p) => p.type === 'date')?.id ?? '';
      setViews([...views, { id: 'calendar', name: 'Calendar', type: 'calendar', dateProp }]);
    }
  };

  const relationProps = schema.filter((p) => p.type === 'relation');

  // Config UI shown under a property row for the computed/linked types.
  const numberDisplayFields = (p: PropDef) => (
    <>
      <label>{t('Display')}</label>
      <select
        className="prop-select"
        value={p.numberDisplay ?? 'plain'}
        onChange={(e) => updateProp(p.id, { numberDisplay: e.target.value as PropDef['numberDisplay'] })}
      >
        <option value="plain">{t('Number')}</option>
        <option value="bar">{t('Progress bar')}</option>
        <option value="ring">{t('Ring')}</option>
      </select>
      {(p.numberDisplay === 'bar' || p.numberDisplay === 'ring') && (
        <>
          <label>Max (= 100%)</label>
          <input
            className="prop-input"
            type="number"
            value={p.numberMax ?? 100}
            onChange={(e) =>
              updateProp(p.id, { numberMax: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          />
        </>
      )}
    </>
  );

  const renderConfig = (p: PropDef) => {
    if (p.type === 'number') {
      return <div className="schema-config">{numberDisplayFields(p)}</div>;
    }
    if (p.type === 'relation') {
      return (
        <div className="schema-config">
          <label>{t('Links to')}</label>
          <select
            className="prop-select"
            value={p.relationCollection ?? ''}
            onChange={(e) => updateProp(p.id, { relationCollection: e.target.value })}
          >
            <option value="">{t('Select a database…')}</option>
            {targets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || 'Untitled'}
              </option>
            ))}
          </select>
        </div>
      );
    }
    if (p.type === 'rollup') {
      const rel = relationProps.find((r) => r.id === p.rollupRelation);
      const targetSchema = rel?.relationCollection ? targetSchemas[rel.relationCollection] ?? [] : [];
      return (
        <div className="schema-config">
          <label>{t('Via relation')}</label>
          <select
            className="prop-select"
            value={p.rollupRelation ?? ''}
            onChange={(e) => updateProp(p.id, { rollupRelation: e.target.value, rollupTarget: '' })}
          >
            <option value="">{t('Select a relation…')}</option>
            {relationProps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <label>{t('Of property')}</label>
          <select
            className="prop-select"
            value={p.rollupTarget ?? ''}
            onChange={(e) => updateProp(p.id, { rollupTarget: e.target.value })}
            disabled={!rel}
          >
            <option value="">{rel ? 'Select…' : '(pick relation first)'}</option>
            {targetSchema
              .filter((t) => t.type !== 'rollup' && t.type !== 'formula' && t.type !== 'relation')
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <label>{t('Calculate')}</label>
          <select
            className="prop-select"
            value={p.rollupAgg ?? 'sum'}
            onChange={(e) => updateProp(p.id, { rollupAgg: e.target.value as PropDef['rollupAgg'] })}
          >
            {AGGS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          {numberDisplayFields(p)}
        </div>
      );
    }
    if (p.type === 'formula') {
      return (
        <div className="schema-config formula-config">
          <label>{t('Expression')}</label>
          <input
            className="prop-input formula-input"
            placeholder={t('e.g. {price} * {qty} - {discount}')}
            value={p.formula ?? ''}
            onChange={(e) => updateProp(p.id, { formula: e.target.value })}
          />
          <div className="formula-hint">
            Reference other properties with <code>{'{id}'}</code>. Available:{' '}
            {schema
              .filter((o) => o.id !== p.id)
              .map((o) => (
                <code key={o.id} className="formula-token" title={o.name}>
                  {'{' + o.id + '}'}
                </code>
              ))}
            . Supports <code>+ - * / ( )</code>.
          </div>
          {numberDisplayFields(p)}
        </div>
      );
    }
    return null;
  };

  return (
    <Portal>
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog wide">
        <h2>{t('Database properties')}</h2>
        <div className="schema-list">
          {schema.map((p) => (
            <div key={p.id} className="schema-item">
              <div className="schema-row">
                <input
                  className="prop-input"
                  value={p.name}
                  onChange={(e) => updateProp(p.id, { name: e.target.value })}
                />
                <select
                  className="prop-select schema-type-select"
                  value={p.type}
                  onChange={(e) => changeType(p.id, e.target.value as PropType)}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <button className="icon-btn danger" title={t('Delete property')} onClick={() => removeProp(p.id)}>
                  ✕
                </button>
              </div>
              {(p.type === 'select' || p.type === 'multiselect') && (
                <div className="schema-options">
                    {(p.options ?? []).map((o) => {
                      const hex = o.color || autoOptionColor(o.name);
                      const key = `${p.id}:${o.id}`;
                      return (
                        <span key={o.id} className="opt-chip-wrap">
                          {/* The chip is a button now: a click opens the
                              Farbauswahl — so bestimmt man die Spaltenfarben des
                              Boards direkt hier. */}
                          <button
                            type="button"
                            className="prop-chip opt-chip"
                            style={{ background: hex + '2e', color: hex }}
                            title={t('Change colour')}
                            onClick={() => setColorPick(colorPick === key ? null : key)}
                          >
                            {o.name}
                          </button>
                          {colorPick === key && (
                            <>
                              <div className="opt-color-backdrop" onClick={() => setColorPick(null)} />
                              <div className="opt-color-pop">
                                {optionPalette().map((c) => (
                                  <button
                                    key={c.hex}
                                    type="button"
                                    className="tag-color-opt"
                                    onClick={() => {
                                      setOptionColor(p.id, o.id, c.hex);
                                      setColorPick(null);
                                    }}
                                  >
                                    <span className="tag-swatch" style={{ background: c.hex }} />
                                    <span className="tag-color-name">{c.name}</span>
                                    {hex === c.hex && <Check size={14} />}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </span>
                      );
                    })}
                  <input
                    className="opt-input"
                    placeholder={t('+ Option')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        addOption(p.id, (e.target as HTMLInputElement).value);
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                  />
                </div>
              )}
              {renderConfig(p)}
            </div>
          ))}
        </div>
        <div className="schema-add">
          <input
            className="prop-input"
            placeholder={t('New property name')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addProp()}
          />
          <select
            className="prop-select"
            value={newType}
            onChange={(e) => setNewType(e.target.value as PropType)}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <button className="btn" onClick={addProp}>Add</button>
        </div>
        <label className="check-label board-toggle">
          <input
            type="checkbox"
            checked={views.some((v) => v.type === 'board')}
            onChange={toggleBoardView}
          />
          {t('Show Kanban board view')}
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={views.some((v) => v.type === 'gallery')}
            onChange={toggleGalleryView}
          />
          {t('Show Gallery view')}
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={views.some((v) => v.type === 'calendar')}
            onChange={toggleCalendarView}
            disabled={!schema.some((p) => p.type === 'date') && !views.some((v) => v.type === 'calendar')}
          />
          Show Calendar view {!schema.some((p) => p.type === 'date') && <span className="prop-empty">(needs a Date property)</span>}
        </label>
        <div className="dialog-buttons">
          <button className="btn" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary" onClick={save}>{t('Save')}</button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
