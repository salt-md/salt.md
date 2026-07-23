// Colours + id helper for database select / multi-select options (Welle 29).
// Notion-style named palette (stored as hex on each option so existing data and
// the chip renderer keep working unchanged).
export const OPTION_PALETTE: { name: string; hex: string }[] = [
  { name: 'Grau', hex: '#787774' },
  { name: 'Braun', hex: '#9f6b53' },
  { name: 'Orange', hex: '#d9730d' },
  { name: 'Gelb', hex: '#cb912f' },
  { name: 'Grün', hex: '#448361' },
  { name: 'Blau', hex: '#337ea9' },
  { name: 'Lila', hex: '#9065b0' },
  { name: 'Rosa', hex: '#c14c8a' },
  { name: 'Rot', hex: '#d44c47' },
];

export const OPTION_HEXES = OPTION_PALETTE.map((c) => c.hex);

let idc = 0;

// optionSlug derives a stable id from a name, suffixing to avoid collisions with
// existing options (e.g. "In Progress" vs "in-progress" both slug to the same).
export function optionSlug(name: string, existing: { id: string }[]): string {
  let oid =
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `o${++idc}`;
  while (existing.some((o) => o.id === oid)) oid += '_';
  return oid;
}
