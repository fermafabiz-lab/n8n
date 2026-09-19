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
  ok('refuses a rewrite that shortened a chapter past the window', out.chapters[0].narrator_script === CH1);
  ok('and names the word counts', /went from \d+ to \d+ words/.test(out.fcReport.refused || ''));
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
    ['a chapter re-told', [{ chapter_number: 0, narrator_script: 'Lars.' }, { chapter_number: 1, narrator_script: DS_CH1 }], /chapter 0 went from 13 to 1 words/],
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
  ok('decodes the report in Postgres rather than inlining prose', /decode\('\{\{ \$\("DS Apply"\)\.first\(\)\.json\.fcReport64 \}\}',\s*'base64'\)/.test(sql));
  // BY NAME, NOT `$json`. `DS Write` runs between `DS Apply` and this node and
  // emits `{script_rows, hook_rows}`, so `$json.fcReport64` is undefined and
  // the node dies with "invalid base64 end sequence" — execution 15202, where
  // the correction was written and the report describing it was not.
  ok('reads the report off `DS Apply`, which `DS Write` does not pass through', !/\$json\.fcReport64/.test(sql) && !/\$json\.projectId/.test(sql));
  ok('whitelists the project id rather than quoting around it', sql.includes('replace(/[^A-Za-z0-9_-]/g'));
  ok('upserts on the project', /on conflict \(project_id\) do update/.test(sql));
}
{
  const sql = readFileSync(join(DS, 'DS Load.sql'), 'utf8');
  ok('DS Load whitelists the id from the webhook body', sql.includes('replace(/[^A-Za-z0-9_-]/g'));
  ok('and reads the NEWEST script row', /order by s\.created_at desc\s*\n\s*limit 1/.test(sql));
  // What decides whether a correction may be written at all.
  ok('and counts the scenes, which is what freezes the rewrite', /count\(\*\) from hov\.scene/.test(sql) && sql.includes('as scene_count'));
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All fact-check node checks passed.');
