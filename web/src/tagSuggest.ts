import type { PageMeta } from './types';

// Tag-Vorschläge. Ohne sie tippt man denselben Tag zum zehnten Mal leicht
// anders und der Workspace zerfasert in „projekt", „Projekte", „projekt-a".
// Der Server dedupliziert Tags nur INNERHALB einer Seite und nur nach
// Kleinschreibung — quer über den Workspace verhindert ihn nichts. Genau diese
// Lücke schließt die Vorschlagsliste.

/** Alle im Workspace vergebenen Tags mit ihrer Häufigkeit, häufigste zuerst. */
export function collectTags(pages: Iterable<PageMeta>): { tag: string; count: number }[] {
  // Nach Kleinschreibung gruppieren, aber die häufigste Schreibweise anzeigen —
  // sonst schlägt man „Projekt" vor, obwohl 12 Seiten „projekt" tragen.
  const byKey = new Map<string, Map<string, number>>();
  for (const p of pages) {
    if (p.trashed) continue;
    for (const t of p.tags ?? []) {
      const key = t.toLowerCase();
      const variants = byKey.get(key) ?? new Map<string, number>();
      variants.set(t, (variants.get(t) ?? 0) + 1);
      byKey.set(key, variants);
    }
  }
  const out: { tag: string; count: number }[] = [];
  for (const variants of byKey.values()) {
    let best = '';
    let bestN = 0;
    let total = 0;
    for (const [name, n] of variants) {
      total += n;
      if (n > bestN) {
        best = name;
        bestN = n;
      }
    }
    out.push({ tag: best, count: total });
  }
  return out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Levenshtein-Distanz, abgebrochen sobald sie `max` übersteigt. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1; // ganze Zeile schon zu weit weg
    prev = cur;
  }
  return prev[b.length];
}

export interface TagSuggestion {
  tag: string;
  count: number;
  /** true = kein Treffer im Text, sondern ein Tippfehler-Verdacht. */
  similar?: boolean;
}

/**
 * Vorschläge zu einer Eingabe, in der Reihenfolge: Präfix-Treffer, dann
 * Teilstring-Treffer, dann Ähnliches (Tippfehler). Ohne Eingabe kommen die
 * häufigsten Tags — so sieht man beim ersten Klick, was es überhaupt gibt.
 */
export function suggestTags(
  all: { tag: string; count: number }[],
  draft: string,
  already: string[],
  limit = 8,
): TagSuggestion[] {
  const used = new Set(already.map((t) => t.toLowerCase()));
  const pool = all.filter((t) => !used.has(t.tag.toLowerCase()));
  // Wie der Server normalisiert, damit „mein tag" auch „mein-tag" findet.
  const q = draft.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
  if (!q) return pool.slice(0, limit);

  const prefix: TagSuggestion[] = [];
  const infix: TagSuggestion[] = [];
  const similar: TagSuggestion[] = [];
  // Kurze Eingaben nicht „korrigieren" — bei 2 Zeichen ist alles ähnlich.
  const maxDist = q.length >= 5 ? 2 : q.length >= 3 ? 1 : 0;

  for (const t of pool) {
    const k = t.tag.toLowerCase();
    if (k === q) continue; // exakt getippt — dafür braucht es keinen Vorschlag
    if (k.startsWith(q)) prefix.push(t);
    else if (k.includes(q)) infix.push(t);
    else if (maxDist > 0 && editDistance(q, k, maxDist) <= maxDist)
      similar.push({ ...t, similar: true });
  }
  return [...prefix, ...infix, ...similar].slice(0, limit);
}
