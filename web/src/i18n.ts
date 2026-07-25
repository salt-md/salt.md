import { useEffect, useState } from 'react';
import { setFormatLocale } from './format';

// Translation. The English source text IS the key:
//
//     t('Manage users')
//     plural(n, '{n} page', '{n} pages')
//
// Symbolic keys ('users.manage') were the other option and were rejected: when
// a translation is missing, a symbolic key shows the user gibberish, while an
// English key shows them English. Salt.md is written in English first, so the
// fallback is always a correct sentence — a missing translation degrades to
// "not translated yet", never to "broken".
//
// The cost of this choice is that editing English source text orphans its
// translations. scripts/check-i18n.mjs reports those orphans instead of leaving
// them to rot, which is the trade we want: loud and mechanical beats silent.

export const LOCALES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
};

/** Plural categories as Intl names them. Which ones a language actually uses
 *  is the language's business: English has 2, German 2, Polish 3, Arabic 6. */
type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** A catalog maps English source text to its translation. Plural entries hold
 *  one string per category the target language needs. */
type Entry = string | Partial<Record<PluralCategory, string>>;
type Catalog = Record<string, Entry>;

// Every file under locales/ is picked up automatically, so adding a language
// means dropping in one JSON file — no code change, which is the point of the
// translation tool.
const files = import.meta.glob<{ default: Catalog }>('./locales/*.json');

let locale = 'en';
let catalog: Catalog = {};
const listeners = new Set<() => void>();

// ---- reading ----

/** Translate a source string. Unknown text falls through as-is, which is why
 *  the source must be English. */
export function t(source: string, vars?: Record<string, string | number>): string {
  const hit = catalog[source];
  const s = typeof hit === 'string' ? hit : source;
  return vars ? fill(s, vars) : s;
}

/** Translate a counted string. `other` doubles as the catalog key.
 *
 *      plural(n, '{n} page', '{n} pages')
 *
 *  Intl.PluralRules picks the category, so Polish gets its three forms and
 *  Japanese its one without any of that leaking into the call site. The
 *  hand-rolled `n === 1 ? '' : 'n'` this replaces was only ever right for
 *  English and German. */
export function plural(
  n: number,
  one: string,
  other: string,
  vars?: Record<string, string | number>,
): string {
  const hit = catalog[other];
  let s: string;
  if (hit && typeof hit === 'object') {
    const cat = new Intl.PluralRules(locale).select(n) as PluralCategory;
    s = hit[cat] ?? hit.other ?? other;
  } else if (typeof hit === 'string') {
    // A language with a single form (Japanese, Chinese) may store a plain
    // string — no categories to choose between.
    s = hit;
  } else {
    s = n === 1 ? one : other;
  }
  return fill(s, { n, ...vars });
}

/** Replace {name} placeholders. Unknown names are left standing so a typo in a
 *  catalog is visible rather than silently blank. */
function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function getLocale(): string {
  return locale;
}

// ---- switching ----

/** Pick a language: an explicit choice wins, then the browser's preference,
 *  then English. */
function preferred(): string {
  const saved = localStorage.getItem('salt-locale');
  if (saved && saved in LOCALES) return saved;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.split('-')[0];
    if (base in LOCALES) return base;
  }
  return 'en';
}

/** The tag to FORMAT with, which is not the same as the language to translate
 *  into.
 *
 *  Salt.md ships one catalog per language ('en', 'de'), because writing one per
 *  region would mean maintaining British and American copies of the same
 *  sentences. But dates and numbers really are regional: bare 'en' means
 *  American to Intl, so an English-reading user in Dublin or Sydney would get
 *  07/18/2026 instead of 18/07/2026, and an Austrian gets a different thousands
 *  separator from a German.
 *
 *  So: translate by language, format by whichever regional variant of that
 *  language the browser already asked for. Their operating system settled this
 *  question long ago and got it right. */
function formattingTag(lang: string): string {
  for (const tag of navigator.languages ?? [navigator.language]) {
    if (tag.split('-')[0] === lang) return tag;
  }
  return lang;
}

/** Load a language and tell everyone. English needs no catalog — its keys are
 *  already the text. */
export async function setLocale(next: string, remember = true): Promise<void> {
  if (!(next in LOCALES)) next = 'en';
  const path = `./locales/${next}.json`;
  let loaded: Catalog = {};
  if (next !== 'en' && files[path]) {
    try {
      loaded = (await files[path]()).default;
    } catch {
      // A broken or missing catalog must not take the app down; English is
      // always a working fallback.
      loaded = {};
    }
  }
  locale = next;
  catalog = loaded;
  if (remember) localStorage.setItem('salt-locale', next);
  setFormatLocale(formattingTag(next));
  applyDocumentLanguage(next);
  listeners.forEach((fn) => fn());
}

/** Tell the browser what it is rendering. Beyond screen readers this drives
 *  hyphenation, quotation marks and spell-check, and `dir` decides whether the
 *  page lays out right-to-left. */
function applyDocumentLanguage(next: string) {
  document.documentElement.lang = next;
  let dir = 'ltr';
  try {
    const loc = new Intl.Locale(next) as Intl.Locale & {
      getTextInfo?: () => { direction: string };
      textInfo?: { direction: string };
    };
    const info = typeof loc.getTextInfo === 'function' ? loc.getTextInfo() : loc.textInfo;
    if (info?.direction) dir = info.direction;
  } catch {
    /* older browser — left-to-right is right for every language we ship today */
  }
  document.documentElement.dir = dir;
}

/** Called once before the first render, so a German user never sees a flash of
 *  English while the catalog is still in flight. */
export function initLocale(): Promise<void> {
  return setLocale(preferred(), false);
}

// ---- React ----

/** Re-render this component when the language changes. Components that call
 *  t() need it; the same tiny store pattern as presence.ts, for the same
 *  reason — no provider has to sit in between. */
export function useLocale(): string {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return locale;
}
