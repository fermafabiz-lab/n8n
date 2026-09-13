#!/usr/bin/env node
// check-expression.mjs <file-with-an-n8n-expression> [--messages]
//
// An httpRequest node's `jsonBody` in this repo is almost always a single n8n
// expression -- `={{ { model: '...', messages: [ ... ] } }}` -- and editing the
// prompt inside it means editing JavaScript string literals nested inside a
// JavaScript object literal, through a tool call, by hand. One unescaped quote
// and the node throws at runtime, on a producer's click, hours later.
//
// `node --check` cannot help: the file is not a program. This evaluates the
// expression with the n8n runtime globals stubbed out, and reports the SHAPE of
// what it produces -- so a broken edit fails here, in a second, instead of in
// production.
//
// The intended use is DIFFERENTIAL. Run it on the live body first and on your
// edit second, and compare: same top-level keys, same model, same message
// count, same roles. A prompt that grew is expected; a key that vanished is the
// bug you were looking for.
//
//   node db/port/lib/node-body.mjs snap.json "VP Rewrite AI" jsonBody > /tmp/live.txt
//   node db/port/lib/check-expression.mjs /tmp/live.txt
//   node db/port/lib/check-expression.mjs paste/"VP Rewrite AI".txt
//   node db/port/lib/check-expression.mjs paste/"VP Rewrite AI".txt --messages
//
// What it does NOT check: that the prompt is any good, that $('Node Name')
// names a node that exists (diff-workflow.mjs does that), or that a value the
// expression reads is the one you meant. Every `$(...)` chain evaluates to an
// opaque stub, on purpose -- the question here is syntax and shape.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const showMessages = process.argv.includes('--messages');
if (!file) {
  console.error('usage: check-expression.mjs <file> [--messages]');
  process.exit(2);
}

let body = readFileSync(file, 'utf8').replace(/\n+$/, '');
const hadEquals = body.startsWith('=');
if (hadEquals) body = body.slice(1);
body = body.trim();

if (!body.startsWith('{{') || !body.endsWith('}}')) {
  console.error('not a single {{ ... }} expression.');
  console.error(`starts: ${JSON.stringify(body.slice(0, 60))}`);
  console.error(`ends:   ${JSON.stringify(body.slice(-60))}`);
  console.error('(a jsonBody that is plain JSON with {{ }} holes inside it is a');
  console.error(' different shape -- check it by hand, this tool is for the');
  console.error(' whole-body-is-one-expression form.)');
  process.exit(2);
}
const expr = body.slice(2, -2);

// Every property read off an n8n global returns the same proxy, so a long
// chain like $('VP Prep').first().json.fields['Video Scenă URL'] evaluates
// instead of throwing. String coercion yields a marker, so template
// concatenation still produces a string of realistic shape.
const stub = new Proxy(function () {}, {
  get(_, k) {
    if (k === Symbol.toPrimitive) return () => '<VALUE>';
    if (k === 'toString') return () => '<VALUE>';
    if (k === 'then') return undefined;           // never look like a promise
    if (k === 'length') return 7;
    return stub;
  },
  apply() { return stub; },
});
const $ = () => stub;

let out;
try {
  out = new Function('$', '$json', '$now', '$today', '$workflow', '$execution',
    `return (${expr});`)($, stub, stub, stub, stub, stub);
} catch (e) {
  console.error(`EXPRESSION FAILED TO EVALUATE: ${e.message}`);
  process.exit(1);
}

console.log(`leading "=": ${hadEquals}${hadEquals ? '' : '   <-- n8n needs it to treat the value as an expression'}`);
console.log('evaluates: yes');

if (out === null || typeof out !== 'object') {
  console.log(`produces a ${typeof out}: ${JSON.stringify(out)?.slice(0, 200)}`);
} else {
  console.log(`top-level keys: ${Object.keys(out).join(', ')}`);
  for (const [k, v] of Object.entries(out)) {
    if (k === 'messages') continue;
    console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  if (Array.isArray(out.messages)) {
    console.log(`  messages: ${out.messages.length}`);
    out.messages.forEach((m, i) => {
      const c = typeof m?.content === 'string' ? m.content : String(m?.content);
      console.log(`    [${i}] role=${m?.role} content=${c.length} chars`);
      if (showMessages) console.log(`--- [${i}] ${m?.role} ---\n${c}\n---`);
    });
  } else if ('messages' in out) {
    console.log(`  messages: NOT AN ARRAY (${typeof out.messages}) -- this will fail at runtime`);
    process.exit(1);
  }
}

try {
  const s = JSON.stringify(out);
  console.log(`JSON.stringify: ok, ${s.length} chars`);
} catch (e) {
  console.error(`NOT SERIALISABLE: ${e.message}`);
  process.exit(1);
}
