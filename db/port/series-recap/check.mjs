#!/usr/bin/env node
//
// check.mjs — run Series Recap's two Code nodes against fixtures, with no n8n
// and no network.
//
//     node db/port/series-recap/check.mjs
//
// WHY THIS EXISTS. The length of a recap line is now a promise to the producer:
// they asked for a line they never have to shorten by hand. That promise has
// two halves and each can break silently. The prompt half (`Build Recap
// Prompt`) is a measured WORDING — see the comment in that file — and the thing
// that would quietly undo it is someone rephrasing the rule while keeping the
// number. The code half (`Parse Recap`) is the net under it, and a net is by
// definition never exercised by a healthy run, so it is exactly the branch that
// rots unnoticed.
//
// The bodies are read from paste/, the committed source the live nodes were
// pasted from. This does NOT prove the live nodes match the files — that is
// what db/port/lib/diff-workflow.mjs is for.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PASTE = join(here, 'paste');

let failures = 0;
function ok(label, cond, detail) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

// One Code node body, with the pieces of n8n it actually touches.
function runNode(file, { json = {}, nodes = {} } = {}) {
  const body = readFileSync(join(PASTE, file), 'utf8');
  const logs = [];
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`No node called "${name}" could be found`);
    return { first: () => ({ json: nodes[name] }) };
  };
  const fn = new Function('$json', '$', 'Buffer', 'console', body);
  const out = fn(json, $, Buffer, { log: (...a) => logs.push(a.join(' ')) });
  return { items: out, first: out[0] ? out[0].json : null, logs };
}

const words = (s) => s.split(/\s+/).filter(Boolean).length;
const sentence = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ') + '.';
const answer = (text) => ({ choices: [{ message: { content: text } }] });
const project = {
  id: 'recEp', name: 'The One With The Wagon', series_id: 'recSeries', episode_no: 4,
  language: 'English', series_name: 'Pip', premise: 'Builders.', script: 'x'.repeat(400),
};

console.log('Build Recap Prompt');
const built = runNode('Build Recap Prompt.js', { json: project }).first;
const rule = built.payload.messages[0].content;
ok('asks for a word budget it also exports', built.words_asked === 80 && rule.includes('80 words or fewer'));
ok('states length as a rule, not a preference',
  /LENGTH IS A HARD RULE/.test(rule) && !/at most \d+ words/.test(rule));
ok('asks the model to count its draft before answering', /Count the words of your draft before you answer/.test(rule));
ok('says what happens to an answer that is too long', /rejected and useless/.test(rule));
ok('carries the film\'s language into the rule', rule.includes('in English, in the past tense'));
ok('a film that is not an episode writes nothing',
  runNode('Build Recap Prompt.js', { json: { ...project, series_id: null } }).items.length === 0);

console.log('Parse Recap — the ordinary case');
const asked = { project_id: 'recEp', series_id: 'recSeries', episode_no: 4, title: 'The One With The Wagon', words_asked: 80 };
const real = 'In Sunny Clover Meadow, Pip the Bunny Builder planned three side-by-side homes before bedtime, but when Momo the Bear Builder mixed parts and Tilly the Mouse Builder filled gaps, the muddle kept them from finishing. Pip then asked them to help each other, Momo steadied stacks, Tilly matched parts, and Pip fit each piece, so by bedtime the three homes were finished and the friends went safely to sleep in their own homes.';
const plain = runNode('Parse Recap.js', { json: answer(real), nodes: { 'Build Recap Prompt': asked } });
ok('a measured 73-word answer is passed through untouched', plain.first.line.endsWith(real));
ok('and is keyed by episode number', plain.first.like_pattern === 'Episode 4 —%');
ok('and reports its length for the next measurement',
  plain.logs.some((l) => /^RECAP LEN recEp: \d+ words \/ \d+ characters, asked for 80$/.test(l)));
ok('nothing is trimmed, so nothing cries wolf', !plain.logs.some((l) => l.startsWith('RECAP LONG')));
ok('an empty answer writes no line at all',
  runNode('Parse Recap.js', { json: answer(''), nodes: { 'Build Recap Prompt': asked } }).items.length === 0);

console.log('Parse Recap — the net');
const twoLong = `${sentence(70, 'a')} ${sentence(70, 'b')}`;
const cut = runNode('Parse Recap.js', { json: answer(twoLong), nodes: { 'Build Recap Prompt': asked } });
const kept = cut.first.line.split(': ').slice(1).join(': ');
ok('a 140-word answer is cut back under the ceiling', words(kept) <= 100, `${words(kept)} words`);
ok('and is cut at a sentence end, never inside one', /\.$/.test(kept.trim()) && !kept.includes('b0'));
ok('and says so loudly enough to be grepped',
  cut.logs.some((l) => /^RECAP LONG recEp: 140 words against a ceiling of 100/.test(l)));
const justOver = runNode('Parse Recap.js', { json: answer(`${sentence(55, 'a')} ${sentence(40, 'b')}`), nodes: { 'Build Recap Prompt': asked } });
ok('95 words — over the budget but inside the net — keeps its ending untouched',
  justOver.first.line.includes('b39') && !justOver.logs.some((l) => l.startsWith('RECAP LONG')));
const runaway = runNode('Parse Recap.js', { json: answer('z '.repeat(900).trim()), nodes: { 'Build Recap Prompt': asked } });
const runawayText = runaway.first.line.split(': ').slice(1).join(': ');
ok('an answer with no sentence end at all still cannot run away', runawayText.length <= 1000);
ok('the ceiling follows the budget rather than being a second number of its own',
  (() => {
    const at40 = runNode('Parse Recap.js', { json: answer(`${sentence(45, 'a')} ${sentence(45, 'b')}`), nodes: { 'Build Recap Prompt': { ...asked, words_asked: 40 } } });
    return at40.logs.some((l) => /ceiling of 50/.test(l));
  })());

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll Series Recap checks passed.');
process.exit(failures ? 1 : 0);
