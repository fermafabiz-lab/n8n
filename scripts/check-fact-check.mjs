#!/usr/bin/env node
//
// check-fact-check.mjs — run the fact-check chain's two Code nodes against
// fixtures, with no n8n and no network.
//
//     node scripts/check-fact-check.mjs
//
// WHY THIS EXISTS. `FC Resolve` and `FC Apply` are the only two nodes in the
// chain that decide anything on their own; everything else is a prompt or a
// gate. `FC Apply` in particular is the safety valve: it is the one place that
// can hand a REWRITTEN narration to `Combine Chapters`, and therefore the one
// place that can damage a script the producer already approved. Its refusals
// are the whole guarantee, and a refusal is exactly the kind of branch that is
// never exercised by a happy-path run on real data.
//
// The bodies are read from `db/port/fact-check/paste/*.js` — the committed
// source the live nodes were pasted from — so this check fails if the file and
// the intent drift apart. It does NOT prove the live node matches the file;
// that is what `db/port/lib/diff-workflow.mjs` is for.
//
// Each node body is an n8n Code node: it reads `$json`, calls `$('Node Name')`
// and ends in `return [{json: …}]`. `runNode` below supplies exactly those.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PASTE = join(here, '..', 'db', 'port', 'fact-check', 'paste');
// The re-run chain's own bodies. `DS Judge` and `DS Source` take the FC prompts
// byte for byte — that is the point of `DS Prep` emitting under `fc` — so only
// its Code nodes and its one extra prompt rule have logic of their own here.
const DS = join(here, '..', 'db', 'port', 'deep-search-rerun', 'paste');

let failures = 0;
const logs = [];

function ok(label, cond, detail) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`);
  }
}

// Run one Code node body with a fake n8n context. `nodes` maps a node name to
// the item its `$('Name').first().json` should return; a name that is absent
// throws, which is what n8n does for an unreachable node and what the bodies'
// try/catch blocks are written against.
function runNode(file, { json = {}, nodes = {}, dir = PASTE } = {}) {
  const body = readFileSync(join(dir, file), 'utf8');
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`No node called "${name}" could be found`);
    return { first: () => ({ json: nodes[name] }) };
  };
  const fakeConsole = { log: (...a) => logs.push(a.join(' ')) };
  const fn = new Function('$json', '$', 'Buffer', 'console', body);
  const out = fn(json, $, Buffer, fakeConsole);
  return out[0].json;
}

// ---------------------------------------------------------------------------
// Fixtures — a two-chapter researched film with one sentence the pack backs
// and one it does not.
// ---------------------------------------------------------------------------

const CH1 = 'Google acquired Where 2 Technologies in October 2004. Lars and Jens led the team into launch.';
const CH2 = 'The map went live in February 2005. It covered the United States, Britain and Canada.';

const chapters = () => [
  { chapter_number: 1, chapter_title: 'The acquisition', narrator_script: CH1 },
  { chapter_number: 2, chapter_title: 'Launch', narrator_script: CH2 },
];

const narration = () =>
  chapters()
    .map((c) => `[CHAPTER ${c.chapter_number}: ${c.chapter_title}]\n${c.narrator_script}`)
    .join('\n\n');

const guard = () => ({
  output: narration(),
  retry: false,
  chapters: chapters(),
  words: 30,
  target: 30,
  min: 27,
  max: 33,
});

const prepped = (extra = {}) => ({
  ...guard(),
  fc: {
    run: true,
    category: 'documentary',
    skipCode: null,
    skipped: null,
    pack: [],
    packList: 'E1. Google acquired Where 2 Technologies in October 2004. [News from Google, 2004 — https://example.org/a]',
    narration: narration(),
    originalWords: 30,
    ...extra,
  },
});

const judged = (findings, mode = 'factual') => ({ output: { mode, findings } });

// Functions, not constants: `FC Resolve` promotes a finding by MUTATING it in
// place (which is correct inside n8n, where every run gets fresh items), so a
// shared fixture object would carry one scenario's verdict into the next.
const SUPPORTED = () => ({
  quote: 'Google acquired Where 2 Technologies in October 2004.',
  claim: 'Google acquired Where 2 Technologies in October 2004.',
  verdict: 'supported',
  ref: 'E1',
  reason: 'E1 states it.',
});
const UNSUPPORTED = () => ({
  quote: 'Lars and Jens led the team into launch.',
  claim: 'Lars and Jens Rasmussen led the team through to launch.',
  verdict: 'unsupported',
  ref: '',
  reason: 'No claim describes who led the team.',
});

// ---------------------------------------------------------------------------
// FC Prep
// ---------------------------------------------------------------------------

console.log('FC Prep');

// The project record as `Fetch Project Record` carries it: Editing Options is
// a JSON STRING inside `fields`. This is the shape `Voice Mode` has read for
// months, and copying it is the whole point — the first version of FC Prep
// invented its own source (`Receive Project Data`, the typed sub-workflow
// trigger) and got undefined on every film.
const record = (category) => ({
  id: 'rec1',
  fields: { 'Editing Options': JSON.stringify({ sfx: true, speed: 1, category, chapterCards: true }) },
});
// The trigger, for the regression test below: eight declared fields and no
// project record anywhere on it.
const TRIGGER_ONLY = {
  Project_ID: 'rec1',
  Tema: 'A film',
  Tonalitate: 'Documentary',
  Pace: 'Normal',
  Lenght: '120',
  Language: 'English',
  Style: 'Documentary',
  Lore: '',
};
const PACK = { researched: true, claims: [{ ref: 'E1', claim: 'c', source: 's', date: '2004', url: 'u' }] };

{
  const out = runNode('FC Prep.js', {
    json: guard(),
    nodes: { 'Fetch Project Record': record('documentary'), 'Extract Claims': PACK },
  });
  ok('runs on a researched DOCUMENTARY with a pack', out.fc.run === true);
  ok('keeps the guard payload intact', out.output === narration() && out.chapters.length === 2 && out.target === 30);
  ok('numbers the pack for the judge', out.fc.packList.startsWith('E1. c ['));
  ok('the narration it hands the judge keeps the chapter markers', out.fc.narration.includes('[CHAPTER 2: Launch]'));
  ok('records the mode it ran in', out.fc.category === 'documentary');
}
{
  // THE REGRESSION. `Receive Project Data` is the typed trigger: eight declared
  // fields, no project record. FC Prep read it for four hours on 2026-09-18 and
  // skipped every documentary as `no-mode`. If this ever passes again, the
  // category is being read from the wrong node.
  const out = runNode('FC Prep.js', {
    json: guard(),
    nodes: { 'Receive Project Data': TRIGGER_ONLY, 'Extract Claims': PACK },
  });
  ok('the sub-workflow trigger alone is NOT a source for the mode', out.fc.run === false && out.fc.skipCode === 'no-mode');
}
{
  // THE PRODUCER'S RULE: Documentary mode only, whatever the narration is.
  for (const cat of ['story', 'cinematic', 'kids']) {
    const out = runNode('FC Prep.js', {
      json: guard(),
      nodes: { 'Fetch Project Record': record(cat), 'Extract Claims': PACK },
    });
    ok(`does not run on a ${cat} film, even researched with a pack`, out.fc.run === false);
    ok(`and says so as "not-documentary" (${cat})`, out.fc.skipCode === 'not-documentary');
    ok(`and still carries the script on (${cat})`, out.chapters.length === 2 && out.output === narration());
  }
}
{
  // A mode that cannot be read is a FAULT, not a setting — it is the one case
  // where doing nothing looks exactly like working.
  const out = runNode('FC Prep.js', { json: guard(), nodes: { 'Extract Claims': PACK } });
  ok('an unreadable mode is reported as no-mode, not as a quiet skip', out.fc.skipCode === 'no-mode');
  ok('and the script survives it', out.chapters.length === 2);
}
{
  const out = runNode('FC Prep.js', {
    json: guard(),
    nodes: { 'Fetch Project Record': { id: 'rec1', fields: {} }, 'Extract Claims': PACK },
  });
  ok('Editing Options with no category is also no-mode', out.fc.skipCode === 'no-mode');
}
{
  const out = runNode('FC Prep.js', {
    json: guard(),
    nodes: { 'Fetch Project Record': record('documentary'), 'Extract Claims': { researched: false, claims: [] } },
  });
  ok('a documentary with no research is not-researched', out.fc.run === false && out.fc.skipCode === 'not-researched');
  ok('a skipped film still carries its chapters on', out.chapters.length === 2);
}
{
  const out = runNode('FC Prep.js', {
    json: guard(),
    nodes: { 'Fetch Project Record': record('documentary'), 'Extract Claims': { researched: true, claims: [] } },
  });
  ok('a documentary with an empty pack is no-pack', out.fc.skipCode === 'no-pack');
}
{
  const out = runNode('FC Prep.js', {
    json: { ...guard(), chapters: [] },
    nodes: { 'Fetch Project Record': record('documentary'), 'Extract Claims': PACK },
  });
  ok('no chapters is no-chapters', out.fc.skipCode === 'no-chapters');
}
{
  // The reference itself dangling must not lose the script.
  const out = runNode('FC Prep.js', { json: guard(), nodes: {} });
  ok('an unreachable Extract Claims degrades to "skipped", not an error', out.fc.run === false && out.chapters.length === 2);
}

// ---------------------------------------------------------------------------
// FC Resolve
// ---------------------------------------------------------------------------

console.log('FC Resolve');
{
  const out = runNode('FC Resolve.js', {
    json: judged([SUPPORTED(), UNSUPPORTED()]),
    nodes: { 'FC Prep': prepped(), 'FC Judge': judged([SUPPORTED(), UNSUPPORTED()]) },
  });
  ok('reads the narration past the agent, not from $json', out.chapters && out.chapters.length === 2);
  ok('keeps both findings', out.fc.findings.length === 2);
  ok('marks the supported one keep', out.fc.findings[0].action === 'keep');
  ok('marks the unsupported one rewrite', out.fc.findings[1].action === 'rewrite');
  ok('asks for a rewrite', out.fc.needsRewrite === true);
  ok('the brief names the sentence', out.fc.fixList.includes('Lars and Jens led the team into launch.'));
}
{
  const invented = { ...UNSUPPORTED(), quote: 'A sentence that is not in the script at all.' };
  const out = runNode('FC Resolve.js', {
    json: judged([invented]),
    nodes: { 'FC Prep': prepped(), 'FC Judge': judged([invented]) },
  });
  ok('drops a quote that is not in the narration verbatim', out.fc.findings.length === 0 && out.fc.needsRewrite === false);
}
{
  const src =
    'RESULT: 1 | STATUS: confirmed | SOURCE: News from Google | URL: https://example.org/lars | DATE: 2005 | SAYS: Both brothers ran the team.';
  const out = runNode('FC Resolve.js', {
    json: judged([SUPPORTED(), UNSUPPORTED()]),
    nodes: { 'FC Prep': prepped(), 'FC Judge': judged([SUPPORTED(), UNSUPPORTED()]), 'FC Source': { output: src } },
  });
  const f = out.fc.findings[1];
  ok('a confirmed lookup promotes the finding to supported', f.verdict === 'supported' && f.action === 'keep');
  ok('and carries the source through', f.url === 'https://example.org/lars' && f.source === 'News from Google');
  ok('a promoted finding no longer needs a rewrite', out.fc.needsRewrite === false);
  ok('counts what was looked up', out.fc.searched === 1);
}
{
  const src = 'RESULT: 1 | STATUS: refuted | SOURCE: The Times | URL: https://example.org/no | DATE: 2005 | SAYS: Only Lars did.';
  const out = runNode('FC Resolve.js', {
    json: judged([UNSUPPORTED()]),
    nodes: { 'FC Prep': prepped(), 'FC Judge': judged([UNSUPPORTED()]), 'FC Source': { output: src } },
  });
  ok('a refuted lookup becomes contradicted', out.fc.findings[0].verdict === 'contradicted');
  ok('and still gets rewritten', out.fc.findings[0].action === 'rewrite' && out.fc.needsRewrite === true);
  ok('the brief tells the rewrite what the source says', out.fc.fixList.includes('Only Lars did.'));
}
{
  // A source line with no usable URL is worth nothing: the point of the step
  // is a link a producer can open.
  const src = 'RESULT: 1 | STATUS: confirmed | SOURCE: somewhere | URL: not-a-url | DATE: | SAYS: trust me';
  const out = runNode('FC Resolve.js', {
    json: judged([UNSUPPORTED()]),
    nodes: { 'FC Prep': prepped(), 'FC Judge': judged([UNSUPPORTED()]), 'FC Source': { output: src } },
  });
  ok('a confirmation with no resolvable URL does not promote', out.fc.findings[0].verdict === 'unsupported');
}
{
  const out = runNode('FC Resolve.js', {
    json: judged([]),
    nodes: { 'FC Prep': prepped(), 'FC Judge': { output: {} } },
  });
  ok('a judge that returned nothing is not an error', out.fc.findings.length === 0 && out.chapters.length === 2);
}
{
  // THE REAL THING. Copied verbatim out of execution 14761, a live FC Source
  // run against the Burj Al Arab film — curly quotes, a comma inside DATE, an
  // empty URL on a not-found line, and a space before every pipe. The first
  // version of the parser matched NOTHING in this and the search step was
  // silently inert; nothing but a real response would have shown that.
  const real = [
    'RESULT: 1 | STATUS: confirmed | SOURCE: University of North Texas Libraries (UNT Digital Library) | URL: https://digital.library.unt.edu/ark:/67531/metadc51881/ | DATE: 1993/1999 | SAYS: The catalogue entry credits architect Tom Wright and gives the creation date as “1993/1999”.',
    'RESULT: 2 | STATUS: not-found | SOURCE: not found | URL:  | DATE:  | SAYS: No adequate source states that crews set marker buoys and brought barges there.',
    'RESULT: 3 | STATUS: confirmed | SOURCE: Linden Shipping International LLC | URL: https://lindeninternational.ae/burj-al-arab-hotel-sundecks/ | DATE: May 25, 2016 | SAYS: Its vessels worked for 1.5 years on the manmade island, the bridge and the foundations.',
  ].join('\n');
  const three = [
    { ...UNSUPPORTED(), quote: 'Lars and Jens led the team into launch.' },
    { ...UNSUPPORTED(), quote: 'The map went live in February 2005.' },
    { ...UNSUPPORTED(), quote: 'It covered the United States, Britain and Canada.' },
  ];
  const j = judged(three);
  const out = runNode('FC Resolve.js', {
    json: j,
    nodes: { 'FC Prep': prepped(), 'FC Judge': j, 'FC Source': { output: real } },
  });
  ok('parses a real FC Source response', out.fc.searched === 3);
  ok('promotes the two with a URL', out.fc.findings.filter((f) => f.verdict === 'supported').length === 2);
  ok('leaves the not-found one unsupported', out.fc.findings[1].verdict === 'unsupported');
  ok('keeps a DATE that contains a comma', out.fc.findings[2].sourceDate === 'May 25, 2016');
  ok('does not let an empty URL field swallow the next pipe', out.fc.findings[1].url === undefined);
}
{
  // A fiction film that was nonetheless researched. The judge says so; nothing
  // may be rewritten. This is the "Roman slave who conquered Egypt" case, where
  // 55 of 56 sentences were correctly unsupported and correcting them would
  // have replaced the film.
  const story = judged([UNSUPPORTED()], 'story');
  const out = runNode('FC Resolve.js', { json: story, nodes: { 'FC Prep': prepped(), 'FC Judge': story } });
  ok('a story is not checked at all', out.fc.storyMode === true && out.fc.run === false);
  ok('a story proposes no rewrite', out.fc.needsRewrite === false && out.fc.findings.length === 0);
  ok('a story keeps its narration', out.chapters.length === 2 && out.output === narration());
}
{
  // The backstop: the judge said `factual`, but almost nothing holds up.
  const many = [];
  for (let i = 0; i < 9; i += 1) many.push({ ...UNSUPPORTED(), quote: `Sentence ${i}.` });
  many.push(SUPPORTED());
  const narr = narration() + '\n\n' + many.map((f) => f.quote).join(' ');
  const wide = judged(many);
  const out = runNode('FC Resolve.js', {
    json: wide,
    nodes: { 'FC Prep': prepped({ narration: narr }), 'FC Judge': wide },
  });
  ok('an overwhelming share of failures stops the rewrite', out.fc.overwhelmed === true && out.fc.needsRewrite === false);
  ok('but every finding is still reported', out.fc.findings.length === 10);
}
{
  // Four bad sentences in twenty is a real problem, not an overwhelmed check.
  const some = [];
  for (let i = 0; i < 4; i += 1) some.push({ ...UNSUPPORTED(), quote: `Bad ${i}.` });
  for (let i = 0; i < 16; i += 1) some.push({ ...SUPPORTED(), quote: `Good ${i}.` });
  const narr = narration() + '\n\n' + some.map((f) => f.quote).join(' ');
  const few = judged(some);
  const out = runNode('FC Resolve.js', {
    json: few,
    nodes: { 'FC Prep': prepped({ narration: narr }), 'FC Judge': few },
  });
  ok('a documentary with a handful of errors is still rewritten', out.fc.overwhelmed === false && out.fc.needsRewrite === true);
}
{
  // ONE SENTENCE, THREE PROBLEMS — the shape the judge started returning on
  // 2026-09-19, after the producer found that "Google bought ZipDash after
  // buying Where 2 and Keyhole" was marked supported because two of its three
  // assertions were. Everything here that measures the SCRIPT must count the
  // sentence once; everything that measures the CHECK counts three.
  const q = 'Lars and Jens led the team into launch.';
  const three = [
    { ...UNSUPPORTED(), quote: q, claim: 'Lars led the team.', reason: 'No claim names a leader.' },
    { ...UNSUPPORTED(), quote: q, claim: 'Jens led the team.', reason: 'No claim names a leader.' },
    { ...UNSUPPORTED(), quote: q, claim: 'They led it through to launch.', reason: 'No claim covers the period.' },
    SUPPORTED(),
  ];
  const j = judged(three);
  const out = runNode('FC Resolve.js', { json: j, nodes: { 'FC Prep': prepped(), 'FC Judge': j } });

  ok('every assertion of a compound sentence is reported', out.fc.findings.length === 4);
  ok('but the sentence is counted once', out.fc.sentences === 2 && out.fc.badSentences === 1);

  // The fix list is what the rewrite is instructed from. Two entries for one
  // sentence would ask for it to be rewritten twice, the second rewrite blind
  // to the first — so the three problems arrive under ONE numbered sentence.
  const entries = out.fc.fixList.split('\n\n');
  ok('the fix list names the sentence once', entries.length === 1 && entries[0].startsWith('1. SENTENCE: ' + q));
  ok('and carries all three problems under it', ['Lars led the team.', 'Jens led the team.', 'They led it through to launch.'].every((c) => out.fc.fixList.includes(c)));
  ok('and says there is more than one', out.fc.fixList.includes('3 separate problems'));
}
{
  // The backstop must not trip on a script whose sentences are merely being
  // sliced finely. Two bad sentences out of twelve is 17% however many
  // assertions the judge draws out of them — counting findings, the same film
  // would read as 6 of 16, which is close enough to the threshold that a
  // slightly chattier judge would start silently refusing to correct films.
  const dense = [];
  for (let i = 0; i < 2; i += 1) {
    for (let k = 0; k < 3; k += 1) dense.push({ ...UNSUPPORTED(), quote: `Bad ${i}.`, claim: `Bad ${i} part ${k}.` });
  }
  for (let i = 0; i < 10; i += 1) dense.push({ ...SUPPORTED(), quote: `Good ${i}.` });
  const narr = narration() + '\n\n' + dense.map((f) => f.quote).join(' ');
  const j = judged(dense);
  const out = runNode('FC Resolve.js', { json: j, nodes: { 'FC Prep': prepped({ narration: narr }), 'FC Judge': j } });
  ok('a finely sliced sentence does not overwhelm the check', out.fc.overwhelmed === false && out.fc.needsRewrite === true);
  ok('and the sentence count is what was measured', out.fc.sentences === 12 && out.fc.badSentences === 2);
}

// ---------------------------------------------------------------------------
// FC Apply — the safety valve
// ---------------------------------------------------------------------------

console.log('FC Apply');

const resolved = (findings, needsRewrite = true) => ({
  ...guard(),
  fc: { ...prepped().fc, findings, needsRewrite, searched: 0, fixList: 'x' },
});

const FIXED_CH1 = 'Google acquired Where 2 Technologies in October 2004. Google said the brothers stayed with the project through launch.';

{
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: {
      'FC Resolve': resolved([{ ...SUPPORTED(), action: 'keep' }, { ...UNSUPPORTED(), action: 'rewrite' }]),
      'FC Rewrite': {
        output: {
          chapters: [
            { chapter_number: 1, chapter_title: 'The acquisition', narrator_script: FIXED_CH1 },
            { chapter_number: 2, chapter_title: 'Launch', narrator_script: CH2 },
          ],
        },
      },
    },
  });
  ok('accepts a clean rewrite', out.chapters[0].narrator_script === FIXED_CH1);
  ok('leaves the untouched chapter alone', out.chapters[1].narrator_script === CH2);
  ok('rebuilds `output` from the chapters that now exist', out.output.includes(FIXED_CH1));
  ok('emits the Narration Guard shape', out.retry === false && typeof out.words === 'number' && out.target === 30);
  ok('reports the sentence as rewritten', out.fcReport.rewritten === 1 && out.fcReport.findings[1].action === 'rewritten');
  ok('reports the supported one as kept', out.fcReport.findings[0].action === 'kept');
  ok('base64 round-trips to the same report', JSON.parse(Buffer.from(out.fcReport64, 'base64').toString('utf8')).rewritten === 1);
}
{
  // ONE SENTENCE FIXED IS ONE CORRECTION, however many assertions were wrong
  // in it. All three findings stop matching the moment the sentence changes,
  // so counting findings would tell the producer "3 corrected" about a single
  // edit — three sentences to go and reread, two of which do not exist.
  const q = 'Lars and Jens led the team into launch.';
  const three = ['Lars led the team.', 'Jens led the team.', 'They led it through to launch.'].map((claim) => ({
    ...UNSUPPORTED(),
    quote: q,
    claim,
    action: 'rewrite',
  }));
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: {
      'FC Resolve': { ...resolved([...three, { ...SUPPORTED(), action: 'keep' }]), fc: { ...prepped().fc, findings: [...three, { ...SUPPORTED(), action: 'keep' }], needsRewrite: true, searched: 0, fixList: 'x', sentences: 2 } },
      'FC Rewrite': {
        output: {
          chapters: [
            { chapter_number: 1, chapter_title: 'The acquisition', narrator_script: FIXED_CH1 },
            { chapter_number: 2, chapter_title: 'Launch', narrator_script: CH2 },
          ],
        },
      },
    },
  });
  ok('one corrected sentence is reported as one correction', out.fcReport.rewritten === 1);
  ok('while every assertion is still listed', out.fcReport.checked === 4 && out.fcReport.flagged === 3);
  ok('and the report says how many sentences those came from', out.fcReport.sentences === 2);
  ok('each assertion of the fixed sentence reads as rewritten', out.fcReport.findings.slice(0, 3).every((f) => f.action === 'rewritten'));
  ok('and carries the claim that distinguishes it', out.fcReport.findings[1].claim === 'Jens led the team.');
}
{
  // The rewrite tidied a chapter nobody asked it to touch.
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: {
      'FC Resolve': resolved([{ ...UNSUPPORTED(), action: 'rewrite' }]),
      'FC Rewrite': {
        output: {
          chapters: [
            { chapter_number: 1, chapter_title: 'The acquisition', narrator_script: FIXED_CH1 },
            { chapter_number: 2, chapter_title: 'Launch', narrator_script: CH2.replace('February', 'early') },
          ],
        },
      },
    },
  });
  ok('refuses a rewrite that changed an unflagged chapter', out.chapters[0].narrator_script === CH1);
  ok('and says so in the report', /nothing flagged in it/.test(out.fcReport.refused || ''));
  ok('and reports the sentence as still flagged', out.fcReport.findings[0].action === 'flagged');
}
{
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: {
      'FC Resolve': resolved([{ ...UNSUPPORTED(), action: 'rewrite' }]),
      'FC Rewrite': { output: { chapters: [{ chapter_number: 1, chapter_title: 'x', narrator_script: FIXED_CH1 }] } },
    },
  });
  ok('refuses a rewrite that lost a chapter', out.chapters.length === 2 && out.chapters[0].narrator_script === CH1);
}
{
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: {
      'FC Resolve': resolved([{ ...UNSUPPORTED(), action: 'rewrite' }]),
      'FC Rewrite': {
        output: {
          chapters: [
            { chapter_number: 1, chapter_title: 'The acquisition', narrator_script: 'Google bought it.' },
            { chapter_number: 2, chapter_title: 'Launch', narrator_script: CH2 },
          ],
        },
      },
    },
  });
  ok('refuses a rewrite that gutted a chapter', out.chapters[0].narrator_script === CH1);
  ok('and says it reads as a re-telling, not a correction', /lost more than half its words/.test(out.fcReport.refused || ''));
}
{
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: {
      'FC Resolve': resolved([{ ...UNSUPPORTED(), action: 'rewrite' }]),
      'FC Rewrite': {
        output: {
          chapters: [
            { chapter_number: 1, chapter_title: 'The acquisition', narrator_script: '   ' },
            { chapter_number: 2, chapter_title: 'Launch', narrator_script: CH2 },
          ],
        },
      },
    },
  });
  ok('refuses an empty chapter', out.chapters[0].narrator_script === CH1);
}
{
  // The agent errored out (onError: continueRegularOutput), so there is no
  // proposal at all. The draft must survive untouched.
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: { 'FC Resolve': resolved([{ ...UNSUPPORTED(), action: 'rewrite' }]) },
  });
  ok('an absent rewrite keeps the original', out.chapters[0].narrator_script === CH1);
  ok('and is reported as a refusal, not a fix', out.fcReport.rewritten === 0 && out.fcReport.findings[0].action === 'flagged');
}
{
  // Nothing was flagged: the chain must be a pass-through.
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: { 'FC Resolve': resolved([{ ...SUPPORTED(), action: 'keep' }], false) },
  });
  ok('passes a clean script through unchanged', out.chapters[0].narrator_script === CH1 && out.output === narration());
  ok('reports it as checked and clean', out.fcReport.checked === 1 && out.fcReport.flagged === 0);
}
{
  // REACHED STRAIGHT FROM THE GATE, with no FC Resolve in the run at all.
  // This is the path a skipped film takes, and until 2026-09-18 evening it
  // bypassed the report writer entirely — so `skipCode` never reached the
  // database and "no row" meant both "a Story film" and "the chain is dead".
  const skipped = {
    ...guard(),
    fc: { run: false, category: 'story', skipCode: 'not-documentary', skipped: 'Story mode', findings: [], needsRewrite: false },
  };
  const out = runNode('FC Apply.js', { json: {}, nodes: { 'FC Prep': skipped } });
  ok('reaches the report writer straight from the gate', out.fcReport.skipCode === 'not-documentary');
  ok('and hands the narration on untouched', out.chapters.length === 2 && out.output === narration());
  ok('and still produces something for the writer to save', typeof out.fcReport64 === 'string' && out.fcReport64.length > 0);
}
{
  // The bypass: a film the chain never ran on still has to arrive intact.
  const skipped = { ...guard(), fc: { run: false, skipped: 'no pack', findings: [], needsRewrite: false } };
  const out = runNode('FC Apply.js', { json: {}, nodes: { 'FC Resolve': skipped } });
  ok('a skipped film keeps its narration', out.chapters.length === 2 && out.output === narration());
  ok('and its report says why', out.fcReport.skipped === 'no pack' && out.fcReport.checked === 0);
  ok('a film with no pack is not labelled a story', out.fcReport.storyMode === undefined);
}
{
  const story = { ...guard(), fc: { run: false, storyMode: true, skipCode: 'story', skipped: 'it is a story', findings: [], needsRewrite: false } };
  const out = runNode('FC Apply.js', { json: {}, nodes: { 'FC Resolve': story } });
  ok('a story reaches the report as a story', out.fcReport.storyMode === true && out.fcReport.skipCode === 'story');
  ok('and its narration is untouched', out.output === narration());
}
{
  // Every skip carries its code to the report, because that is what the red
  // light reads — the prose beside it will be reworded, the code will not.
  for (const code of ['not-documentary', 'no-mode', 'not-researched', 'no-pack', 'no-chapters']) {
    const skipped = { ...guard(), fc: { run: false, category: 'story', skipCode: code, skipped: 'x', findings: [], needsRewrite: false } };
    const out = runNode('FC Apply.js', { json: {}, nodes: { 'FC Resolve': skipped } });
    ok(`the report carries skipCode ${code}`, out.fcReport.skipCode === code);
  }
  const noCode = { ...guard(), fc: { run: false, skipped: 'x', findings: [], needsRewrite: false } };
  const out = runNode('FC Apply.js', { json: {}, nodes: { 'FC Resolve': noCode } });
  ok('a skip with no code reads as "unknown", never as normal', out.fcReport.skipCode === 'unknown');
}
{
  const ran = runNode('FC Apply.js', {
    json: {},
    nodes: { 'FC Resolve': resolved([{ ...SUPPORTED(), action: 'keep' }], false) },
  });
  ok('a report that ran carries the mode and no skipCode', ran.fcReport.category === 'documentary' && ran.fcReport.skipCode === undefined);
}
{
  // Overwhelmed: findings still say `rewrite`, but nothing may be applied.
  const wide = {
    ...guard(),
    fc: { ...prepped().fc, overwhelmed: true, needsRewrite: false, searched: 0, findings: [{ ...UNSUPPORTED(), action: 'rewrite' }] },
  };
  const out = runNode('FC Apply.js', { json: {}, nodes: { 'FC Resolve': wide } });
  ok('an overwhelmed check changes nothing', out.chapters[0].narrator_script === CH1);
  ok('and says so in the report', out.fcReport.overwhelmed === true && out.fcReport.rewritten === 0);
  ok('and still lists what it found', out.fcReport.findings.length === 1 && out.fcReport.findings[0].action === 'flagged');
}

// ---------------------------------------------------------------------------
// FC Done
// ---------------------------------------------------------------------------

console.log('FC Done');
{
  const applied = { output: 'x', retry: false, chapters: chapters(), words: 30, fcReport: {}, fcReport64: '' };
  const out = runNode('FC Done.js', { json: { project_id: 'rec1' }, nodes: { 'FC Apply': applied } });
  ok('restores the narration after the Postgres writer', out.chapters.length === 2 && out.output === 'x');
}

// ---------------------------------------------------------------------------
// The report writer's query
// ---------------------------------------------------------------------------

console.log('FC Save Report');
{
  const sql = readFileSync(join(PASTE, 'FC Save Report.sql'), 'utf8');
  ok('decodes the report in Postgres rather than inlining prose', sql.includes("decode('{{ $json.fcReport64 }}', 'base64')"));
  ok('never interpolates the report itself into the statement', !sql.includes('$json.fcReport }}'));
  ok('upserts on the project', /on conflict \(project_id\) do update/.test(sql));
}

// ---------------------------------------------------------------------------
// The re-run chain — `deep-search-rerun`, the button on the script gate
// ---------------------------------------------------------------------------

console.log('DS Prep');

// The row `DS Load` hands over: one project, one script, the pack as JSON.
const DS_HOOK = 'Lars faced a deadline in 2003.\nThe Sydney team held just four members.';
const DS_CH1 = 'The map went live in February 2005.';
const DS_SCRIPT = `[CHAPTER 0: HOOK]\n${DS_HOOK}\n\n[CHAPTER 1: Launch]\n${DS_CH1}`;

const dsRow = (over = {}) => ({
  project_id: 'rec1',
  project_name: 'A film',
  editing_options: JSON.stringify({
    category: 'documentary',
    sfx: true,
    // The hook's SPOKEN copy. One line per shot, and the copy the render reads.
    hookPlan: { style: 'question', beats: DS_HOOK.split('\n') },
  }),
  script: DS_SCRIPT,
  scene_count: 0,
  claims: [{ ref: 'E1', claim: 'c', source: 's', date: '2004', url: 'u' }],
  ...over,
});

{
  const out = runNode('DS Prep.js', { json: dsRow(), dir: DS });
  ok('runs on a documentary with a script and a pack', out.fc.run === true);
  // THE WHOLE REASON THIS CHAIN EXISTS. `hov.script.content` carries the hook,
  // which `Generate Hook` writes after the first pass has already finished, so
  // the re-run is the only thing that ever reads it. If this ever stops being
  // true the button is checking the same text twice.
  ok('the narration it checks INCLUDES the hook', out.fc.narration.includes('[CHAPTER 0: HOOK]'));
  ok('and is the script verbatim, not a rebuild', out.fc.narration === dsRow().script);
  ok('emits under `fc`, so the FC prompts work unchanged', typeof out.fc.packList === 'string' && out.fc.packList.startsWith('E1. c ['));
  ok('carries the project id for the writer', out.projectId === 'rec1');
  // The rewrite works on chapters, and the re-run only has the assembled text.
  ok('parses the script back into chapters, hook first', out.chapters.length === 2 && out.chapters[0].chapter_number === 0 && out.chapters[0].chapter_title === 'HOOK');
  ok('and keeps each chapter body verbatim', out.chapters[1].narrator_script === DS_CH1);
  // The whole Editing Options object rides along, because the hook's SPOKEN
  // copy lives in it and `DS Apply` has to hand it back with the beats moved.
  ok('carries Editing Options through for the hook beats', out.editing.category === 'documentary' && out.editing.sfx === true);
}
{
  // PAST THE SCRIPT GATE THE RE-RUN REPORTS AND DOES NOT EDIT. At the gate the
  // film has no scenes, so the script text is the only thing derived from the
  // narration; once scenes exist they carry their own copy of every line and
  // their own recordings, and editing under them is the drift fault.
  const gate = runNode('DS Prep.js', { json: dsRow(), dir: DS });
  ok('may rewrite at the script gate, where there are no scenes', gate.fc.mayRewrite === true && gate.fc.sceneCount === 0);
  const later = runNode('DS Prep.js', { json: dsRow({ scene_count: 42 }), dir: DS });
  ok('and refuses to once the scenes exist', later.fc.mayRewrite === false && later.fc.sceneCount === 42);
  ok('while still running the check itself', later.fc.run === true);
}
{
  for (const [over, code] of [
    [{ editing_options: JSON.stringify({ category: 'story' }) }, 'not-documentary'],
    [{ editing_options: '{}' }, 'no-mode'],
    [{ script: '' }, 'no-script'],
    [{ claims: [] }, 'no-pack'],
  ]) {
    const out = runNode('DS Prep.js', { json: dsRow(over), dir: DS });
    ok(`skips as ${code}`, out.fc.run === false && out.fc.skipCode === code);
  }
}

console.log('DS Resolve');

const dsChapters = () => [
  { chapter_number: 0, chapter_title: 'HOOK', narrator_script: DS_HOOK },
  { chapter_number: 1, chapter_title: 'Launch', narrator_script: DS_CH1 },
];

const dsPrepped = (over = {}) => ({
  chapters: dsChapters(),
  fc: {
    run: true,
    category: 'documentary',
    skipCode: null,
    packList: 'E1. c [s, 2004 — u]',
    narration: DS_SCRIPT,
    originalWords: DS_SCRIPT.split(/\s+/).filter(Boolean).length,
    mayRewrite: true,
    sceneCount: 0,
    ...over,
  },
  editing: JSON.parse(dsRow().editing_options),
  projectId: 'rec1',
  projectName: 'A film',
});

const DS_BAD = 'Lars faced a deadline in 2003.';
const DS_GOOD = DS_CH1;

const dsFindings = () => [
  { quote: DS_BAD, claim: 'Lars faced a deadline in 2003.', verdict: 'unsupported', ref: '', reason: 'No claim mentions a deadline.' },
  { quote: DS_GOOD, claim: 'The map went live in February 2005.', verdict: 'supported', ref: 'E1', reason: 'E1 states it.' },
];

const dsResolve = (findings, prepOver = {}, mode = 'factual') => {
  const judged = { output: { mode, findings } };
  return runNode('DS Resolve.js', {
    json: judged,
    nodes: { 'DS Prep': dsPrepped(prepOver), 'DS Judge': judged },
    dir: DS,
  });
};

{
  const out = dsResolve(dsFindings());
  ok('keeps both statements and settles their verdicts', out.fc.findings.length === 2 && out.fc.sentences === 2);
  // THE PRODUCER ASKED FOR THE BUTTON TO FIX WHAT IT FINDS, not only to report
  // it, so unlike the first design of this chain a flagged sentence must reach
  // the rewrite. `needsRewrite` is what `DS Fix?` branches on.
  ok('sends the unsupported sentence to the rewrite', out.fc.needsRewrite === true && out.fc.badSentences === 1);
  ok('and never sends the supported one', out.fc.findings.find((f) => f.quote === DS_GOOD).action === 'keep');
  ok('names the sentence and the problem in the fix list', out.fc.fixList.includes(DS_BAD) && out.fc.fixList.includes('nothing we can cite supports this'));
  ok('carries the chapters through for the rewrite to work on', out.chapters.length === 2);
  ok('and the Editing Options, for the hook beats', out.editing.hookPlan.beats.length === 2);
}
{
  // A quote the judge did not copy verbatim is dropped, same as the first pass.
  const out = dsResolve([{ quote: 'A sentence that is not in the script.', claim: 'x', verdict: 'unsupported', ref: '', reason: 'r' }]);
  ok('drops a finding whose quote is not in the script', out.fc.findings.length === 0 && out.fc.needsRewrite === false);
}
{
  // The inner gate still applies: a documentary whose narration is a
  // dramatisation is reported as a story, not as a film full of errors.
  const out = dsResolve(dsFindings(), {}, 'story');
  ok('a story is flagged as a story and rewrites nothing', out.fc.storyMode === true && out.fc.needsRewrite === false);
}
{
  // PAST APPROVAL: checked in full, reported in full, and not edited — because
  // the scenes carry their own copy of every line and their own recordings.
  const out = dsResolve(dsFindings(), { mayRewrite: false, sceneCount: 42 });
  ok('a film with scenes is reported, not rewritten', out.fc.frozen === true && out.fc.needsRewrite === false);
  ok('and the finding still reaches the producer', out.fc.findings.length === 2);
}
{
  // THE BACKSTOP. Most of the film failing is a check aimed at the wrong thing,
  // not a film that is mostly wrong — and rewriting at that volume replaces the
  // producer's script rather than correcting it. Counted in SENTENCES.
  const many = [];
  for (let i = 1; i <= 10; i += 1) many.push({ quote: DS_BAD, claim: 'claim ' + i, verdict: 'unsupported', ref: '', reason: 'r' });
  const out = dsResolve(many);
  ok('ten findings on one sentence are one sentence, not a flood', out.fc.sentences === 1 && out.fc.overwhelmed === false);
  ok('and are listed once, as several problems in one rewrite', (out.fc.fixList.match(/SENTENCE:/g) || []).length === 1 && out.fc.fixList.includes('10 separate problems'));
}
{
  const narr = Array.from({ length: 10 }, (_, i) => `Sentence number ${i + 1} here.`).join(' ');
  const findings = Array.from({ length: 10 }, (_, i) => ({
    quote: `Sentence number ${i + 1} here.`,
    claim: 'c',
    verdict: i < 7 ? 'unsupported' : 'supported',
    ref: '',
    reason: 'r',
  }));
  const judged = { output: { mode: 'factual', findings } };
  const out = runNode('DS Resolve.js', {
    json: judged,
    nodes: { 'DS Prep': dsPrepped({ narration: narr }), 'DS Judge': judged },
    dir: DS,
  });
  ok('seven of ten sentences unsupported stops the rewrite', out.fc.overwhelmed === true && out.fc.needsRewrite === false);
}
{
  // The gate said no upstream, so `DS Judge` never ran and its reference
  // throws — the payload must still come through, with the reason.
  const out = runNode('DS Resolve.js', {
    json: {},
    nodes: { 'DS Prep': dsPrepped({ run: false, skipCode: 'not-documentary', skipped: 'Story mode.' }) },
    dir: DS,
  });
  ok('a skipped re-run still carries its reason forward', out.fc.skipCode === 'not-documentary' && out.fc.needsRewrite === false);
}

console.log('DS Apply');

const dsApply = (resolved, rewrite) =>
  runNode('DS Apply.js', {
    json: {},
    nodes: rewrite ? { 'DS Resolve': resolved, 'DS Rewrite': rewrite } : { 'DS Resolve': resolved },
    dir: DS,
  });

const DS_FIXED_HOOK = 'Lars faced a hard problem in 2003.\nThe Sydney team held just four members.';

{
  // THE ROUND TRIP, and the most load-bearing assertion in this section. The
  // re-run reassembles the script from chapters it parsed out of the script,
  // so a reassembly that drifted by one newline would rewrite EVERY film it
  // touched — including the clean ones, where `DS Write` must do nothing.
  const clean = dsResolve([dsFindings()[1]]);
  const out = dsApply(clean);
  ok('a clean re-run reassembles the script byte for byte', out.script === DS_SCRIPT);
  ok('and says so, so `DS Write` touches no row', out.scriptChanged === false && out.hookChanged === false);
  ok('claims no correction it did not make', out.fcReport.rewritten === 0 && out.fcReport.findings.every((f) => f.action === 'kept'));
  ok('marks itself a re-run of the FINISHED script', out.fcReport.rerun === true && out.fcReport.scope === 'final');
  ok('base64 round-trips for all three writers', Buffer.from(out.script64, 'base64').toString('utf8') === DS_SCRIPT && JSON.parse(Buffer.from(out.fcReport64, 'base64').toString('utf8')).rerun === true && JSON.parse(Buffer.from(out.editing64, 'base64').toString('utf8')).category === 'documentary');
}
{
  const resolved = dsResolve(dsFindings());
  const out = dsApply(resolved, {
    output: {
      chapters: [
        { chapter_number: 0, narrator_script: DS_FIXED_HOOK },
        { chapter_number: 1, narrator_script: DS_CH1 },
      ],
    },
  });
  ok('accepts a correction of the flagged sentence', out.fcReport.refused === undefined && out.script.includes('a hard problem in 2003'));
  ok('and the old sentence is gone', !out.script.includes(DS_BAD));
  ok('counts it as one corrected sentence', out.fcReport.rewritten === 1 && out.fcReport.findings.find((f) => f.quote === DS_BAD).action === 'rewritten');
  ok('leaves the supported sentence alone', out.script.includes(DS_CH1));
  ok('says the script changed, so the row is written', out.scriptChanged === true);
  // THE HOOK LIVES TWICE. `hov.script.content` carries it as text and
  // `Editing Options.hookPlan.beats` carries the same lines again — and THAT is
  // the copy the render speaks. Fixing one and not the other shows a corrected
  // hook on the panel while the film still says the old one.
  ok('moves the hook\'s spoken copy with it', out.hookChanged === true && out.fcReport.hookFixed === true);
  const beats = JSON.parse(Buffer.from(out.editing64, 'base64').toString('utf8')).hookPlan.beats;
  ok('one beat per line, in order, corrected', beats.length === 2 && beats[0] === 'Lars faced a hard problem in 2003.' && beats[1] === 'The Sydney team held just four members.');
  ok('and nothing else in Editing Options moved', JSON.parse(Buffer.from(out.editing64, 'base64').toString('utf8')).sfx === true);
}
{
  // THE HOOK IS CUT ONE SHOT PER LINE. A correction that merges two of its
  // lines silently drops a shot from the film, so the whole rewrite is refused
  // rather than half-applied.
  const resolved = dsResolve(dsFindings());
  const out = dsApply(resolved, {
    output: {
      chapters: [
        { chapter_number: 0, narrator_script: 'Lars faced a hard problem and the Sydney team held four members.' },
        { chapter_number: 1, narrator_script: DS_CH1 },
      ],
    },
  });
  ok('refuses a rewrite that merges two hook lines', /hook went from 2 lines to 1/.test(out.fcReport.refused || ''));
  ok('and keeps the script exactly as it was', out.script === DS_SCRIPT && out.scriptChanged === false);
  ok('the finding then reads as flagged, not corrected', out.fcReport.rewritten === 0 && out.fcReport.findings.find((f) => f.quote === DS_BAD).action === 'flagged');
}
{
  for (const [label, chapters, pattern] of [
    ['no chapters at all', [], /returned no chapters/],
    ['a chapter short', [{ chapter_number: 0, narrator_script: DS_HOOK }], /returned 1 chapters for 2/],
    ['a chapter renumbered', [{ chapter_number: 0, narrator_script: DS_HOOK }, { chapter_number: 9, narrator_script: DS_CH1 }], /chapter 1 is missing/],
    ['a chapter emptied', [{ chapter_number: 0, narrator_script: DS_HOOK }, { chapter_number: 1, narrator_script: '' }], /chapter 1 came back empty/],
    ['a chapter re-told', [{ chapter_number: 0, narrator_script: 'Lars.' }, { chapter_number: 1, narrator_script: DS_CH1 }], /chapter 0 lost more than half its words/],
    ['a clean chapter edited', [{ chapter_number: 0, narrator_script: DS_FIXED_HOOK }, { chapter_number: 1, narrator_script: 'The map went live in February 2006.' }], /chapter 1 was changed but had nothing flagged/],
  ]) {
    // A FRESH `resolved` EACH TIME. `DS Apply` settles each finding's `action`
    // in place on the item it read, so a reused fixture would arrive with
    // nothing left marked `rewrite` and refuse for the wrong reason. In a real
    // run the node executes once, which is why this is a harness concern only.
    const out = dsApply(dsResolve(dsFindings()), { output: { chapters } });
    ok(`refuses ${label}`, pattern.test(out.fcReport.refused || ''), out.fcReport.refused);
    ok(`  and keeps the script that exists`, out.script === DS_SCRIPT && out.scriptChanged === false);
  }
}
{
  // The rewrite node never ran at all — `DS Fix?`[1] went straight here.
  const resolved = dsResolve(dsFindings(), { mayRewrite: false, sceneCount: 42 });
  const out = dsApply(resolved);
  ok('a frozen film keeps its script and says why', out.script === DS_SCRIPT && out.fcReport.frozen === true);
  ok('and its findings read as flagged', out.fcReport.findings.find((f) => f.quote === DS_BAD).action === 'flagged');
  ok('with nothing claimed as corrected', out.fcReport.rewritten === 0);
}
{
  const resolved = runNode('DS Resolve.js', {
    json: {},
    nodes: { 'DS Prep': dsPrepped({ run: false, skipCode: 'not-documentary', skipped: 'Story mode.' }) },
    dir: DS,
  });
  const out = dsApply(resolved);
  ok('a skipped re-run still writes its row', out.fcReport.skipCode === 'not-documentary' && out.fcReport.checked === 0);
  ok('and is still marked a re-run', out.fcReport.rerun === true && out.fcReport.scope === 'final');
  ok('and writes no script', out.scriptChanged === false && out.hookChanged === false);
}

console.log('FC — a correction is allowed to make the film shorter');

// THE REAL FILM THIS COMES FROM. On 2026-09-23 the producer's Google Maps
// documentary had five unsourceable statements in an eleven-sentence script.
// The rewrite cut them, 178 words became 128, and the whole correction was
// thrown away by a symmetric +/-20% band — so the producer kept all five.
// `Narration Guard` settled the principle for the project on 2026-09-13:
// "a film shorter than ordered is correct". This is that, applied here.
{
  // A third of the chapter goes, because a third of it was unsourceable.
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: {
      'FC Prep': prepped(),
      'FC Resolve': resolved([{ ...UNSUPPORTED(), action: 'rewrite' }]),
      'FC Rewrite': {
        output: {
          chapters: [
            { chapter_number: 1, chapter_title: 'The acquisition', narrator_script: 'Google acquired Where 2 Technologies in October 2004.' },
            { chapter_number: 2, chapter_title: 'Launch', narrator_script: CH2 },
          ],
        },
      },
    },
  });
  ok('a correction that shortens a chapter is ACCEPTED', out.fcReport.refused === undefined);
  ok('and the unsourced sentence is gone', !out.output.includes('Lars and Jens led the team into launch.'));
  ok('while the sourced one stays', out.output.includes('Google acquired Where 2 Technologies in October 2004.'));
}
{
  // Padding is still refused. A rewrite may never GROW a chapter — that is how
  // the narration used to reach a word count, and it is what made the film say
  // the same thing four times.
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: {
      'FC Prep': prepped(),
      'FC Resolve': resolved([{ ...UNSUPPORTED(), action: 'rewrite' }]),
      'FC Rewrite': {
        output: {
          chapters: [
            { chapter_number: 1, chapter_title: 'The acquisition', narrator_script: CH1 + ' ' + CH1 + ' ' + CH1 },
            { chapter_number: 2, chapter_title: 'Launch', narrator_script: CH2 },
          ],
        },
      },
    },
  });
  ok('a rewrite that PADS a chapter is still refused', /grew from \d+ to \d+ words/.test(out.fcReport.refused || ''));
}
{
  // Shorter is allowed; SILENTLY shorter is not. The word count decides the
  // runtime and the scene count, so a film whose research cannot fill its
  // running time has to say so — the answer is more research or a shorter
  // film, and neither is this chain's to choose.
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: {
      'FC Prep': prepped(),
      'FC Resolve': resolved([{ ...UNSUPPORTED(), action: 'rewrite' }]),
      'FC Rewrite': {
        output: {
          chapters: [
            { chapter_number: 1, chapter_title: 'The acquisition', narrator_script: 'Google acquired Where 2 Technologies in October 2004.' },
            { chapter_number: 2, chapter_title: 'Launch', narrator_script: CH2 },
          ],
        },
      },
    },
  });
  ok('going under the film\'s ordered length is RECORDED', out.fcReport.short && out.fcReport.short.min === 27);
  ok('and names what it now weighs', out.fcReport.short.words < 27 && out.fcReport.short.words > 0);
  ok('but is never a refusal', out.fcReport.refused === undefined);
}
{
  // A film that stays long enough says nothing about length at all, so an
  // ordinary correction does not raise a false alarm.
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: {
      'FC Prep': prepped(),
      'FC Resolve': resolved([{ ...UNSUPPORTED(), action: 'rewrite' }]),
      'FC Rewrite': {
        output: {
          chapters: [
            { chapter_number: 1, chapter_title: 'The acquisition', narrator_script: CH1.replace('Lars and Jens led the team into launch.', 'Google said the team led it into launch.') },
            { chapter_number: 2, chapter_title: 'Launch', narrator_script: CH2 },
          ],
        },
      },
    },
  });
  ok('a film still at its length says nothing about it', out.fcReport.short === undefined);
}
{
  // The rewrite never ran, so there is nothing to be short ABOUT — `short`
  // describes a correction that landed, not a script that arrived thin.
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: { 'FC Prep': prepped(), 'FC Resolve': resolved([{ ...UNSUPPORTED(), action: 'rewrite' }]) },
  });
  ok('a refused rewrite reports no shortness', out.fcReport.short === undefined);
}

console.log('DS — a sentence the narration already made');

// THE FAULT THIS CHAIN CAUSED. Four presses of the re-check turned one film
// into a script that announced the same product launch four times: the rewrite
// was told to keep each chapter's length and to use only the claims, so every
// pass replaced an unsourced sentence with the best-sourced fact it had — the
// one the previous sentence already carried. `redundant` is how the judge says
// so, and `cut` is what becomes of the sentence.
//
// A LOCAL FIXTURE, because a duplicate has to sit ALONGSIDE other sentences to
// be a realistic one. The shared fixture's chapter 1 is a single sentence, and
// a chapter whose whole body is the repeat is a different case — covered at
// the end of this section.
const DUP = 'The map went live in February 2005.';
const DUP_KEEP = 'Google announced Google Local on March 17, 2004.';
// A REAL CLOSING LINE, so the duplicate under test sits in the MIDDLE of the
// chapter. Put the repeat last and it is spared as a bookend — which is the
// rule below, and would quietly stop every other case here from testing what
// it says it tests.
const DUP_CLOSE = 'The whole web could be dragged at last.';
const DUP_CH1 = DUP_KEEP + ' ' + DUP + ' ' + DUP_CLOSE;
const DUP_SCRIPT = `[CHAPTER 0: HOOK]\n${DS_HOOK}\n\n[CHAPTER 1: Launch]\n${DUP_CH1}`;

const dupPrepped = (over = {}) => ({
  chapters: [
    { chapter_number: 0, chapter_title: 'HOOK', narrator_script: DS_HOOK },
    { chapter_number: 1, chapter_title: 'Launch', narrator_script: DUP_CH1 },
  ],
  fc: {
    run: true,
    category: 'documentary',
    skipCode: null,
    packList: 'E1. c [s, 2004 — u]',
    narration: DUP_SCRIPT,
    originalWords: DUP_SCRIPT.split(/\s+/).filter(Boolean).length,
    mayRewrite: true,
    sceneCount: 0,
    // Generous by default, so the budget is not what the other cases are
    // measuring; the floor gets its own block below.
    lengthSeconds: 64,
    targetWords: 154,
    minWords: 10,
    bodyWords: DUP_CH1.split(/\s+/).filter(Boolean).length,
    closingSentence: DUP_CLOSE,
    ...over,
  },
  editing: JSON.parse(dsRow().editing_options),
  projectId: 'rec1',
  projectName: 'A film',
});

const dupFindings = () => [
  { quote: DS_BAD, claim: 'Lars faced a deadline in 2003.', verdict: 'unsupported', ref: '', reason: 'No claim mentions a deadline.' },
  { quote: DUP, claim: 'The map went live in February 2005.', verdict: 'redundant', ref: 'E1', reason: 'The hook already says the map went live in February 2005.' },
];

const dupResolve = (findings) => {
  const judged = { output: { mode: 'factual', findings } };
  return runNode('DS Resolve.js', {
    json: judged,
    nodes: { 'DS Prep': dupPrepped(), 'DS Judge': judged },
    dir: DS,
  });
};

{
  const out = dupResolve(dupFindings());
  ok('a repeat reaches the rewrite like any other problem', out.fc.needsRewrite === true);
  // The ladder's first three rungs all KEEP the sentence, which is exactly the
  // wrong outcome here — the viewer hears the same fact in a new costume. The
  // instruction has to be an imperative to delete, at the top of the entry.
  ok('and is told to be CUT, not reworded', /CUT THIS SENTENCE/.test(out.fc.fixList) && /delete the sentence, do not reword it/.test(out.fc.fixList));
  ok('while a genuine gap keeps its own wording', /nothing we can cite supports this/.test(out.fc.fixList));
  // `unsupported` is what routes a finding to the live web lookup. A repeat is
  // not a sourcing question — the sources back it — so a search would be a
  // wasted call AND could flip it to `supported`, losing the cut.
  ok('a repeat is never sent to the live source lookup', out.fc.findings.filter((f) => f.verdict === 'unsupported').length === 1);
}
{
  // The rewrite deletes the repeat and corrects the hook. Chapter 1 loses the
  // 7 words of the cut sentence — a third of it — which is outside the ±20%
  // band, so without the subtraction the guard would refuse a correct cut.
  const out = dsApply(dupResolve(dupFindings()), {
    output: {
      chapters: [
        { chapter_number: 0, narrator_script: DS_FIXED_HOOK },
        { chapter_number: 1, narrator_script: DUP_KEEP + ' ' + DUP_CLOSE },
      ],
    },
  });
  ok('the cut is accepted rather than refused as a re-telling', out.fcReport.refused === undefined);
  ok('and the repeated sentence is gone from the script', !out.script.includes(DUP));
  ok('while the sentence it duplicated stays', out.script.includes(DUP_KEEP));
  ok('the cut sentence reads as cut, not corrected', out.fcReport.findings.find((f) => f.quote === DUP).action === 'cut');
  ok('and is counted apart from the corrections', out.fcReport.deduped === 1 && out.fcReport.rewritten === 1);
  ok('the script is shorter, and says so', out.scriptChanged === true);
}
{
  // The guard must still bite on a chapter that was re-told rather than cut —
  // the subtraction is per chapter and per quote, so a chapter with nothing
  // marked redundant keeps the old band exactly.
  const out = dsApply(dupResolve(dupFindings()), {
    output: {
      chapters: [
        { chapter_number: 0, narrator_script: 'Lars.' },
        { chapter_number: 1, narrator_script: DUP_KEEP + ' ' + DUP_CLOSE },
      ],
    },
  });
  ok('a chapter with no cut still refuses a re-telling', /chapter 0 lost more than half its words/.test(out.fcReport.refused || ''));
}
{
  // Several findings can share one quote. Counting its words once per finding
  // would let the chapter shrink by a multiple of what was actually removed —
  // the same bug as counting findings where sentences were meant.
  const twice = [
    { quote: DUP, claim: 'the launch date', verdict: 'redundant', ref: 'E1', reason: 'already said' },
    { quote: DUP, claim: 'the launch itself', verdict: 'redundant', ref: 'E1', reason: 'already said' },
  ];
  const resolved = dupResolve(twice);
  ok('two findings on one repeated sentence list it once', (resolved.fc.fixList.match(/SENTENCE:/g) || []).length === 1);
  const out = dsApply(resolved, {
    output: {
      chapters: [
        { chapter_number: 0, narrator_script: DS_HOOK },
        { chapter_number: 1, narrator_script: DUP_KEEP + ' ' + DUP_CLOSE },
      ],
    },
  });
  ok('and it counts as one deletion, not two', out.fcReport.deduped === 1);
}
{
  // A chapter whose WHOLE body is the repeat cannot simply be emptied — a
  // chapter with no narration has no scenes and breaks the film's structure.
  // `FC Apply`'s empty-chapter refusal already covers it, and that is the
  // better error than a length one, so this pins WHICH refusal fires.
  const judged = { output: { mode: 'factual', findings: [{ quote: DS_CH1, claim: 'launch', verdict: 'redundant', ref: 'E1', reason: 'already said' }] } };
  const resolved = runNode('DS Resolve.js', {
    json: judged,
    nodes: { 'DS Prep': dsPrepped(), 'DS Judge': judged },
    dir: DS,
  });
  const out = dsApply(resolved, {
    output: {
      chapters: [
        { chapter_number: 0, narrator_script: DS_HOOK },
        { chapter_number: 1, narrator_script: '' },
      ],
    },
  });
  ok('a chapter that is nothing BUT the repeat cannot be emptied', /chapter 1 came back empty/.test(out.fcReport.refused || ''));
  ok('and the script is kept whole', out.script === DS_SCRIPT && out.scriptChanged === false);
}

console.log('DS — the floor the cuts cannot go under');

// EVERY OTHER GUARD IN THIS CHAIN IS PER PRESS. This one is not: it measures
// what the script weighs NOW against the floor `Narration Guard` derives from
// the length the producer ordered, so pressing the button ten times cannot
// take the film below it. Two presses took one chapter from 185 words to 101
// before this existed.
{
  // The film is ordered long enough that the repeat fits inside the budget.
  const out = dupResolve(dupFindings());
  ok('a repeat is cut when the film can spare the words', out.fc.needsRewrite === true && /CUT THIS SENTENCE/.test(out.fc.fixList));
  ok('and nothing says the budget was hit', out.fc.cutBudgetHit === undefined);
}
{
  // The same film, ordered so short that its narration is already at the
  // floor. The repeat is still FOUND and still reported — only the deletion
  // is withheld, because cutting it would make the film shorter than ordered.
  const judged = { output: { mode: 'factual', findings: dupFindings() } };
  const out = runNode('DS Resolve.js', {
    json: judged,
    nodes: { 'DS Prep': dupPrepped({ minWords: 200, bodyWords: 205 }), 'DS Judge': judged },
    dir: DS,
  });
  ok('a repeat that would breach the floor is NOT cut', !/CUT THIS SENTENCE/.test(out.fc.fixList));
  ok('and the run says so, rather than going quiet', out.fc.cutBudgetHit === true);
  ok('while the finding still reaches the producer', out.fc.findings.some((f) => f.verdict === 'redundant'));
  // The unsupported sentence is a correction, not a deletion: it does not
  // shorten the film, so the floor has no business stopping it.
  ok('and a genuine correction is unaffected by the floor', out.fc.needsRewrite === true && /nothing we can cite supports this/.test(out.fc.fixList));
}
{
  // The budget is spent per SENTENCE, not per finding — a compound sentence
  // arrives as several findings and must cost its words once.
  const twice = [
    { quote: DUP, claim: 'the date', verdict: 'redundant', ref: 'E1', reason: 'r' },
    { quote: DUP, claim: 'the launch', verdict: 'redundant', ref: 'E1', reason: 'r' },
  ];
  const judged = { output: { mode: 'factual', findings: twice } };
  const out = runNode('DS Resolve.js', {
    json: judged,
    nodes: { 'DS Prep': dupPrepped({ minWords: 10, bodyWords: 17 }), 'DS Judge': judged },
    dir: DS,
  });
  ok('one sentence costs its words once, however many findings it carries', /CUT THIS SENTENCE/.test(out.fc.fixList) && out.fc.cutBudgetHit === undefined);
}
{
  // A film with no stored length must still have its repeats cut. Failing
  // closed here would switch the feature off and look like a clean check.
  const judged = { output: { mode: 'factual', findings: dupFindings() } };
  const out = runNode('DS Resolve.js', {
    json: judged,
    nodes: { 'DS Prep': dupPrepped({ minWords: 0, bodyWords: 0 }), 'DS Judge': judged },
    dir: DS,
  });
  ok('no floor means no limit, not a limit of zero', /CUT THIS SENTENCE/.test(out.fc.fixList));
}
{
  // THE CLOSING LINE IS A BOOKEND. The dedupe removed one on its first
  // outing — "A four-person Sydney prototype had become a public product"
  // repeats the hook's four-person team, and repeating it is the point.
  const closing = [{ quote: DUP_CLOSE, claim: 'the web could be dragged', verdict: 'redundant', ref: 'E1', reason: 'the hook says this' }];
  const judged = { output: { mode: 'factual', findings: closing } };
  const out = runNode('DS Resolve.js', {
    json: judged,
    nodes: { 'DS Prep': dupPrepped(), 'DS Judge': judged },
    dir: DS,
  });
  ok('the last sentence of the last chapter is never cut', out.fc.needsRewrite === false && out.fc.closingSpared === true);
  ok('and it is still reported, so the producer can cut it by hand', out.fc.findings.length === 1);
}
{
  // THE HOOK IS A TEASER, so a hook line whose fact reappears below is doing
  // its job; the copy to cut is the one in the body. Cutting a hook line would
  // also cost more than the line — `DS Apply` refuses any rewrite that changes
  // the hook's line count, so it would throw away every other correction in
  // the same press.
  const inHook = [{ quote: 'Lars faced a deadline in 2003.', claim: 'the deadline', verdict: 'redundant', ref: 'E1', reason: 'said again below' }];
  const judged = { output: { mode: 'factual', findings: inHook } };
  const out = runNode('DS Resolve.js', {
    json: judged,
    nodes: { 'DS Prep': dupPrepped(), 'DS Judge': judged },
    dir: DS,
  });
  ok('a hook line is never cut', out.fc.needsRewrite === false && out.fc.hookSpared === true);
  ok('and is still reported', out.fc.findings.length === 1);
}

console.log('DS Prep — the floor it computes');
{
  const out = runNode('DS Prep.js', { json: dsRow({ length_seconds: 300 }), dir: DS });
  // Narration Guard: scenes = ceil(300/8) - 1 = 37; target = 37*22 = 814;
  // min = round(814*0.55) = 448. Copied arithmetic, asserted so the two
  // cannot drift into disagreeing about the same film.
  ok('it derives the length window exactly as Narration Guard does', out.fc.targetWords === 814 && out.fc.minWords === 448);
  ok('and measures the body WITHOUT the hook', out.fc.bodyWords === DS_CH1.split(/\s+/).filter(Boolean).length);
  ok('and names the closing line it will not cut', out.fc.closingSentence === DS_CH1);
}
{
  const out = runNode('DS Prep.js', { json: dsRow(), dir: DS });
  ok('a film with no stored length falls back to the guard default', out.fc.lengthSeconds === 64);
}

console.log('FC Judge — the rules it must still carry');

// The judge prompt is a PROMPT: nothing here proves the model obeys it. What
// these assertions do is stop a rule being lost in a later edit of an 18 KB
// file, which is the failure this project has actually had — a clause removed
// while adding a paragraph, noticed weeks later by a reader rather than a run.
{
  const judge = readFileSync(join(PASTE, 'FC Judge.txt'), 'utf8');
  const has = (needle) => judge.includes(needle);

  ok('a fourth verdict for a sentence the narration already made', has('`redundant`'));
  ok('a transition is its own assertion', has('A TRANSITION IS ITS OWN ASSERTION'));
  // 2026-09-23: the general form of that rule. The judge passed "gained the
  // scale it had lacked" while its own `claim` named the comparison and its
  // own `reason` covered only half of it.
  ok('and so is every other relationship', has('the RELATIONSHIP the sentence asserts between them'));
  ok('with the before-and-after named as the sharpest case', has('BEFORE-AND-AFTER'));
  ok('and the self-check that catches it', has('When your reason covers less than your claim says, the verdict is unsupported'));
  for (const kind of ['COMPARISON and CHANGE OF STATE', 'INTENTION and MOTIVE', 'LIMITATION and INABILITY', 'CONSEQUENCE']) {
    ok(`the ${kind.toLowerCase()} case is spelled out`, has(kind));
  }
  ok('order is taken from dates, never from wording', has('ORDER OF EVENTS IS CHECKED AGAINST DATES'));
  ok('attribution does not settle an order', has('ATTRIBUTION DOES NOT SETTLE AN ORDER EITHER'));
  ok('the narration is checked against itself', has('THE NARRATION MUST ALSO AGREE WITH ITSELF'));
  ok('a bookend and a hook are not repetition', has('TWO ECHOES ARE NOT REPETITION'));
  ok('scope is part of the assertion', has('SCOPE IS PART OF THE ASSERTION'));
  ok('a counterfactual cannot be supported', has('A COUNTERFACTUAL CANNOT BE SUPPORTED BY ANYTHING'));
  ok('one assertion at a time', has('ONE ASSERTION AT A TIME'));
}

console.log('DS Rewrite, DS Write, DS Save, DS Load');
{
  // ONE PROMPT, TWO LIVE NODES is already the rule for the judge; the rewrite
  // is the one place the re-run needs a rule of its own, and it must be ONE
  // rule — anything more and the two prompts have started drifting apart.
  const fcRw = readFileSync(join(PASTE, 'FC Rewrite.txt'), 'utf8');
  const dsRw = readFileSync(join(DS, 'DS Rewrite.txt'), 'utf8');
  const lines = dsRw.split('\n');
  const at = lines.findIndex((l) => l.includes('CHAPTER 0 IS THE OPENING HOOK'));
  ok('DS Rewrite carries the hook rule', at >= 0);
  ok('and is otherwise FC Rewrite byte for byte', lines.slice(0, at).concat(lines.slice(at + 1)).join('\n') === fcRw);
}
{
  const sql = readFileSync(join(DS, 'DS Write.sql'), 'utf8');
  ok('DS Write decodes the script in Postgres rather than inlining prose', /decode\('\{\{ \$json\.script64 \}\}',\s*'base64'\)/.test(sql) && /decode\('\{\{ \$json\.editing64 \}\}',\s*'base64'\)/.test(sql));
  ok('and writes the NEWEST script row only', /order by s2\.created_at desc limit 1/.test(sql));
  // Guarded both ways: a clean re-run must not bump `updated_at` or leave a
  // phantom edit in the history.
  ok('touches no script row when nothing changed', /s\.content is distinct from d\.new_script/.test(sql));
  // `new_editing` is the whole object re-serialised, so key order alone would
  // make it "distinct" on every single run — the flag is what gates it.
  ok('touches the hook only when the beats actually moved', /'\{\{ \$json\.hookChanged \}\}' = 'true'/.test(sql));
  // `editing_options` is jsonb and the decode yields text. The refusal takes
  // the whole statement with it, script included — execution 15199.
  ok('casts the rebuilt Editing Options back to jsonb', /set editing_options = d\.new_editing::jsonb/.test(sql));
  ok('and reports what it wrote', /script_rows/.test(sql) && /hook_rows/.test(sql));
  ok('whitelists the project id rather than quoting around it', sql.includes('replace(/[^A-Za-z0-9_-]/g'));
}
{
  const sql = readFileSync(join(DS, 'DS Save.sql'), 'utf8');
  ok('decodes the report in Postgres rather than inlining prose', /decode\('\{\{ \(\$\("DS Fill Apply"\)\.isExecuted \? \$\("DS Fill Apply"\) : \$\("DS Apply"\)\)\.first\(\)\.json\.fcReport64 \}\}',\s*'base64'\)/.test(sql) && !/\.fcReport \}\}/.test(sql));
  // BY NAME, NOT `$json`. `DS Write` runs between `DS Apply` and this node and
  // emits `{script_rows, hook_rows}`, so `$json.fcReport64` is undefined and
  // the node dies with "invalid base64 end sequence" — execution 15202, where
  // the correction was written and the report describing it was not.
  ok('reads the report BY NAME, never off `$json`, which `DS Write` does not pass through', !/\$json\.fcReport64/.test(sql) && !/\$json\.projectId/.test(sql));
  ok('whitelists the project id rather than quoting around it', sql.includes('replace(/[^A-Za-z0-9_-]/g'));
  ok('upserts on the project', /on conflict \(project_id\) do update/.test(sql));
}
{
  const sql = readFileSync(join(DS, 'DS Load.sql'), 'utf8');
  ok('DS Load whitelists the id from the webhook body', sql.includes('replace(/[^A-Za-z0-9_-]/g'));
  ok('and reads the NEWEST script row', /order by s\.created_at desc\s*\n\s*limit 1/.test(sql));
  // What decides whether a correction may be written at all.
  ok('and counts the scenes, which is what freezes the rewrite', /count\(\*\) from hov\.scene/.test(sql) && sql.includes('as scene_count'));
  // Without the ordered length there is no floor, and the cuts are bounded
  // per press and unbounded across presses.
  ok('and reads the ordered length, which is what floors the cuts', /coalesce\(p\.length_seconds, 64\) as length_seconds/.test(sql));
}

// ---------------------------------------------------------------------------
// THE TOP-UP — `db/port/deep-search-topup/`. When the corrections leave a film
// short of what it weighed before Deep Search touched it, `FC Fill` / `DS Fill`
// propose SOURCED facts and `FC Fill Apply` / `DS Fill Apply` delete every one
// that is filler. The producer's two conditions, verbatim: give the running
// time back, "dar daca nu mai exista informatii utile nu as vrea sa adauge
// filler asa cum facea inainte si sa stea sa descrie scena".
// ---------------------------------------------------------------------------

const TOPUP = join(here, '..', 'db', 'port', 'deep-search-topup', 'paste');

// THE EDITOR (`Fill Check`) stands in here as a reader that says `keep` to
// every proposal, unless a test hands it verdicts of its own. That way the
// tests written for the code rules still test the code rules: a proposal they
// expect deleted is deleted by the rule they name, not by a missing verdict.
const keepAll = (raw) =>
  String(raw || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('ADD:'))
    .map((l, i) => `CHECK: ${i + 1} | VERDICT: keep | WHY: fixture`)
    .join('\n');
function runFill(file, opts) {
  const nodes = { ...(opts.nodes || {}) };
  const [fillNode, checkNode] = file.startsWith('DS') ? ['DS Fill', 'DS Fill Check'] : ['FC Fill', 'FC Fill Check'];
  if (!(checkNode in nodes) && fillNode in nodes) nodes[checkNode] = { output: keepAll((nodes[fillNode] || {}).output) };
  return runNode(file, { ...opts, nodes });
}
const wcount = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

console.log('Top-up — the gap is measured in the valve');
{
  // A chapter that loses three of its six sentences: a real cut, well past the
  // 25-word threshold and still inside the "lost more than half" refusal.
  const S = (i) => `Source ${i} records that the company filed its patent number ${1000 + i} in 2004.`;
  const long = [1, 2, 3, 4, 5, 6].map(S).join(' ');
  const kept = [1, 3, 5].map(S).join(' ');
  const cut = [2, 4, 6].map((i) => ({ quote: S(i), claim: S(i), verdict: 'unsupported', ref: '', reason: 'x', action: 'rewrite' }));
  const base = resolved([...cut, { ...SUPPORTED(), quote: S(1), ref: 'E1, E3', action: 'keep' }]);
  base.chapters = [{ chapter_number: 1, chapter_title: 'The patent', narrator_script: long }];
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: {
      'FC Resolve': base,
      'FC Rewrite': { output: { chapters: [{ chapter_number: 1, chapter_title: 'The patent', narrator_script: kept }] } },
    },
  });
  ok('the correction lands', out.fcReport.refused === undefined && out.output.includes(S(1)) && !out.output.includes(S(2)));
  ok('the length before Deep Search is the body that ARRIVED', out.fill.preCheckWords === wcount(long));
  ok('and it is written into the report, so every re-check measures against it', out.fcReport.preCheckWords === wcount(long));
  ok('the gap is exactly what the correction removed', out.fill.gapWords === wcount(long) - wcount(kept));
  ok('a gap worth two sentences switches the top-up on', out.fill.run === true);
  ok('it is handed the CORRECTED chapters, not the draft', out.fill.chapters[0].narrator_script === kept);
  ok('and the narration in the shape the prompt reads', out.fill.narration === out.output);
  ok('and the pack, so it can reach for claims the script has not used', out.fill.packList.includes('E1.'));
  ok('refs the judge cited are listed as already used, split and upper-cased', out.fill.usedRefs.includes('E1') && out.fill.usedRefs.includes('E3'));
}
{
  // Under the threshold the film is within the noise of its own length, and a
  // sentence added to close it is exactly the padding the producer refused.
  const out = runNode('FC Apply.js', {
    json: {},
    nodes: {
      'FC Resolve': resolved([{ ...UNSUPPORTED(), action: 'rewrite' }]),
      'FC Rewrite': { output: { chapters: [
        { chapter_number: 1, chapter_title: 'The acquisition', narrator_script: 'Google acquired Where 2 Technologies in October 2004.' },
        { chapter_number: 2, chapter_title: 'Launch', narrator_script: CH2 },
      ] } },
    },
  });
  ok('a gap of a few words does not start the top-up', out.fill.gapWords > 0 && out.fill.gapWords < 25 && out.fill.run === false);
}
{
  // A film Deep Search declined has nothing to restore.
  const out = runNode('FC Apply.js', { json: {}, nodes: { 'FC Prep': prepped({ run: false, skipCode: 'not-documentary' }) } });
  ok('a skipped film never tops up', out.fill.run === false && out.fill.gapWords === 0);
}
{
  // THE RE-CHECK MEASURES AGAINST THE RECORDED LENGTH, not against what this
  // press started with. A film an earlier press shortened is still short, and
  // this press may find nothing new to correct at all.
  const clean = dsResolve([dsFindings()[1]], { bodyWords: 5, preCheckWords: 200, minWords: 10 });
  const out = dsApply(clean);
  ok('nothing corrected this press', out.fcReport.rewritten === 0);
  ok('but the film is measured against what it weighed before Deep Search', out.fill.preCheckWords === 200 && out.fill.gapWords === 200 - out.fill.nowWords);
  ok('so the top-up runs anyway', out.fill.run === true);
  ok('and the recorded length is carried forward in the new report', out.fcReport.preCheckWords === 200);
  ok('the hook is not counted, because Narration Guard did not count it', out.fill.nowWords === wcount(DS_CH1));
}
{
  // A report from before the top-up existed has no recorded length. Then the
  // anchor is this press's own starting point — which can never lengthen a
  // film beyond a length it actually had.
  const clean = dsResolve([dsFindings()[1]], { bodyWords: wcount(DS_CH1), minWords: 1 });
  const out = dsApply(clean);
  ok('no recorded length falls back to this press, not to the ordered target', out.fill.preCheckWords === wcount(DS_CH1) && out.fill.run === false);
}
{
  // PAST THE SCRIPT GATE THE SCENES CARRY THEIR OWN COPY OF EVERY LINE.
  const frozen = dsResolve([dsFindings()[1]], { bodyWords: 5, preCheckWords: 200, minWords: 10, mayRewrite: false, sceneCount: 12 });
  const out = dsApply(frozen);
  ok('a film past its script gate is never topped up', out.fill.gapWords > 25 && out.fill.run === false);
}
{
  const out = runNode('DS Prep.js', { json: dsRow({ pre_check_words: 178 }), dir: DS });
  ok('DS Prep carries the recorded length off the old report', out.fc.preCheckWords === 178);
  const none = runNode('DS Prep.js', { json: dsRow(), dir: DS });
  ok('and zero when the report predates it', none.fc.preCheckWords === 0);
}

// The fixture every guard test below starts from: a hook, a founding chapter,
// and a last chapter with its resolution set apart as its own paragraph.
const TU_HOOK = 'In 2003, two brothers in Sydney drew a map that moved.';
const TU_CH1 = 'In early 2003, Lars Rasmussen and Jens Rasmussen founded Where 2 Technologies in Sydney. Their prototype let a user drag a map inside a web browser.';
const TU_P1 = 'Google acquired Where 2 Technologies in October 2004.';
const TU_END = 'The work that began in Sydney had become a public map service.';
const TU_P2 = 'Google Maps launched on February 8, 2005. ' + TU_END;
const TU_CH2 = TU_P1 + '\n\n' + TU_P2;
const TU_PACK = [
  'E1. Where 2 Technologies was founded in Sydney in 2003 by Lars and Jens Rasmussen. [Google, 2005 — https://example.org/1]',
  'E2. Google acquired Where 2 Technologies in October 2004. [Google, 2004 — https://example.org/2]',
  'E3. Google acquired Keyhole, a satellite imagery company, in October 2004. [Google, 2004 — https://example.org/3]',
  'E4. Google acquired ZipDash, a traffic analysis company, in 2004. [TechCrunch, 2004 — https://example.org/4]',
  'E5. Google Maps added satellite imagery from Keyhole in April 2005. [Google, 2005 — https://example.org/5]',
].join('\n');
const tuChapters = () => [
  { chapter_number: 0, chapter_title: 'HOOK', narrator_script: TU_HOOK },
  { chapter_number: 1, chapter_title: 'Sydney', narrator_script: TU_CH1 },
  { chapter_number: 2, chapter_title: 'Google', narrator_script: TU_CH2 },
];
const tuFill = (over = {}) => ({ run: true, gapWords: 60, preCheckWords: 140, nowWords: 80, min: 40, narration: 'x', packList: TU_PACK, usedRefs: ['E1', 'E2'], chapters: tuChapters(), ...over });
const ADD = (ch, after, ref, sentence, { source = ref === 'LIVE' ? 'Google' : '', url = '' } = {}) =>
  `ADD: ${ch} | AFTER: ${after} | REF: ${ref} | SOURCE: ${source} | URL: ${url} | SENTENCE: ${sentence}`;
const fcFill = (lines, fillOver = {}, reportOver = {}) =>
  runFill('FC Fill Apply.js', {
    dir: TOPUP,
    nodes: {
      'FC Apply': { output: 'x', retry: false, chapters: tuChapters(), words: 0, target: 100, min: 40, max: 112, fcReport: { checked: 5, rewritten: 1, preCheckWords: 140, findings: [], ...reportOver }, fcReport64: '', fill: tuFill(fillOver) },
      'FC Fill': { output: Array.isArray(lines) ? lines.join('\n') : lines },
    },
  });
const chap = (out, n) => out.chapters.find((c) => Number(c.chapter_number) === n).narrator_script;

const GOOD_E3 = 'The same month, Google also bought Keyhole, a satellite imagery company.';
const GOOD_LIVE = 'In 2004, Where 2 Technologies showed its prototype to Google in Mountain View.';
const LIVE_URL = 'https://googleblog.blogspot.com/2005/02/mapping-your-way.html';

console.log('Top-up — what a sentence needs to be kept');
{
  const out = fcFill([ADD(2, TU_P1, 'E3', GOOD_E3), 'DONE: enough']);
  ok('a new fact from an unused claim is added', chap(out, 2).includes(GOOD_E3));
  ok('right after the sentence it names, where it belongs in time', chap(out, 2).includes(TU_P1 + ' ' + GOOD_E3));
  ok('and the report names it, its claim and its source', out.fcReport.filled.sentences === 1 && out.fcReport.filled.added[0].ref === 'E3' && out.fcReport.filled.added[0].sentence === GOOD_E3);
  ok('counting what it gave back', out.fcReport.filled.words === wcount(GOOD_E3) && out.fcReport.filled.shortBy === 60 - wcount(GOOD_E3));
}
{
  const out = fcFill([ADD(1, 'END', 'LIVE', GOOD_LIVE, { url: LIVE_URL }), 'DONE: exhausted']);
  ok('a fact found by a live search is added when it brings its URL', chap(out, 1).endsWith(GOOD_LIVE));
  ok('and is counted as a live find', out.fcReport.filled.live === 1 && out.fcReport.filled.added[0].url === LIVE_URL);
  ok('"the research ran out" reaches the report', out.fcReport.filled.exhausted === true);
}

console.log('Top-up — what gets deleted, one sentence at a time');
const dropReason = (line) => {
  const out = fcFill([line]);
  const d = out.fcReport.filled.dropped || {};
  return { out, why: Object.keys(d)[0], untouched: out.chapters.every((c, i) => c.narrator_script === tuChapters()[i].narrator_script) };
};
for (const [label, line, why] of [
  ['a claim that is not in the pack', ADD(1, 'END', 'E99', 'Lars Rasmussen later joined Facebook in 2010 after leaving.'), 'no source'],
  ['a live find with no URL', ADD(1, 'END', 'LIVE', GOOD_LIVE, { url: '' }), 'no source'],
  ['the light on the scene (texture)', ADD(1, 'END', 'E1', 'The harbour light glowed over Sydney while the Rasmussen brothers worked in 2003.'), 'describes the picture'],
  ['a sentence that opens on scenery', ADD(1, 'END', 'E1', 'Rain fell on Sydney while the Rasmussen brothers coded through 2003.'), 'describes the picture'],
  ['a camera line', ADD(1, 'END', 'E1', 'A close-up shows the Rasmussen brothers at their Sydney desk in 2003.'), 'describes the picture'],
  ['commentary on what it meant', ADD(1, 'END', 'E1', 'That is how two brothers in Sydney started a company in 2003.'), 'comments instead of telling'],
  ['a sentence about the film itself', ADD(1, 'END', 'E1', 'In this film, the Rasmussen brothers found Where 2 in Sydney in 2003.'), 'comments instead of telling'],
  ['a sentence with no date, number or name', ADD(1, 'END', 'LIVE', 'the team worked on the idea for many long months together.', { url: LIVE_URL }), 'no date, number or name'],
  ['a sentence that cites a claim it does not carry', ADD(1, 'END', 'E4', 'Microsoft launched its own web map service in 2005 as well.'), 'does not carry its claim'],
  ['a restatement of the script', ADD(1, 'END', 'E2', 'In October 2004, Google acquired Where 2 Technologies.'), 'repeats the script'],
  ['anything in the hook', ADD(0, 'END', 'E1', 'Where 2 Technologies began in Sydney in 2003 with two brothers.'), 'no such chapter, or the hook'],
  ['a fragment', ADD(1, 'END', 'E1', 'Sydney, 2003.'), 'not one sentence of fact'],
]) {
  const r = dropReason(line);
  ok(`${label} is deleted (${why})`, r.why === why && r.untouched, `got ${r.why}`);
}
{
  // ONE CLAIM, ONE SENTENCE. Stretching a single fact across two sentences is
  // how a narration reaches a word count without saying more.
  const out = fcFill([
    ADD(2, 'Google Maps launched on February 8, 2005.', 'E5', 'In April 2005, Google Maps added satellite pictures drawn from Keyhole.'),
    ADD(1, 'END', 'E5', 'Keyhole imagery reached Google Maps users in April 2005 across the United States.'),
  ]);
  ok('a second sentence from the same claim is deleted', out.fcReport.filled.sentences === 1 && (out.fcReport.filled.dropped || {})['one claim stretched into two sentences'] === 1);
}
{
  // Two additions may not repeat EACH OTHER either.
  const out = fcFill([
    ADD(2, TU_P1, 'E3', GOOD_E3),
    ADD(1, 'END', 'LIVE', 'That same month, Google also bought Keyhole, the satellite imagery company.', { url: LIVE_URL }),
  ]);
  ok('an addition that repeats an earlier addition is deleted', out.fcReport.filled.sentences === 1 && (out.fcReport.filled.dropped || {})['repeats the script'] === 1);
}
{
  // THE BUDGET IS A CEILING, cut from the LAST proposal — so the facts the
  // model chose to write first are the ones that survive, as the prompt says.
  const out = fcFill([ADD(2, TU_P1, 'E3', GOOD_E3), ADD(1, 'END', 'LIVE', GOOD_LIVE, { url: LIVE_URL })], { gapWords: wcount(GOOD_E3) + 3 });
  ok('what would overshoot the original length is deleted', out.fcReport.filled.sentences === 1 && out.fcReport.filled.added[0].ref === 'E3' && (out.fcReport.filled.dropped || {})['over budget'] === 1);
  ok('and the film never ends up longer than it was before Deep Search', out.fcReport.filled.words <= wcount(GOOD_E3) + 3);
}
{
  // One bad sentence never costs the good ones.
  const out = fcFill([
    ADD(1, 'END', 'E1', 'The harbour light glowed over Sydney while the Rasmussen brothers worked in 2003.'),
    ADD(2, TU_P1, 'E3', GOOD_E3),
  ]);
  ok('a rejected sentence does not take the next one with it', out.fcReport.filled.sentences === 1 && chap(out, 2).includes(GOOD_E3));
}
{
  const out = fcFill('DONE: exhausted');
  ok('nothing to add leaves the narration exactly as it was', out.chapters.every((c, i) => c.narrator_script === tuChapters()[i].narrator_script));
  ok('and says the research ran out, with the whole gap still open', out.fcReport.filled.sentences === 0 && out.fcReport.filled.exhausted === true && out.fcReport.filled.shortBy === 60);
}
{
  // `FC Fill` is `continueRegularOutput`: an agent that errors hands on no
  // `output` at all, and that must be an empty top-up, not a dead film.
  const out = runFill('FC Fill Apply.js', {
    dir: TOPUP,
    nodes: { 'FC Apply': { output: 'x', chapters: tuChapters(), min: 40, fcReport: {}, fill: tuFill() }, 'FC Fill': { error: 'timeout' } },
  });
  ok('a failed agent changes nothing and throws nothing', out.chapters.length === 3 && out.fcReport.filled.sentences === 0);
}

console.log('Top-up — the closing line stays the closing line');
{
  // Asked to follow the film's LAST sentence, it lands just before it.
  const out = fcFill([ADD(2, TU_END, 'E3', GOOD_E3)]);
  ok('nothing is ever placed after the last sentence of the film', chap(out, 2).endsWith(TU_END));
  ok('the new sentence sits directly before the closing line', chap(out, 2).endsWith(GOOD_E3 + ' ' + TU_END));
  ok('and the paragraph break before the final paragraph is kept', chap(out, 2).split(/\n\s*\n/).length === 2);
}
{
  // THE PROBE'S OWN CASE (2026-09-23): an anchor in the final paragraph that is
  // NOT the closing line. The first version protected the whole paragraph and
  // pushed the sentence into the paragraph BEFORE the one that introduces what
  // it talks about. A sentence goes after its antecedent, never before it.
  const out = fcFill([ADD(2, 'Google Maps launched on February 8, 2005.', 'E3', GOOD_E3)]);
  ok('an anchor inside the final paragraph is honoured', chap(out, 2).includes('Google Maps launched on February 8, 2005. ' + GOOD_E3));
  ok('and the closing line still closes', chap(out, 2).endsWith(TU_END));
}
{
  // A last chapter that is one paragraph still keeps its last line last.
  const one = tuChapters();
  one[2].narrator_script = TU_P1 + ' ' + TU_P2;
  const out = runFill('FC Fill Apply.js', {
    dir: TOPUP,
    nodes: { 'FC Apply': { output: 'x', chapters: one, min: 40, fcReport: {}, fill: tuFill({ chapters: one }) }, 'FC Fill': { output: ADD(2, 'END', 'E3', GOOD_E3) } },
  });
  ok('END in the last chapter lands just before its closing line', chap(out, 2).endsWith(GOOD_E3 + ' ' + TU_END));
}
{
  // A last chapter of ONE sentence: the only place that is not after the
  // closing line is before it.
  const solo = tuChapters();
  solo[2].narrator_script = TU_END;
  const out = runFill('FC Fill Apply.js', {
    dir: TOPUP,
    nodes: { 'FC Apply': { output: 'x', chapters: solo, min: 40, fcReport: {}, fill: tuFill({ chapters: solo }) }, 'FC Fill': { output: ADD(2, 'END', 'E3', GOOD_E3) } },
  });
  ok('a one-sentence ending still ends the film', chap(out, 2) === GOOD_E3 + ' ' + TU_END);
}
{
  const out = fcFill([ADD(1, 'END', 'LIVE', GOOD_LIVE, { url: LIVE_URL })]);
  ok('a chapter that is not the last takes END at its end', chap(out, 1) === TU_CH1 + ' ' + GOOD_LIVE);
}

console.log('Top-up — a sentence may not change what the script around it says');
// Both cases are the SECOND probe's real output (execution 16442, 2026-09-23),
// read as prose rather than counted — which is the only way either was seen.
const GM_API = 'On June 29, 2005, Google released the Google Maps API for external use.';
const GM_CLOSE = 'It had become a platform other people could build on, and its later reach still lay ahead.';
const GM_LAUNCH = 'On February 8, 2005, Google Maps launched for desktop as a new solution, Google said, to help people get from point A to point B.';
const GM_INSIDE = 'Inside Google, the Sydney software became part of Google Maps.';
const gmChapters = () => [
  { chapter_number: 0, chapter_title: 'HOOK', narrator_script: 'In October 2004, Google acquired Where 2 Technologies.' },
  { chapter_number: 1, chapter_title: 'Sydney', narrator_script: GM_INSIDE + ' ' + GM_LAUNCH + '\n\n' + GM_API + ' ' + GM_CLOSE },
];
const gmFill = (line) =>
  runFill('FC Fill Apply.js', {
    dir: TOPUP,
    nodes: { 'FC Apply': { output: 'x', chapters: gmChapters(), min: 40, fcReport: {}, fill: tuFill({ chapters: gmChapters() }) }, 'FC Fill': { output: line } },
  });
{
  // "It had become a platform" would have become a sentence about a BLOG.
  const out = gmFill(ADD(1, GM_API, 'LIVE', 'In November 2005, Google created the Google Maps API Blog.', { url: LIVE_URL }));
  ok('a sentence that would steal the closing line\'s "It" is deleted', out.fcReport.filled.sentences === 0 && (out.fcReport.filled.dropped || {})["would take the next sentence's subject"] === 1);
  ok('and the closing line still means what it meant', chap(out, 1).endsWith(GM_API + ' ' + GM_CLOSE));
}
{
  // A February 16 fact in front of the February 8 launch.
  const out = gmFill(ADD(1, GM_INSIDE, 'LIVE', 'On February 16, 2005, Google released a beta Toolbar that turned web page addresses into online map links.', { url: LIVE_URL }));
  ok('a sentence placed before an earlier date is deleted', out.fcReport.filled.sentences === 0 && (out.fcReport.filled.dropped || {})['out of date order'] === 1);
}
{
  // The same fact, anchored where it belongs, is kept.
  const TOOLBAR = 'On February 16, 2005, Google released a beta Toolbar that turned web page addresses into online map links.';
  const out = gmFill(ADD(1, GM_LAUNCH, 'LIVE', TOOLBAR, { url: LIVE_URL }));
  ok('the same fact in date order is kept', out.fcReport.filled.sentences === 1 && chap(out, 1).includes(GM_LAUNCH + ' ' + TOOLBAR));
  ok('closing the paragraph it belongs to', chap(out, 1).split(/\n\s*\n/)[0].endsWith(TOOLBAR));
}
{
  // A pronoun that is NOT the closing line: the sentence moves past it rather
  // than being lost.
  const ch = tuChapters();
  ch[1].narrator_script = 'Where 2 Technologies was founded in Sydney in 2003. It had four founders. Their prototype ran in a browser.';
  const out = runFill('FC Fill Apply.js', {
    dir: TOPUP,
    nodes: { 'FC Apply': { output: 'x', chapters: ch, min: 40, fcReport: {}, fill: tuFill({ chapters: ch }) }, 'FC Fill': { output: ADD(1, 'Where 2 Technologies was founded in Sydney in 2003.', 'LIVE', GOOD_LIVE, { url: LIVE_URL }) } },
  });
  ok('a sentence in front of a pronoun moves past it instead of stealing it', chap(out, 1) === ch[1].narrator_script + ' ' + GOOD_LIVE && out.fcReport.filled.sentences === 1);
  ok('past every pronoun in a row', !chap(out, 1).includes(GOOD_LIVE + ' It had') && !chap(out, 1).includes(GOOD_LIVE + ' Their'));
}

console.log('Top-up — what the fact-checker rejects stays out');
{
  // THE LOOP THIS EXISTS TO STOP. Press N adds a sourced sentence; press N+1's
  // judge rules it redundant and the rewrite cuts it; the gap reopens; press
  // N+2 would add it straight back. The rejection has to outlive the press.
  const added = DS_GOOD; // stands for a sentence an earlier top-up put in
  const judged = dsResolve(
    [{ quote: added, claim: added, verdict: 'redundant', ref: 'E1', reason: 'already said' }],
    { prevAdded: [added], prevRejected: ['An older rejected sentence about 2004.'] },
  );
  const out = dsApply(judged);
  ok('a sentence an earlier top-up added, now flagged, is rejected for good', out.fill.rejected.includes(added));
  ok('earlier rejections are carried forward, not replaced', out.fill.rejected.includes('An older rejected sentence about 2004.'));
  ok('and the list is written into the report for the next press', out.fcReport.rejected && out.fcReport.rejected.includes(added));
}
{
  const kept = dsResolve([{ ...dsFindings()[1] }], { prevAdded: [DS_GOOD] });
  const out = dsApply(kept);
  ok('an added sentence the judge SUPPORTS is not rejected', !out.fill.rejected.includes(DS_GOOD) && out.fcReport.rejected === undefined);
}
{
  const REJ = 'In 2004, Google said, two Aussies and two Danes in Sydney created the technology that underpinned Google Maps.';
  const out = fcFill(
    [ADD(1, 'END', 'LIVE', 'In 2004, two Aussies and two Danes in Sydney created the technology that underpinned Google Maps.', { url: LIVE_URL })],
    { rejected: [REJ] },
  );
  ok('the top-up will not propose a rejected sentence again, even reworded', out.fcReport.filled.sentences === 0 && (out.fcReport.filled.dropped || {})['rejected by the fact-checker before'] === 1);
}
{
  const row = dsRow({ prev_added: JSON.stringify([{ sentence: 'A added.', ref: 'E1' }]), prev_rejected: JSON.stringify(['B rejected.']) });
  const out = runNode('DS Prep.js', { json: row, dir: DS });
  ok('DS Prep carries last press\'s additions', out.fc.prevAdded.length === 1 && out.fc.prevAdded[0] === 'A added.');
  ok('and the rejected list', out.fc.prevRejected.length === 1 && out.fc.prevRejected[0] === 'B rejected.');
  const bad = runNode('DS Prep.js', { json: dsRow({ prev_added: '{not json', prev_rejected: null }), dir: DS });
  ok('and survives a malformed old report', Array.isArray(bad.fc.prevAdded) && bad.fc.prevAdded.length === 0 && bad.fc.prevRejected.length === 0);
}
{
  const load = readFileSync(join(DS, 'DS Load.sql'), 'utf8');
  ok('DS Load reads what the top-up added last time', load.includes("f.report->'filled'->'added'") && load.includes('as prev_added'));
  ok('and what has been rejected so far', load.includes("f.report->'rejected'") && load.includes('as prev_rejected'));
}

console.log('Top-up — the editor decides what is worth adding');
// FIVE PROBES on the producer's Google Maps film (2026-09-23) found that the
// code rules, which reliably stop description and commentary, cannot tell a
// new fact from the script said again in other words. These are the probes'
// own sentences, with the editor's verdicts standing in.
{
  const ANU = 'An Australian National University research repository document states that Google acquired Where 2 Technologies in October 2004 and launched Google Maps in February 2005.';
  const out = runFill('FC Fill Apply.js', {
    dir: TOPUP,
    nodes: {
      'FC Apply': { output: 'x', chapters: tuChapters(), min: 40, fcReport: {}, fill: tuFill() },
      'FC Fill': { output: [ADD(2, TU_P1, 'E2', ANU), ADD(2, TU_P1, 'E3', GOOD_E3)].join('\n') },
      'FC Fill Check': { output: 'CHECK: 1 | VERDICT: repeat | WHY: both dates are already in the script, now only attributed\nCHECK: 2 | VERDICT: keep | WHY: new' },
    },
  });
  ok('a known fact restated behind an attribution is kept out when the editor says repeat', !chap(out, 2).includes('Australian National University') && (out.fcReport.filled.dropped || {})['judged repeat'] === 1);
  ok('while the proposal the editor keeps goes in', chap(out, 2).includes(GOOD_E3) && out.fcReport.filled.sentences === 1);
}
for (const v of ['minor', 'overreach']) {
  const out = runFill('FC Fill Apply.js', {
    dir: TOPUP,
    nodes: {
      'FC Apply': { output: 'x', chapters: tuChapters(), min: 40, fcReport: {}, fill: tuFill() },
      'FC Fill': { output: ADD(2, TU_P1, 'E3', GOOD_E3) },
      'FC Fill Check': { output: `CHECK: 1 | VERDICT: ${v} | WHY: x` },
    },
  });
  ok(`a proposal the editor calls ${v} is not added`, out.fcReport.filled.sentences === 0 && (out.fcReport.filled.dropped || {})['judged ' + v] === 1);
}
{
  // NO VERDICT, NOTHING ADDED. An editor that errored (`continueRegularOutput`)
  // or skipped a line fails CLOSED: the film stays short and the report says why.
  const out = runFill('FC Fill Apply.js', {
    dir: TOPUP,
    nodes: {
      'FC Apply': { output: 'x', chapters: tuChapters(), min: 40, fcReport: {}, fill: tuFill() },
      'FC Fill': { output: ADD(2, TU_P1, 'E3', GOOD_E3) },
      'FC Fill Check': { error: 'timeout' },
    },
  });
  ok('with no verdict from the editor nothing is added', out.fcReport.filled.sentences === 0 && (out.fcReport.filled.dropped || {})['not checked'] === 1);
}
{
  // THE NUMBERING HOLDS across a malformed line: the editor numbers every
  // `ADD:` line, so the guard must too, or every verdict after it lands on the
  // wrong sentence.
  const out = runFill('FC Fill Apply.js', {
    dir: TOPUP,
    nodes: {
      'FC Apply': { output: 'x', chapters: tuChapters(), min: 40, fcReport: {}, fill: tuFill() },
      'FC Fill': { output: ['ADD: 2 | this line lost its fields', ADD(2, TU_P1, 'E3', GOOD_E3)].join('\n') },
      'FC Fill Check': { output: 'CHECK: 1 | VERDICT: keep | WHY: x\nCHECK: 2 | VERDICT: repeat | WHY: x' },
    },
  });
  ok('a malformed line is dropped as malformed', (out.fcReport.filled.dropped || {})['malformed'] === 1);
  ok('and the verdict after it still lands on its own sentence', out.fcReport.filled.sentences === 0 && (out.fcReport.filled.dropped || {})['judged repeat'] === 1);
}
{
  const c = readFileSync(join(TOPUP, 'FC Fill Check.txt'), 'utf8');
  ok('the editor numbers proposals exactly as the guard does', c.includes(".filter((l) => l.startsWith('ADD:')).map((l, i) => (i + 1) + '. ' + l)"));
  ok('reads the script and research from whichever chain it sits in', c.includes("($('DS Apply').isExecuted ? $('DS Apply') : $('FC Apply')).first().json.fill.narration"));
  ok('treats an attributed known fact as a repeat', c.includes('merely ATTRIBUTED'));
  ok('treats the same people described again as a repeat', c.includes('The same people described again'));
  ok('and keeps only when sure', c.includes('When you are unsure between `keep` and anything else, do not choose `keep`.'));
  ok('in the line format the guard parses', c.includes('CHECK: <number> | VERDICT: <keep|repeat|minor|overreach> | WHY:'));
}

console.log('Top-up — what it hands on');
{
  const out = fcFill([ADD(2, TU_P1, 'E3', GOOD_E3)]);
  ok('`FC Fill Apply` speaks Narration Guard\'s shape, like `FC Apply`', 'output' in out && out.retry === false && out.min === 40 && out.target === 100);
  ok('the narration is rebuilt from the chapters as they now stand', out.output.includes(GOOD_E3) && out.output.startsWith('[CHAPTER 0: HOOK]'));
  ok('and so is the word count', out.words === out.chapters.reduce((n, c) => n + wcount(c.narrator_script), 0));
  ok('the report round-trips through base64 for the writer', JSON.parse(Buffer.from(out.fcReport64, 'base64').toString('utf8')).filled.sentences === 1);
  ok('carrying the recorded length forward', out.fcReport.preCheckWords === 140);
}
{
  // `short` belongs to the valve. The top-up may lift it back over the floor.
  const words = tuChapters().reduce((n, c) => n + wcount(c.narrator_script), 0);
  const lifted = fcFill([ADD(2, TU_P1, 'E3', GOOD_E3)], {}, { short: { words, min: words + 5 } });
  ok('a top-up that brings the film back over its floor clears `short`', lifted.fcReport.short === undefined);
  const still = fcFill('DONE: exhausted', {}, { short: { words, min: words + 50 } });
  ok('one that cannot keeps it, with the new count', still.fcReport.short && still.fcReport.short.min === words + 50);
  const never = fcFill('DONE: exhausted', {}, {});
  ok('and it never invents one', never.fcReport.short === undefined);
}
{
  // DS FILL APPLY hands back `DS Apply`'s shape, because `DS Write` and
  // `DS Save` read it off `$json` and by name respectively.
  const dsg = {
    projectId: 'rec1', projectName: 'A film', scriptChanged: false, hookChanged: false, script: 'x',
    fcReport: { rerun: true, preCheckWords: 140 }, fcReport64: '', script64: '', editing64: 'RURJVElORw==',
    fill: tuFill(),
  };
  const out = runFill('DS Fill Apply.js', { dir: TOPUP, nodes: { 'DS Apply': dsg, 'DS Fill': { output: ADD(2, TU_P1, 'E3', GOOD_E3) } } });
  ok('the re-check\'s top-up writes the script with the new sentence in it', out.script.includes(GOOD_E3) && Buffer.from(out.script64, 'base64').toString('utf8') === out.script);
  ok('and says the script changed, so the reload sees it', out.scriptChanged === true);
  ok('the hook is never touched, so its spoken copy is left alone', out.script.startsWith('[CHAPTER 0: HOOK]\n' + TU_HOOK + '\n\n') && out.editing64 === 'RURJVElORw==' && out.hookChanged === false);
  ok('the project id and name pass straight through', out.projectId === 'rec1' && out.projectName === 'A film');
  ok('and the report it saves says what was added', JSON.parse(Buffer.from(out.fcReport64, 'base64').toString('utf8')).filled.added[0].ref === 'E3');
  const none = runFill('DS Fill Apply.js', { dir: TOPUP, nodes: { 'DS Apply': dsg, 'DS Fill': { output: 'DONE: exhausted' } } });
  ok('an empty top-up leaves `scriptChanged` as the valve set it', none.scriptChanged === false);
}
{
  // FC DONE HAS TWO DOORS NOW. Reading `FC Apply` unconditionally, as it used
  // to, would throw the added sentences away one node before `Combine Chapters`.
  const applied = { output: 'before', retry: false, chapters: chapters(), words: 30, fcReport: {}, fcReport64: '', fill: { run: true } };
  const filled = { output: 'after', retry: false, chapters: chapters(), words: 42, fcReport: {}, fcReport64: '' };
  const withFill = runNode('FC Done.js', { json: {}, nodes: { 'FC Apply': applied, 'FC Fill Apply': filled } });
  ok('`FC Done` hands on the TOP-UP when it ran', withFill.output === 'after' && withFill.words === 42);
  const without = runNode('FC Done.js', { json: {}, nodes: { 'FC Apply': applied } });
  ok('and `FC Apply` when it did not', without.output === 'before');
  ok('and never passes the top-up\'s inputs on to `Combine Chapters`', !('fill' in without) && !('fill' in withFill));
}

console.log('Top-up — one guard in two nodes, and it is Narration Guard\'s');
{
  const block = (f) => {
    const s = readFileSync(join(TOPUP, f), 'utf8');
    return s.slice(s.indexOf('// ── SHARED GUARD ──'), s.indexOf('// ── END SHARED GUARD ──'));
  };
  const fcB = block('FC Fill Apply.js');
  const dsB = block('DS Fill Apply.js');
  ok('the guard is byte-identical in `FC Fill Apply` and `DS Fill Apply`', fcB.length > 5000 && fcB === dsB);
  // THE FILLER DETECTORS ARE NOT A SECOND OPINION. `Narration Guard` measured
  // them against real scripts; if its list changes, the top-up must follow.
  const guardSrc = readFileSync(join(here, '..', 'db', 'port', 'story-close', 'paste', 'cs-Narration_Guard.js'), 'utf8');
  for (const name of ['TEXTURE', 'CAMERA', 'SCENERY', 'COMMENTARY', 'DEFINITION', 'META']) {
    const re = new RegExp(`const ${name} = /.*/i;`);
    const theirs = (guardSrc.match(re) || [])[0];
    const mine = (fcB.match(re) || [])[0];
    ok(`${name} is Narration Guard's own, byte for byte`, !!theirs && theirs === mine);
  }
}

console.log('Top-up — the prompt, and the writers around it');
{
  const p = readFileSync(join(TOPUP, 'FC Fill.txt'), 'utf8');
  ok('it says adding nothing is a good answer', p.includes('Adding nothing is a perfectly good answer'));
  // The three parts that make a length obeyed rather than ignored (CLAUDE.md,
  // "A length in a prompt is obeyed or ignored according to how it is PHRASED").
  ok('the budget is named as a RULE', p.includes('THE LENGTH IS A RULE, NOT A TARGET'));
  ok('the model is asked to count before it answers', p.includes('Count the words of your sentences before you answer'));
  ok('and told the consequence, cut from its LAST sentence', p.includes('cut in code, starting from your LAST sentence'));
  ok('the unused pack comes before a live search', /1\. A claim from the list above[\s\S]*2\. When no claim like that is left, SEARCH THE WEB/.test(p));
  // THE PROBE FOUND THIS (2026-09-23): told to search "only when the list has
  // nothing left", the model spent its budget on the pack's leftovers — which
  // restated the script — and declared the research exhausted in 3 seconds
  // without searching at all.
  ok('a claim the viewer can WORK OUT from the script counts as used', p.includes('also when the viewer can work it out from what the script says'));
  ok('searching is expected, not a last resort', p.includes('That is expected, not a last resort'));
  ok('and "exhausted" is only true once it has searched', p.includes('Write DONE: exhausted only AFTER you have searched the web'));
  ok('a sentence goes after what it talks about, never before it', p.includes('AFTER the sentence that introduces what it talks about, never before it'));
  ok('it asks for facts the story turns on, not details that change nothing', p.includes("WORTH THE VIEWER'S TIME"));
  ok('it states the date-order rule the guard enforces', p.includes('IN DATE ORDER.'));
  ok('and the pronoun rule the guard enforces', p.includes('NEVER IN FRONT OF A PRONOUN.'));
  // THE FOURTH PROBE (execution 16448) re-described the four founders the
  // script already names, dated 2004 and attributed — sourced, and not new.
  // Word overlap cannot see a paraphrase; the prompt has to say it.
  ok('NEW means a new event or number, not the same people described again', p.includes('NEW means a new EVENT or a new NUMBER'));
  ok('and the model is shown what the fact-checker rejected before', p.includes('ADDED BEFORE AND REJECTED BY THE FACT-CHECKER') && p.includes('$json.fill.rejected'));
  ok('it carries the relationship rule the judge enforces', p.includes('the RELATIONSHIP the sentence asserts'));
  ok('it forbids the picture, commentary and the film itself', p.includes('never about what the picture shows') && p.includes('A STATEMENT, not a comment'));
  ok('it protects the closing line and the hook', p.includes('Never after the LAST sentence of the LAST chapter') && p.includes('Never in CHAPTER 0'));
  ok('its line format is the one the guard parses, SENTENCE last', p.includes('ADD: <chapter number> | AFTER: ') && p.includes('| SENTENCE: <the sentence to add>') && p.includes('DONE: <enough|exhausted>'));
}
{
  const sql = readFileSync(join(DS, 'DS Save.sql'), 'utf8');
  ok('`DS Save` saves the TOP-UP\'s report when it ran', sql.includes('($("DS Fill Apply").isExecuted ? $("DS Fill Apply") : $("DS Apply")).first().json.fcReport64'));
  const load = readFileSync(join(DS, 'DS Load.sql'), 'utf8');
  ok('`DS Load` reads the recorded length off the report it is about to replace', /report->>'preCheckWords'/.test(load) && load.includes('as pre_check_words'));
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All fact-check node checks passed.');
