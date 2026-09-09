// Module hooks for the footage checks.
//
// The engine is written against the site's `@/…` alias and against the
// Postgres library, neither of which Node's own loader knows. This maps the
// alias onto the repo and swaps the two database modules for in-memory
// doubles, so `check-footage.mjs` exercises the REAL engine — registry,
// router, rights, ranking, provenance, dedupe, URL reader — with the network
// and the database mocked at their edges and nothing else.
//
// The repo also imports without extensions (`./types`, `@/lib/footage`),
// which Next resolves and Node does not: any relative or aliased specifier
// that fails is retried as `<spec>.ts`, then `<spec>/index.ts`.
//
//   node --experimental-strip-types --import ./scripts/footage-loader.mjs scripts/check-footage.mjs
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

register('data:text/javascript,' + encodeURIComponent(`
  const root = ${JSON.stringify(pathToFileURL(root + '/').href)};
  const mocks = {
    '@/lib/data/stock': root + 'scripts/mocks/stock.mjs',
    '@/lib/data/postgres': root + 'scripts/mocks/postgres.mjs',
  };
  const notFound = (e) => e && (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'ERR_UNSUPPORTED_DIR_IMPORT');
  export async function resolve(specifier, context, next) {
    if (mocks[specifier]) return { url: mocks[specifier], shortCircuit: true };
    const aliased = specifier.startsWith('@/');
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (!aliased && !relative) return next(specifier, context);
    const base = aliased ? root + specifier.slice(2) : specifier;
    let last;
    for (const cand of [base, base + '.ts', base + '/index.ts']) {
      try { return await next(cand, context); } catch (e) { if (!notFound(e)) throw e; last = e; }
    }
    throw last;
  }
`), import.meta.url);
