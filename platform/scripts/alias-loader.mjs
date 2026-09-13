// Module hook that resolves the site's `@/…` alias to the repo root, and
// retries an extensionless specifier (`./types`, `@/lib/provenance`) as
// `<spec>.ts` then `<spec>/index.ts` — the same two things Next's bundler
// does and Node's own loader does not. Factored out of
// `footage-loader.mjs`, which does the same resolution plus a pair of
// check-footage-specific mocks; this is the bare version for any check
// script that imports plain site TS modules with no database dependency.
//
// Also retries a bare `next/<subpath>` specifier (e.g. `next/server`) as
// `next/<subpath>.js` when the plain resolution fails — Node has no
// "package exports" awareness of Next's own subpath layout the way Next's
// bundler does, but the `.js` files are really there on disk
// (`node_modules/next/server.js`). This is what lets a check script import
// a route.ts FILE DIRECTLY and call its GET/POST exports as plain
// functions — route handlers are just async functions, so this is the one
// thing standing between "schema-only tests" and "tests through the real
// handler". Only activates on a resolution FAILURE, so it can never change
// how any currently-working import resolves.
//
//   node --experimental-strip-types --import ./scripts/alias-loader.mjs <script.mjs>
import {register} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

register(
	'data:text/javascript,' +
		encodeURIComponent(`
  const root = ${JSON.stringify(pathToFileURL(root + '/').href)};
  const notFound = (e) => e && (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'ERR_UNSUPPORTED_DIR_IMPORT');
  export async function resolve(specifier, context, next) {
    const aliased = specifier.startsWith('@/');
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (!aliased && !relative) {
      if (/^next\\/[a-z][a-z0-9-]*$/.test(specifier)) {
        try { return await next(specifier, context); }
        catch (e) { if (!notFound(e)) throw e; return next(specifier + '.js', context); }
      }
      return next(specifier, context);
    }
    const base = aliased ? root + specifier.slice(2) : specifier;
    let last;
    for (const cand of [base, base + '.ts', base + '/index.ts']) {
      try { return await next(cand, context); } catch (e) { if (!notFound(e)) throw e; last = e; }
    }
    throw last;
  }
`),
	import.meta.url,
);
