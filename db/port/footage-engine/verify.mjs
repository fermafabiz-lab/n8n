// Diff the live `Archive Suggestions` nodes against the files in ./nodes.
//
// The MCP connector answers `get_workflow_details` with the DRAFT; pass the
// JSON it returned (saved to a file) and this prints, per node, whether the
// live `jsCode` is byte-identical to the repo copy. Anything else is the
// failure mode the motif-card port hit: a node that works and is not what
// was written.
//
//   node db/port/footage-engine/verify.mjs /path/to/workflow.json
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP = {
  'Build Query Prompt': 'build-query-prompt.js',
  'Parse Queries': 'parse-queries.js',
  'Build Rank Prompts': 'build-rank-prompts.js',
};
const dir = join(dirname(fileURLToPath(import.meta.url)), 'nodes');
const wf = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const nodes = wf.workflow?.nodes ?? wf.nodes ?? [];
let bad = 0;
for (const [name, file] of Object.entries(MAP)) {
  const node = nodes.find((n) => n.name === name);
  const want = readFileSync(join(dir, file), 'utf8').replace(/\n$/, '');
  const got = node?.parameters?.jsCode ?? '';
  const same = got === want;
  if (!same) bad += 1;
  console.log(`${same ? 'OK  ' : 'DIFF'} ${name}: live ${got.length} chars, repo ${want.length} chars`);
}
process.exit(bad ? 1 : 0);
