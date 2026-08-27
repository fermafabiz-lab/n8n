// The other half: teach Final Assembly to hand the stored cards to Remotion.
//
//   node db/port/motif-cards/patch-final-assembly.mjs
//
// Reads `Final Assembly.original.json` and writes `Final Assembly.motif.json`.
// Applies nothing — a PUT is live from that second, so the window is a
// decision, not a side effect of building a file.
//
// ONE node is added and NOTHING existing is edited. That is deliberate: the
// first version of this patch rewrote `Build Remotion Props`, which is the most
// delicate node in the render path — forty lines of accumulated corrections
// about captions, silent films and montage intensity, every one of them paid
// for. Appending a node after it buys the same behaviour, is removable by
// deleting one box, and cannot break anything upstream of itself.
//
// It also means the render path still gains no model call: the choosing
// happened in Scripting, where the story was known. This is a lookup.
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const ORIGINAL = join(here, 'Final Assembly.original.json');
const OUT = join(here, 'Final Assembly.motif.json');

const NAME = 'Attach Motif Cards';
const AFTER = 'Build Remotion Props';
const BEFORE = 'Submit Graphics';

/**
 * Why this reads the order from TWO nodes instead of one.
 *
 * A card is anchored on `Ordine Scenă`, never on an array index: `Prepare
 * Clips` drops every scene without a final clip, so the index Scripting
 * numbered and the index the render uses part company the moment a clip is
 * missing — and the card would land on its neighbour. But `Prepare Clips` does
 * not carry the order through, only the chapter derived from it. What it does
 * carry is the scene `id`, and `Fetch Approved Scenes` has both. So the map is
 * built id → order there, and applied to the rendered list here.
 */
const CODE = `// Motif cards chosen by Claude Scripting and validated THERE, where the whole
// story was known and a quote could still be checked against its scene. This
// is a lookup: nothing is re-judged on the render path.
const body = $json.body;

let opts = {};
try {
  opts = JSON.parse(($('Fetch Project Info').first().json.fields || {})['Editing Options'] || '{}') || {};
} catch (e) { opts = {}; }
const cards = Array.isArray(opts.motifCards) ? opts.motifCards : [];

if (cards.length) {
  // Ordine Scenă per scene id, from the node that still has both.
  const orderById = new Map();
  try {
    for (const it of $('Fetch Approved Scenes').all()) {
      const f = it.json.fields || {};
      if (it.json.id != null) orderById.set(it.json.id, f['Ordine Scenă']);
    }
  } catch (e) {}
  // The rendered scene list, in its own order, expressed as those numbers.
  const rendered = $('Prepare Clips').all().map((c) => orderById.get(c.json.id));

  const out = [];
  for (const card of cards) {
    const i = (card.sceneOrder !== undefined && card.sceneOrder !== null)
      ? rendered.indexOf(card.sceneOrder)
      : card.sceneIndex;
    // A card whose scene never got a clip is left out. Not a failure to
    // report: the scene is not in the film either.
    if (!(i >= 0 && i < (body.scenes || []).length)) continue;
    const spec = Object.assign({}, card);
    // Bookkeeping for the producer's panel, not for the renderer.
    delete spec.sceneOrder;
    delete spec.verdict;
    delete spec.why;
    spec.sceneIndex = i;
    out.push(spec);
  }
  // Only when there is one: an empty array still counts as "explicit cards"
  // downstream and would switch the derived ones off for nothing.
  if (out.length) body.textCards = out;
}

return [{ json: { body } }];`;

const wf = JSON.parse(readFileSync(ORIGINAL, 'utf8'));
const anchor = wf.nodes.find((n) => n.name === AFTER);
if (!anchor) throw new Error(`cannot find ${AFTER} — re-save the original`);
if (!wf.connections[AFTER]?.main?.[0]?.some((c) => c.node === BEFORE)) {
	throw new Error(`${AFTER} no longer feeds ${BEFORE} — check the chain before splicing`);
}

// Idempotent.
wf.nodes = wf.nodes.filter((n) => n.name !== NAME);
delete wf.connections[NAME];

wf.nodes.push({
	parameters: {jsCode: CODE},
	id: 'motif-attach',
	name: NAME,
	type: 'n8n-nodes-base.code',
	typeVersion: 2,
	position: [anchor.position[0] + 200, anchor.position[1] + 180],
});

wf.connections[AFTER] = {
	main: [wf.connections[AFTER].main[0].map((c) => (c.node === BEFORE ? {...c, node: NAME} : c))],
};
wf.connections[NAME] = {main: [[{node: BEFORE, type: 'main', index: 0}]]};

writeFileSync(
	OUT,
	JSON.stringify(
		{name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: {executionOrder: 'v1'}},
		null,
		2,
	),
);
console.log(`${OUT.replace(root + '/', '')}`);
console.log(`  +1 node: ${AFTER} -> ${NAME} -> ${BEFORE}`);
console.log('  no existing node was edited');
