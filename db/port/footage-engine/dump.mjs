// Prints each node script JSON-encoded, ready to paste as `jsCode` into an
// n8n `updateNodeParameters` operation. Hand-escaping a regex-heavy Code node
// is how a `\s` becomes an `s` — see the `\uXXXX` lesson under motif cards in
// CLAUDE.md. Encode by machine, paste, then diff the live node back against
// the file with `verify.mjs`.
//
//   node db/port/footage-engine/dump.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'nodes');
for (const f of readdirSync(dir).sort()) {
  const src = readFileSync(join(dir, f), 'utf8').replace(/\n$/, '');
  process.stdout.write(`\n=== ${f} (${src.length} chars) ===\n${JSON.stringify(src)}\n`);
}
