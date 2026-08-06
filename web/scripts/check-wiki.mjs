// Checks the wiki against the code (wiki/*.md).
//
//   node scripts/check-wiki.mjs
//
// Documentation is the one artefact nothing tests. It is written once, it reads
// plausibly forever, and it goes wrong the moment somebody renames a tool — at
// which point it is worse than nothing, because a reader trusts it.
//
// So the parts that CAN be checked mechanically are:
//
//   1. Every MCP tool the wiki names exists.
//   2. Every MCP tool that exists is documented somewhere.
//   3. Every /api/ path the wiki mentions is a real route.
//   4. Every property type and view type is covered.
//   5. Every relative link between wiki pages resolves.
//
// What it cannot check is whether a sentence is TRUE. Nothing can. But the
// class of error this catches — a name that quietly stopped existing — is the
// one that makes a reader stop trusting the rest.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const wikiDir = join(repo, 'wiki');

const files = readdirSync(wikiDir).filter((f) => f.endsWith('.md'));
const pages = new Map(files.map((f) => [f, readFileSync(join(wikiDir, f), 'utf8')]));
const all = [...pages.values()].join('\n');

// Words that look like a tool name but are prose or a shell command. Kept
// short and explicit: the point of the rule is to catch a tool that quietly
// stopped existing, and a long allow-list would defeat it.
const ALLOWED_NON_TOOLS = new Set(['list_pages', 'sha256sum', 'create_rows_per_row']);

const errors = [];
const notes = [];

// ---- 1 + 2: the MCP tool catalogue ----------------------------------------

const mcp = readFileSync(join(repo, 'server/mcp.go'), 'utf8');
const tools = new Set([...mcp.matchAll(/"name":\s*"([a-z_]+)"/g)].map((m) => m[1]));

// Tools the wiki names, as `backticked` words. Only words that look like tool
// names are considered, so ordinary prose in backticks is not mistaken for one.
const named = new Set();
for (const [file, text] of pages) {
  for (const m of text.matchAll(/`([a-z][a-z_]{2,})\s*(?:\(|`)/g)) {
    const word = m[1];
    if (tools.has(word)) named.add(word);
    else if (/^(get|set|create|update|delete|list|query|save|write|import|propose|duplicate|embed|upload|search|note|whoami|working)_?/.test(word)
             && !ALLOWED_NON_TOOLS.has(word)) {
      errors.push(`${file}: \`${word}\` looks like a tool and is not one`);
    }
  }
}
for (const t of tools) {
  if (!named.has(t)) errors.push(`no wiki page documents the tool \`${t}\``);
}

// ---- 3: /api/ paths --------------------------------------------------------

const server = readFileSync(join(repo, 'server/server.go'), 'utf8');
const routes = [...server.matchAll(/m\.HandleFunc\("(?:[A-Z]+ )?([^"]+)"/g)].map((m) => m[1]);
/** A route pattern matches a mentioned path when their segments line up,
 *  treating {placeholders} as wildcards. */
const routeMatches = (mentioned) => {
  const want = mentioned.replace(/^\/+/, '').split('/');
  return routes.some((r) => {
    const have = r.replace(/^\/+/, '').split('/');
    if (have.length !== want.length) return false;
    return have.every((seg, i) => seg.startsWith('{') || seg === want[i]);
  });
};
for (const [file, text] of pages) {
  for (const m of text.matchAll(/`(\/api\/[A-Za-z0-9_{}/<>-]*)`/g)) {
    const path = m[1].replace(/<[^>]+>/g, '{x}');
    // A bare `/api/` in prose names the surface, not an endpoint.
    if (path === '/api/' || path === '/api') continue;
    if (!routeMatches(path)) errors.push(`${file}: \`${m[1]}\` is not a route`);
  }
}

// ---- 4: every type is covered ---------------------------------------------

const propTypes = new Set(
  [...readFileSync(join(repo, 'web/src/components/PropertyValue.tsx'), 'utf8')
    .matchAll(/case '([a-z]+)':/g)].map((m) => m[1]),
);
for (const t of propTypes) {
  if (!new RegExp('###\\s+' + t + '\\b').test(all)) {
    errors.push(`properties.md has no "### ${t}" section`);
  }
}

const viewTypes = ['table', 'board', 'list', 'gallery', 'calendar', 'form', 'timeline'];
const views = pages.get('views.md') ?? '';
for (const v of viewTypes) {
  if (!views.includes('`' + v + '`')) errors.push(`views.md never names \`${v}\``);
}

// ---- 5: links between wiki pages resolve -----------------------------------

for (const [file, text] of pages) {
  for (const m of text.matchAll(/\]\(([a-z-]+\.md)(#[a-z0-9-]+)?\)/g)) {
    if (!pages.has(m[1])) errors.push(`${file}: links to ${m[1]}, which does not exist`);
  }
  if (file !== 'README.md' && !(pages.get('README.md') ?? '').includes(file)) {
    notes.push(`${file} is not listed in README.md`);
  }
}

// ---- report ----------------------------------------------------------------

console.log(`\n  wiki: ${files.length} pages, ${tools.size} tools, ${routes.length} routes`);
for (const n of notes) console.log(`  note  ${n}`);
for (const e of errors) console.log(`  FAIL  ${e}`);
if (errors.length) {
  console.log(`\n  FAILED — the wiki disagrees with the code in ${errors.length} place(s).\n`);
  process.exit(1);
}
console.log('  ok — every tool, route and type in the wiki still exists\n');
