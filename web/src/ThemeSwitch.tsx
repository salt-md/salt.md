import { Sun, Moon, Monitor } from 'lucide-react';

// „Hell / Automatisch / Dunkel" als Dreier-Wahl statt eines Umschalters.
//
// Der frühere Knopf kannte nur zwei Zustände: Beim ersten Start wurde die
// Systemeinstellung übernommen und sofort festgeschrieben — wer danach sein
// System umstellte, blieb auf dem alten Design sitzen und hatte keine
// Möglichkeit mehr, „richte dich nach dem System" zurückzubekommen. Genau das
// ist die dritte Option.
export type ThemePref = 'light' | 'dark' | 'auto';

const OPTIONS: { value: ThemePref; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Hell' },
  { value: 'auto', icon: Monitor, label: 'Automatisch — folgt dem System' },
  { value: 'dark', icon: Moon, label: 'Dunkel' },
];

export default function ThemeSwitch({
  value,
  onChange,
  size = 15,
}: {
  value: ThemePref;
  onChange: (v: ThemePref) => void;
  size?: number;
}) {
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Design">
      {OPTIONS.map(({ value: v, icon: Icon, label }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          aria-label={label}
          title={label}
          className={'theme-switch-opt' + (value === v ? ' on' : '')}
          onClick={() => onChange(v)}
        >
          <Icon size={size} />
        </button>
      ))}
    </div>
  );
}
