// The tone a film is written in, and the category that chooses it.
//
// A tone is not decoration: it names a row in `hov.genre_profile`, and that
// row is the structure, the voice and the words per minute Claude Scripting
// writes the whole script with. The match is by `lower(tone)`, and a tone
// with NO row is not an error — Scripting falls back to its built-in
// DOCUMENTARY profile and says nothing, on screen or in the log. So the way
// this feature breaks is a Kids story written like a documentary, noticed
// three gates later by somebody reading the script.
//
// That makes two things worth pinning, neither of which a browser would
// catch:
//
//   1. every category's `defaultTone` is a tone that HAS a profile, and
//   2. the producer's tone survives a category change.
//
// (2) is the one that is easy to lose. The category moves the tone through an
// effect; the only thing stopping it from moving a tone the producer picked
// themselves is the `toneTouched` flag the chips set. Delete that one line
// and every screen still looks right — the bug only appears when somebody
// picks a tone and then changes their mind about the category.
//
//   node scripts/check-tones.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(
    `${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`,
  );
};

const { CATEGORIES, DEFAULT_CATEGORY, getCategory } = await import(join(root, "lib", "categories.ts"));
const { TONES } = await import(join(root, "lib", "tones.ts"));

/*
 * The tones that had an ACTIVE row in hov.genre_profile when this was
 * written. Measured, not assumed — on 2026-09-19, through a throwaway n8n
 * workflow, because a web session cannot reach the database directly:
 *
 *   select id, tone, active, length(structure), length(voice), wpm
 *   from hov.genre_profile order by lower(tone);
 *
 * Twelve rows, all active, all with a real structure and voice. This list is
 * therefore a RECORD of a measurement and not a source of truth: a tone added
 * to TONES needs its profile inserted first (db/port/childish-tone/ is the
 * worked example), and then this list and its date updated from a fresh run
 * of that query. Leaving it stale is the honest failure — the check goes red
 * and asks somebody to go and look.
 */
const PROFILED = [
  "Childish",
  "Cinematic",
  "Conspiracy",
  "Corporate",
  "Dark",
  "Documentary",
  "Dramatic",
  "Educativ",
  "Emotional",
  "Epic",
  "Horror",
  "Motivational",
];

// ---------------------------------------------------------------- the list

check("no tone is offered twice", TONES.length, new Set(TONES).size);
check(
  "every tone a producer can click has a writing profile",
  TONES.filter((t) => !PROFILED.includes(t)),
  [],
);
check(
  "and every profile that exists is offered — an unreachable one is a row nobody can select",
  PROFILED.filter((t) => !TONES.includes(t)),
  [],
);

// ------------------------------------------------------------ the defaults

check(
  "every category declares the tone it is written in",
  CATEGORIES.filter((c) => typeof c.defaultTone !== "string" || !c.defaultTone).map((c) => c.id),
  [],
);
check(
  "and each of those is a tone that exists",
  CATEGORIES.filter((c) => !TONES.includes(c.defaultTone)).map((c) => `${c.id}: ${c.defaultTone}`),
  [],
);

// The four the producer asked for by name, 2026-09-19. Spelled out one by one
// rather than compared against a copy of the map, so this reads as the
// request it came from.
check("Story is written Epic", getCategory("story").defaultTone, "Epic");
check("Documentary is written Documentary", getCategory("documentary").defaultTone, "Documentary");
check("Cinematic is written Cinematic", getCategory("cinematic").defaultTone, "Cinematic");
check("Kids story is written Childish", getCategory("kids").defaultTone, "Childish");

// `createProject` backstops an empty `tone` field with the category's own,
// and reaches for it through `getCategory` — which resolves anything it does
// not recognise to the first category. So a post with a nonsense category
// still lands on a real profile rather than on "".
check(
  "an unknown category still resolves to a real tone",
  getCategory("not-a-category").defaultTone,
  getCategory(DEFAULT_CATEGORY).defaultTone,
);

// ------------------------------------------------- who reads the one owner

const form = readFileSync(join(root, "app", "new", "NewVideoForm.tsx"), "utf8");
const actions = readFileSync(join(root, "app", "actions.ts"), "utf8");

check("the brief takes its chips from lib/tones", /import \{ TONES \} from "@\/lib\/tones"/.test(form), true);
check("and keeps no second copy of the list", /const TONES\s*=\s*\[/.test(form), false);
check(
  "the row starts on the category's tone rather than a constant",
  /useState\(series\?\.tone \|\| getCategory\(initialCategory\)\.defaultTone\)/.test(form),
  true,
);
check(
  "and follows the category only while untouched",
  /if \(!toneTouched\) setTone\(getCategory\(category\)\.defaultTone\)/.test(form),
  true,
);
// The load-bearing line. Without it the effect above owns the row forever and
// silently overwrites whatever the producer picked, on the next category
// click.
check("a chip click makes the tone the producer's", /setToneTouched\(true\)/.test(form), true);
check(
  "and nothing ever hands it back to the category",
  /setToneTouched\(false\)/.test(form),
  false,
);
check(
  "the server backstop asks the category too",
  /formData\.get\("tone"\) \|\| getCategory\(String\(formData\.get\("category"\)[^)]*\)\)\.defaultTone/.test(
    actions,
  ),
  true,
);
// `??` would let an empty string through, and "" matches no profile.
check('and does it with "||", not "??"', /formData\.get\("tone"\) \?\?/.test(actions), false);

// Keep this LAST: a `process.exit` anywhere above it silently skips every
// case below, while still printing a cheerful all-passed summary. That
// happened once in check-watermark.mjs and cost an evening.
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
