// Run the motif validator against a real film, without n8n and without a model.
//
//   node motif/check-motif.mjs <props.json> <candidate.json>
//
// `props.json` is any Final Assembly props fixture (it holds the scenes and,
// when the project was researched, the evidence pack). `candidate.json` is what
// the model returned — or, before there is a model, what you think it should
// have returned. The point of having this before the n8n side exists is that
// the rules can be argued with on a real script rather than in the abstract.
import {readFileSync} from 'node:fs';
import {validateMotifCards} from './validate.mjs';

const [propsPath, candidatePath] = process.argv.slice(2);
if (!propsPath || !candidatePath) {
	console.error('usage: node motif/check-motif.mjs <props.json> <candidate.json>');
	process.exit(1);
}

const props = JSON.parse(readFileSync(propsPath, 'utf8'));
const cards = JSON.parse(readFileSync(candidatePath, 'utf8'));
const scenes = props.scenes ?? [];

const {accepted, report} = validateMotifCards({
	cards,
	scenes,
	evidence: props.evidence ?? [],
	chapterCardsOn: props.showChapterCards !== false,
});

const MARK = {ok: '  OK  ', review: 'REVIEW', rejected: ' DROP '};
console.log(`\n${scenes.length} scenes · ${cards.length} proposed · ${accepted.length} accepted\n`);
for (const r of report) {
	console.log(`[${MARK[r.verdict]}] ${r.variant ?? '?'} @ ${r.at}`);
	if (r.why) console.log(`          ${r.why}`);
	for (const n of r.notes ?? []) console.log(`          · ${n}`);
}

console.log('\ntextCards that would reach the render:');
console.log(JSON.stringify(accepted, null, '\t'));
