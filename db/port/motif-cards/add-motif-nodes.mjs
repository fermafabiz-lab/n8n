// Splice the motif-card chain into Claude Scripting, as a FILE.
//
//   node db/port/motif-cards/add-motif-nodes.mjs
//
// Reads `Claude Scripting.original.json` (a verbatim GET of the live workflow)
// and writes `Claude Scripting.motif.json`, a PUT-ready body. It applies
// nothing: the n8n public API has no draft, so a PUT is live from that second —
// proven the hard way when a converted `Video Factory Notifications` went into
// production while everyone believed it was staged. The apply window is in
// README.md, and the original beside this file is the only rollback.
//
// Re-runnable: if the chain is already present it is replaced rather than
// duplicated, so iterating on the prompt is one edit and one re-run.
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripComments} from './strip-comments.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const ORIGINAL = join(here, 'Claude Scripting.original.json');
const OUT = join(here, 'Claude Scripting.motif.json');

/** Credentials are REDACTED by the API, so a read cannot confirm them and a
 *  new node must state them. Both ids are recorded in CLAUDE.md. */
const OPENAI_CRED = {openAiApi: {id: 'oPGuXelJ6pnDePIs', name: 'OpenAi account'}};
const PG_CRED = {postgres: {id: 'eRjiNDQFuDSTJpGK', name: 'HOV Postgres'}};

/** Where the chain goes: after the scenes are saved, before the approval wait. */
const AFTER = 'Save scenes To Airtable1';
const BEFORE = 'Wait For Scene Approval';

const NAMES = [
	'Prep Motif Input',
	'Motif Model',
	'Motif Parser',
	'Choose Motif Cards',
	'Validate Motif Cards',
	'Save Motif Cards',
	'Motif Done',
];

/**
 * The validator, inlined from its one home rather than copied by hand.
 *
 * `toMontageCards` exists in the render for exactly this reason: a hand-copied
 * projection is a mirror, and mirrors go stale. The Code node gets the same
 * bytes `npm run check:motif` runs, with the ESM keywords stripped, so a rule
 * can never be true in the test and false in production.
 */
const validatorSource = () => {
	const src = readFileSync(join(root, 'remotion', 'motif', 'validate.mjs'), 'utf8');
	const code = stripComments(src).replace(/^export\s+(const|function)\s/gm, '$1 ');
	// Comments are two thirds of that file's bytes and they are the good kind —
	// they say why each rule exists. They stay in the file, which is what anyone
	// edits; the node gets the artifact plus a pointer home. Both copies are run
	// against the same fixtures before this ships, so the stripping cannot
	// change a verdict silently.
	return [
		'// GENERATED from remotion/motif/validate.mjs — do not edit here.',
		'// Edit that file, run db/port/motif-cards/add-motif-nodes.mjs, re-apply.',
		'// The comments (and the reasoning) live in the source.',
		'',
		code,
	].join('\n');
};

const SYSTEM_MESSAGE = `You choose the drawn cards for a short film that has already been written. A drawn card replaces the picture for two to four seconds with a graphic: it is a cut to different material, not an overlay.

A card must show what neither the voice nor the shot is showing. This fails in two directions:
- The narration already says it. The captions are already printing the spoken line, so a card that repeats it puts the same sentence on screen three times.
- The shot already shows it. You are given each scene's SHOT and MOTION prompt, so you know what will be on screen. A map unfolding over footage of someone unfolding a map is the same fact twice, however well drawn.

What a card CAN add: the shape of a journey, the size of a gap between two times, a quantity a listener cannot hold in their head. If a scene has none of those, it gets no card.

You may only choose from the motifs that exist:

route — a chart unfolds and the journey draws itself across it. Fields: stops (2-4 strings in travel order; the last is the destination), label (optional short word naming the graphic, no digits, max 12 chars), note (optional).
schedule — a departure board flaps times into place. Fields: rows (2-3 objects {label, value} where value is HH:MM), label (optional, same rule), note (optional; if it states the gap between the times, source it as arithmetic and the code will check your subtraction).

You cannot invent a motif. A variant that is not on this list produces nothing.

Everything you put on screen must already be in the film. For every string you write, name the scene and quote the exact words it comes from, in "sources", keyed by the path of the string it justifies: stops[2], rows[1].value, note. Three kinds are accepted:
- quote — {"kind":"quote","sceneIndex":N,"from":"exact words"}. The words must appear verbatim in that scene's narration.
- arithmetic — {"kind":"arithmetic"}, only for a schedule note stating the gap.
- evidence — {"kind":"evidence","ref":"E3"}, a row of the research pack. This is the ONLY door for a fact from outside the script.

You may render a quoted thing differently — "cinci si douazeci" may become "05:20" — but you may not introduce a fact the film does not contain. A distance, a date or a statistic that is nowhere in the script and nowhere in the research pack is not yours to add.

A card may not use a word the film has not spoken yet: quote only from the card's own scene or an earlier one. Write each string in the film's own words; a card that says "Feribot" while the film has only said "ferry" is wrong even though it means the same.

Aim for one to three cards on every film. This pipeline wants animations in its videos, so look hard: a journey with named legs, two times set against each other, a quantity a listener cannot hold. Take the best one or two even when neither is spectacular.

But never force one. If the script genuinely offers nothing that either motif can draw truthfully, return an empty array and say so in "none_because" — one line naming what the film DID offer that you had no motif for. That line is the most useful thing you can return on such a film: it is how the next motif gets chosen and built. Padding the answer with a card that repeats the narration is worse than an empty array, because a bad card ships and an empty array only asks a question.

Give each card a "priority" (1 is best) and a one-line "why" saying what it shows that the voice and the shot do not. Answer with JSON only.`;

const PREP_CODE = `// One item out, or the agent below runs once per scene.
//
// The scene list is taken from Validate Evidence Refs — the last node that has
// every scene in the order the film plays — and each scene is handed to the
// model with the SHOT and MOTION prompts beside its narration. Those two are
// the load-bearing half of the input: they are what lets the model see that a
// scene is already showing the thing it was about to draw, which is the
// mistake this whole feature was born from.
const items = $('Validate Evidence Refs').all();
const scenes = items.map((it, i) => {
  const j = it.json || {};
  const chapter = Number(j.chapter_number ?? 0);
  const scene = Number(j.scene_number ?? i + 1);
  return {
    index: i,
    // chapter*100 + scene, the convention every workflow already shares.
    order: chapter * 100 + scene,
    chapter,
    narration: String(j.narrator_text || ''),
    shot: String(j.image_prompt || ''),
    motion: String(j.video_motion_prompt || ''),
  };
});

let research = '';
try { research = String($('Extract Claims').first().json.output || ''); } catch (e) {}

let title = '';
let tone = '';
try {
  const p = $('Receive Project Data').first().json || {};
  title = String(p['Nume Proiect'] || p.name || p.Tema || '');
  tone = String(p.Tonalitate || p.tone || '');
} catch (e) {}

const brief = [
  \`FILM: \${title}\`,
  \`TONE: \${tone}\`,
  '',
  'SCENES (index · narration · what the shot will show)',
  ...scenes.map((s) => [
    \`\${s.index} · \${s.narration}\`,
    \`    SHOT: \${s.shot}\`,
    \`    MOTION: \${s.motion}\`,
  ].join('\\n')),
  '',
  'RESEARCH PACK (may be empty)',
  research || '(none — this film was not researched, so no fact from outside the script is available)',
].join('\\n');

return [{ json: { brief, scenes, sceneCount: scenes.length } }];`;

const VALIDATE_CODE = `${validatorSource()}

// ---------------------------------------------------------------------------
// Glue. Everything above is remotion/motif/validate.mjs verbatim; everything
// below is what this node does with it.
//
// The agent is onError:continueRegularOutput — a model that refuses, times out
// or answers rubbish must never kill a scripting run, so a missing or unusable
// answer simply means this film has no cards.
let proposed = [];
try {
  const out = $json.output ?? $json;
  proposed = Array.isArray(out) ? out : (out.cards ?? []);
} catch (e) {}

const scenes = $('Prep Motif Input').first().json.scenes.map((s) => ({
  narratorText: s.narration,
  chapter: s.chapter,
  sceneOrder: s.order,
}));

let evidence = [];
try {
  evidence = $('Extract Claims').first().json.claims || [];
} catch (e) {}

const { accepted, report } = validateMotifCards({ cards: proposed, scenes, evidence });

// The report is the only record of WHY a card did not make it, and a dropped
// card is invisible on screen by definition. Log it or the next person debugs
// an absence.
for (const r of report) {
  console.log(\`MOTIF \${r.verdict.toUpperCase()} \${r.variant ?? '?'} @ \${r.at}: \${r.why || ''}\`);
  for (const n of r.notes || []) console.log(\`  · \${n}\`);
}
// A film that got nothing must say why. Otherwise "no cards" and "the node is
// broken" look identical in the logs, and the reason a film offered no motif
// is the single most useful input we have for deciding which motif to build
// next.
if (!accepted.length) {
  let why = '';
  try { why = String(($json.output || {}).none_because || ''); } catch (e) {}
  console.log(\`MOTIF NONE: \${why || 'the model returned nothing and gave no reason'}\`);
}

return [{ json: { motifCards: accepted, motifReport: report } }];`;

const SAVE_QUERY = `-- A true merge, one statement. Editing Options is shared by the creation form,
-- the final-settings step and the sound switches, and writing it wholesale is
-- the exact bug that once wiped category/cast/multiVoiceMode. Written as raw
-- SQL rather than through hov.at_write because at_write SETS a field and this
-- has to MERGE into one — the same reason the site's updateEditingOptions is
-- \`editing_options || $1::jsonb\` instead of a read-modify-write.
--
-- Dollar-quoting, exactly as every other Postgres node here does it: the
-- expression is interpolated between $hov$ markers, so nothing in a title or a
-- quoted line can close the string.
update hov.project
   set editing_options = coalesce(editing_options, '{}'::jsonb)
     || $hov\${{ JSON.stringify({ motifCards: $json.motifCards }) }}$hov\$::jsonb
 where id = $hov\${{ $('Receive Project Data').first().json.Project_ID }}$hov\$
returning id;`;

const DONE_CODE = `// Restore the stream. Save scenes To Airtable1 emits one item per scene and
// Wait For Scene Approval is wired to receive exactly that; the motif chain
// collapses to a single item on its way through, so it has to hand the scenes
// back or the approval loop is fed something it never expected. Same move
// Evidence Done makes for the same reason.
return $('${AFTER}').all();`;

const nodes = (baseX, baseY) => [
	{
		parameters: {jsCode: PREP_CODE},
		id: 'motif-prep',
		name: 'Prep Motif Input',
		type: 'n8n-nodes-base.code',
		typeVersion: 2,
		position: [baseX, baseY],
	},
	{
		parameters: {
			model: {__rl: true, value: 'gpt-5.4', mode: 'list', cachedResultName: 'gpt-5.4'},
			builtInTools: {},
			options: {},
		},
		id: 'motif-model',
		name: 'Motif Model',
		type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
		typeVersion: 1.3,
		position: [baseX + 180, baseY + 180],
		credentials: OPENAI_CRED,
	},
	{
		parameters: {
			jsonSchemaExample: JSON.stringify(
				{
					none_because: '',
					cards: [
						{
							sceneIndex: 6,
							variant: 'schedule',
							priority: 1,
							why: 'what this shows that the voice and the shot do not',
							label: 'Orar',
							stops: ['string'],
							rows: [{label: 'Feribot', value: '05:20'}],
							note: '2 h 40 min marja',
							sources: {
								'rows[0].value': {kind: 'quote', sceneIndex: 6, from: 'exact words from that scene'},
							},
						},
					],
				},
				null,
				2,
			),
		},
		id: 'motif-parser',
		name: 'Motif Parser',
		type: '@n8n/n8n-nodes-langchain.outputParserStructured',
		typeVersion: 1.3,
		position: [baseX + 340, baseY + 180],
	},
	{
		parameters: {
			promptType: 'define',
			text: '={{ $json.brief }}',
			hasOutputParser: true,
			options: {systemMessage: SYSTEM_MESSAGE},
		},
		id: 'motif-agent',
		name: 'Choose Motif Cards',
		type: '@n8n/n8n-nodes-langchain.agent',
		typeVersion: 3.1,
		position: [baseX + 240, baseY],
		// A film with no cards is a fine film. A scripting run that dies because
		// a graphic could not be chosen is not.
		onError: 'continueRegularOutput',
	},
	{
		parameters: {jsCode: VALIDATE_CODE},
		id: 'motif-validate',
		name: 'Validate Motif Cards',
		type: 'n8n-nodes-base.code',
		typeVersion: 2,
		position: [baseX + 480, baseY],
	},
	{
		parameters: {operation: 'executeQuery', query: SAVE_QUERY, options: {}},
		id: 'motif-save',
		name: 'Save Motif Cards',
		type: 'n8n-nodes-base.postgres',
		typeVersion: 2.6,
		position: [baseX + 700, baseY],
		credentials: PG_CRED,
		onError: 'continueRegularOutput',
	},
	{
		parameters: {jsCode: DONE_CODE},
		id: 'motif-done',
		name: 'Motif Done',
		type: 'n8n-nodes-base.code',
		typeVersion: 2,
		position: [baseX + 920, baseY],
	},
];

const wf = JSON.parse(readFileSync(ORIGINAL, 'utf8'));
if (!wf.nodes?.length || !wf.connections) throw new Error('original does not look like a workflow');
const anchor = wf.nodes.find((n) => n.name === AFTER);
if (!anchor) throw new Error(`cannot find ${AFTER} — the workflow changed, re-save the original`);
if (!wf.connections[AFTER]?.main?.[0]?.some((c) => c.node === BEFORE)) {
	throw new Error(`${AFTER} no longer feeds ${BEFORE} — check the chain before splicing`);
}

// Idempotent: drop any previous run's nodes and edges first.
wf.nodes = wf.nodes.filter((n) => !NAMES.includes(n.name));
for (const name of NAMES) delete wf.connections[name];

const added = nodes(anchor.position[0], anchor.position[1] + 260);
wf.nodes.push(...added);

const to = (name) => ({main: [[{node: name, type: 'main', index: 0}]]});
// The one edge that changes: the approval wait now comes after the chain.
wf.connections[AFTER] = {
	main: [
		wf.connections[AFTER].main[0].map((c) =>
			c.node === BEFORE ? {...c, node: 'Prep Motif Input'} : c,
		),
	],
};
wf.connections['Prep Motif Input'] = to('Choose Motif Cards');
wf.connections['Choose Motif Cards'] = to('Validate Motif Cards');
wf.connections['Validate Motif Cards'] = to('Save Motif Cards');
wf.connections['Save Motif Cards'] = to('Motif Done');
wf.connections['Motif Done'] = to(BEFORE);
wf.connections['Motif Model'] = {
	ai_languageModel: [[{node: 'Choose Motif Cards', type: 'ai_languageModel', index: 0}]],
};
wf.connections['Motif Parser'] = {
	ai_outputParser: [[{node: 'Choose Motif Cards', type: 'ai_outputParser', index: 0}]],
};

// PUT is stricter than GET about `settings`: it rejects binaryMode and
// availableInMCP, which GET happily returns, and merges what it is given.
const body = {
	name: wf.name,
	nodes: wf.nodes,
	connections: wf.connections,
	settings: {executionOrder: 'v1'},
};

writeFileSync(OUT, JSON.stringify(body, null, 2));
console.log(`${OUT.replace(root + '/', '')}`);
console.log(`  ${wf.nodes.length} nodes (${added.length} added)`);
console.log(`  ${AFTER} -> Prep Motif Input -> ... -> Motif Done -> ${BEFORE}`);
console.log(`  validator inlined: ${validatorSource().length} chars from remotion/motif/validate.mjs`);
