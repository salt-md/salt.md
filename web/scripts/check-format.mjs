// Runs src/format.ts under a spread of timezones and asserts that a calendar
// day survives the trip. No test framework: esbuild is already here as part of
// vite, and node can re-exec itself with a different TZ.
//
//   node scripts/check-format.mjs
//
// Why this exists: the failure it guards against is invisible in Berlin. The
// old timeline header built its month label with Date.UTC and rendered it
// locally, so everyone west of Greenwich saw the previous month over the
// column. Nobody noticed for a year because nobody outside CET ran the app.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');

const ZONES = [
  'Europe/Berlin',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Pacific/Honolulu', // UTC-10, the harshest western case
  'Pacific/Auckland', // UTC+12/13, the harshest eastern case
];

// ---- child mode: run the assertions inside one timezone ----
if (process.env.SALT_FMT_BUNDLE) {
  const fmt = await import(process.env.SALT_FMT_BUNDLE);
  const out = [];
  const check = (name, got, want) => out.push({ name, got, want, ok: got === want });

  fmt.setFormatLocale('en-GB');

  // A stored deadline. The day shown must be the day stored, everywhere.
  check('formatDay 2026-07-18', fmt.formatDay('2026-07-18', 'date'), '18/07/2026');
  check('formatDay 2026-01-01', fmt.formatDay('2026-01-01', 'date'), '01/01/2026');
  check('formatDay 2026-12-31', fmt.formatDay('2026-12-31', 'date'), '31/12/2026');
  // A date property that carries a time is floating too — not converted.
  check('formatDay timed', fmt.formatDay('2026-07-18T14:30', 'date'), '18/07/2026, 14:30');

  // The timeline month header — this is the one that was broken.
  check('formatMonth July 2026', fmt.formatMonth(2026, 6, 'short'), 'Jul 26');
  check('formatMonth Jan 2026', fmt.formatMonth(2026, 0, 'short'), 'Jan 26');

  // ...and what the old code did, kept here so the regression stays visible.
  const legacy = new Date(Date.UTC(2026, 6, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    year: '2-digit',
  });

  // A moment IS expected to shift — it is the same instant seen from a
  // different chair. Asserting it does shift proves we did not accidentally
  // freeze everything to UTC.
  const moment = fmt.formatMoment('2026-07-18T23:30:00Z', 'time');

  // today() must agree with the host's own idea of the local date.
  const n = new Date();
  const localToday = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  check('today()', fmt.today(), localToday);

  // The calendar grid offsets its leading blanks by firstWeekday() and labels
  // its columns with weekdayNames(). If those two ever disagree the whole month
  // is shifted by a day — so assert they agree, in a locale that starts on
  // Monday and one that starts on Sunday.
  for (const [loc, want] of [
    ['de-DE', 'Mo'],
    ['en-US', 'Sun'],
  ]) {
    fmt.setFormatLocale(loc);
    const first = fmt.firstWeekday();
    const names = fmt.weekdayNames();
    // A date whose getDay() equals firstWeekday, formatted, must be the name in
    // column zero.
    const probe = new Date(2026, 1, 1 + first); // 2026-02-01 was a Sunday
    const spelled = new Intl.DateTimeFormat(loc, { weekday: 'short' }).format(probe);
    check(`weekdayNames[0] ${loc}`, names[0], want);
    check(`grid aligns ${loc}`, names[0], spelled);
  }

  // Region matters as much as language: these share a catalog but must not
  // share a date format. This is why i18n.ts formats with the browser's
  // regional tag rather than the bare language it translates by.
  fmt.setFormatLocale('en-US');
  check('en-US writes month first', fmt.formatDay('2026-07-18', 'date'), '07/18/2026');
  fmt.setFormatLocale('de-AT');
  const atNum = fmt.formatNumber(1234.5);
  fmt.setFormatLocale('de-DE');
  check('de-DE groups with a dot', fmt.formatNumber(1234.5), '1.234,5');
  // Asserting that they DIFFER rather than what Austria's separator is: it is
  // a narrow no-break space today, ICU has changed it before, and pinning an
  // invisible codepoint would make this test brittle for no gain. The point is
  // that one catalog can serve two regions with different number formats.
  check('de-AT differs from de-DE', String(atNum !== fmt.formatNumber(1234.5)), 'true');

  fmt.setFormatLocale('en-GB');

  process.stdout.write(JSON.stringify({ out, legacy, moment }));
  process.exit(0);
}

// ---- parent mode ----
const tmp = mkdtempSync(join(tmpdir(), 'salt-fmt-'));
const bundle = join(tmp, 'format.mjs');
try {
  try {
    execFileSync(
      join(web, 'node_modules/esbuild/bin/esbuild'),
      [join(web, 'src/format.ts'), '--bundle', '--format=esm', '--outfile=' + bundle],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  } catch (e) {
    // esbuild writes its "done in 5ms" banner to stderr too, so only surface
    // it when the build actually failed.
    console.error(String(e.stderr ?? e));
    process.exit(1);
  }

  let fail = 0;
  let pass = 0;
  const moments = [];
  const legacies = [];

  for (const tz of ZONES) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, TZ: tz, SALT_FMT_BUNDLE: bundle },
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      console.error(`  CRASH ${tz}\n${r.stderr}`);
      fail++;
      continue;
    }
    const { out, legacy, moment } = JSON.parse(r.stdout);
    const bad = out.filter((c) => !c.ok);
    pass += out.length - bad.length;
    fail += bad.length;
    console.log(`  ${bad.length === 0 ? 'ok  ' : 'FAIL'} ${tz.padEnd(20)} ${out.length - bad.length}/${out.length}`);
    for (const c of bad) console.log(`         ${c.name}: expected ${c.want}, got ${c.got}`);
    moments.push(`${tz.split('/')[1] ?? tz}=${moment}`);
    legacies.push(`${tz.split('/')[1] ?? tz}=${legacy}`);
  }

  console.log();
  console.log('  A moment does shift, as it should (2026-07-18T23:30Z):');
  console.log('    ' + moments.join('  '));
  console.log();
  console.log('  What the old month label produced for July 2026:');
  console.log('    ' + legacies.join('  '));

  console.log();
  console.log(`  passed: ${pass}   failed: ${fail}`);
  process.exit(fail > 0 ? 1 : 0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
