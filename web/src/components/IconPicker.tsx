import { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, Upload as UploadIcon } from 'lucide-react';
import { EMOJI_GROUPS } from '../emojiData';
import { LUCIDE_SET, LUCIDE_NAMES } from '../lucideSet';
import { api } from '../api';
import { toast } from '../toast';
import { makeLucide, makeMdi } from '../pageIcon';
import { mdiNames, mdiPath, useMdi } from '../mdiLoader';

// Notion-style icon colours; '' = default (adapts to light/dark theme).
const ICON_COLORS = [
  { name: 'Standard', hex: '' },
  { name: 'Grau', hex: '#787774' },
  { name: 'Rot', hex: '#e03131' },
  { name: 'Orange', hex: '#e8590c' },
  { name: 'Gelb', hex: '#f2b100' },
  { name: 'Grün', hex: '#2f9e44' },
  { name: 'Türkis', hex: '#0c8599' },
  { name: 'Blau', hex: '#1971c2' },
  { name: 'Lila', hex: '#7048e8' },
  { name: 'Pink', hex: '#c2255c' },
];

interface Props {
  onPick: (icon: string) => void;
  onRemove: () => void;
  onClose: () => void;
  pageId?: string;
}

export default function IconPicker({ onPick, onRemove, onClose, pageId }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'emoji' | 'icon' | 'upload'>('emoji');
  const [q, setQ] = useState('');
  const [color, setColor] = useState('');
  // Two icon libraries: Lucide (outline, bundled) and the full Material Design
  // Icons set (~7.4k, lazily fetched the first time this tab is used).
  const [lib, setLib] = useState<'lucide' | 'mdi'>('lucide');
  const mdiReady = useMdi(tab === 'icon' && lib === 'mdi');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest?.('.icon-trigger')) return; // its own onClick toggles us
      if (ref.current && !ref.current.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const emojiResults = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return EMOJI_GROUPS;
    return EMOJI_GROUPS.map((g) => ({ cat: g.cat, items: g.items.filter(([, n]) => n.includes(query)) })).filter(
      (g) => g.items.length,
    );
  }, [q]);

  const iconResults = useMemo(() => {
    const query = q.trim().toLowerCase().replace(/[-\s]/g, '');
    const all = lib === 'mdi' ? (mdiReady ? mdiNames() : []) : LUCIDE_NAMES;
    if (!query) return lib === 'mdi' ? all.slice(0, 600) : all;
    const hits = all.filter((n) => n.toLowerCase().includes(query));
    // MDI is huge — cap the rendered grid so typing stays responsive.
    return lib === 'mdi' ? hits.slice(0, 600) : hits;
  }, [q, lib, mdiReady]);

  const doUpload = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await api.upload(file, pageId);
      onPick(url);
    } catch {
      toast('Upload fehlgeschlagen');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="icon-picker" ref={ref}>
      <div className="icon-picker-tabs">
        <button type="button" className={tab === 'emoji' ? 'on' : ''} onClick={() => { setTab('emoji'); setQ(''); }}>
          Emoji
        </button>
        <button type="button" className={tab === 'icon' ? 'on' : ''} onClick={() => { setTab('icon'); setQ(''); }}>
          Icons
        </button>
        <button type="button" className={tab === 'upload' ? 'on' : ''} onClick={() => { setTab('upload'); setQ(''); }}>
          Upload
        </button>
        <button type="button" className="icon-picker-remove" onClick={onRemove} title="Icon entfernen">
          <Trash2 size={15} />
        </button>
      </div>

      {tab !== 'upload' && (
        <input
          className="icon-search"
          autoFocus
          placeholder={tab === 'emoji' ? 'Emoji suchen…' : 'Icon suchen…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}

      {tab === 'icon' && (
        <div className="icon-controls">
          <div className="icon-colors">
            {ICON_COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                className={'icon-color' + (color === c.hex ? ' on' : '')}
                title={c.name}
                onClick={() => setColor(c.hex)}
              >
                <span className="icon-color-dot" style={{ background: c.hex || 'var(--fg)' }} />
              </button>
            ))}
          </div>
          <div className="icon-style-toggle">
            <button type="button" className={lib === 'lucide' ? 'on' : ''} onClick={() => setLib('lucide')}>
              Lucide
            </button>
            <button type="button" className={lib === 'mdi' ? 'on' : ''} onClick={() => setLib('mdi')}>
              Material
            </button>
          </div>
        </div>
      )}

      <div className="icon-picker-body">
        {tab === 'emoji' &&
          emojiResults.map((g) => (
            <div key={g.cat} className="icon-cat">
              <div className="icon-cat-label">{g.cat}</div>
              <div className="icon-grid emoji-grid">
                {g.items.map(([e, n]) => (
                  <button key={e} type="button" title={n} onClick={() => onPick(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        {tab === 'emoji' && emojiResults.length === 0 && <div className="icon-empty">Keine Treffer</div>}

        {tab === 'icon' && (
          <div className="icon-grid lucide-grid">
            {iconResults.map((name) => {
              const c = color || 'currentColor';
              if (lib === 'mdi') {
                const d = mdiPath(name);
                if (!d) return null;
                return (
                  <button
                    key={name}
                    type="button"
                    title={name}
                    onClick={() => onPick(makeMdi(name, color || undefined))}
                  >
                    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true">
                      <path d={d} fill={c} />
                    </svg>
                  </button>
                );
              }
              const Cmp = LUCIDE_SET[name];
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => onPick(makeLucide(name, color || undefined))}
                >
                  <Cmp size={20} color={c} fill="none" strokeWidth={2} />
                </button>
              );
            })}
          </div>
        )}
        {tab === 'icon' && lib === 'mdi' && !mdiReady && (
          <div className="icon-empty">Material-Icons werden geladen…</div>
        )}
        {tab === 'icon' && (lib !== 'mdi' || mdiReady) && iconResults.length === 0 && (
          <div className="icon-empty">Keine Treffer</div>
        )}

        {tab === 'upload' && (
          <div className="icon-upload">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => doUpload(e.target.files?.[0])}
            />
            <button type="button" className="icon-upload-btn" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <UploadIcon size={16} /> {uploading ? 'Lädt…' : 'Bild hochladen'}
            </button>
            <p className="icon-upload-hint">PNG, JPG, GIF oder SVG — wird quadratisch als Icon angezeigt.</p>
          </div>
        )}
      </div>
    </div>
  );
}
