// `watermark_open_once` crosses a webhook body, a Code node and a jsonb column
// before it reaches a render — and it has no loud failure anywhere on that
// path. The brief would post the choice, n8n would drop it, and the film would
// come back announcing every source in full: exactly what the producer asked
// it not to do, and indistinguishable from "the feature does not work".
//
// So this runs the orchestrator's REAL node body — the file that was pasted
// into n8n, not a paraphrase of it — against fixtures, with no n8n and no
// network, and then checks the site's read side agrees with it.
//
//   node db/port/watermark-open-once/check.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

let pass = 0;
const fails = [];
const is = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
    console.log(`OK   ${label} -> ${JSON.stringify(got)}`);
  } else {
    fails.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    console.log(`FAIL ${label} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
  }
};

// ---- run the node body ----------------------------------------------------
// An n8n Code node is a function body with `$json` in scope that returns an
// array of items. Wrapping it in `new Function` is what makes this a test of
// the SHIPPED text rather than of a second implementation of it.
const body = readFileSync(join(here, 'paste', 'orch-Normalize_Webhook_Input.js'), 'utf8');
const run = (webhookBody) => {
  const fn = new Function('$json', body);
  const out = fn({ body: webhookBody });
  return JSON.parse(out[0].json.editingOptions);
};

const BRIEF = { name: 'A film', category: 'story', length: 60 };
const opts = (extra) => run({ ...BRIEF, ...extra });

is('yes stores the switch on', opts({ watermark_open_once: 'yes' }).watermarkOpenOnce, true);
is('no stores it off', opts({ watermark_open_once: 'no' }).watermarkOpenOnce, false);
// The one that matters: every film made before this existed, and every brief
// that does not mention it, must keep announcing every source.
is('absent is off', opts({}).watermarkOpenOnce, false);
// A hand-typed string is not a yes. Same strictness as `endFrame` next door,
// and for the same reason: there is no UI that can produce these, so anything
// but the exact value is a mistake and must fail towards the loud default.
is('a truthy string is not a yes', opts({ watermark_open_once: 'true' }).watermarkOpenOnce, false);
is('nor is 1', opts({ watermark_open_once: 1 }).watermarkOpenOnce, false);
is('a real boolean is', opts({ watermark_open_once: true }).watermarkOpenOnce, true);

// The key travels in the SAME blob as everything else the brief chose, so a
// mistake in the block above would be visible as a neighbour going missing.
const full = opts({ watermark_open_once: 'yes', music: 'yes', drawn_cards: 'no' });
is('its neighbours are untouched', [full.music, full.drawnCards, full.chapterCards], [true, false, true]);

// ---- the site posts the name this node reads ------------------------------
// Two spellings, in two languages, either side of an HTTP boundary. A drift
// is silent, which is the whole reason this file exists.
const form = readFileSync(join(root, 'platform/app/new/NewVideoForm.tsx'), 'utf8');
const actions = readFileSync(join(root, 'platform/app/actions.ts'), 'utf8');
is('the brief posts the field', /name="watermark_open_once"/.test(form), true);
is('and createProject forwards it to the webhook', /watermark_open_once:/.test(actions), true);
// The values have to be the node's vocabulary, not a boolean or a label.
is('as the yes|no the node reads', /watermark_open_once"\s+value=\{[^}]*"yes"\s*:\s*"no"\}/.test(form), true);

// ---- and the read side agrees ---------------------------------------------
const derive = readFileSync(join(root, 'platform/lib/data/derive.ts'), 'utf8');
is(
  'derive.ts still refuses anything but a real true',
  /watermarkOpenOnce:\s*opts\.watermarkOpenOnce === true/.test(derive),
  true,
);

// ---- the badge SIZE, which lives in four languages ------------------------
// The multiplier is refused-not-clamped in platform/lib/provenance.ts,
// remotion/src/provenance.ts, the orchestrator's Normalize node and Final
// Assembly's `Source Watermark` node. Nothing makes a drift loud on its own:
// a film would simply be drawn at a size the slider cannot produce, or the
// slider would offer one the render refuses and silently reset to 1 — which
// reads as "the slider does nothing".
is('the node stores the size', opts({ watermark_scale: 1.35 }).watermarkScale, 1.35);
is('an absent size is the standard one', opts({}).watermarkScale, 1);
is('over the top end is refused, NOT clamped', opts({ watermark_scale: 4 }).watermarkScale, 1);
is('and so is under the bottom', opts({ watermark_scale: 0.2 }).watermarkScale, 1);
is('as is a word', opts({ watermark_scale: 'big' }).watermarkScale, 1);
is('the ends themselves are allowed', [opts({ watermark_scale: 0.7 }).watermarkScale, opts({ watermark_scale: 1.6 }).watermarkScale], [0.7, 1.6]);

// The four copies of the range, parsed back out of the text that ships.
//
// Anchored to the line that mentions the size, NOT to the first `n >= … &&
// n <= …` in the file: the orchestrator's `normalizeSpeed` is such a clause
// too, six lines up, and an unanchored pattern read ITS bounds (0.5, 2) and
// reported the copies as disagreeing. A regex over a whole file finds the
// first thing shaped like the answer, which is not the same as the answer.
// A WINDOW from that anchor rather than the anchor line itself, because the
// two copies are written differently: the orchestrator's is a one-liner and
// Final Assembly's spans three lines, so the bounds are not on the line that
// names the key. Four lines is enough for both and still nowhere near the
// next unrelated clause.
const boundsOf = (text) => {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /body\.watermarkScale|watermarkScale: \(\(\)/.test(l));
  if (at < 0) return null;
  const m = /n >= (\d(?:\.\d+)?) && n <= (\d(?:\.\d+)?)/.exec(lines.slice(at, at + 4).join('\n'));
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const prov = readFileSync(join(root, 'platform/lib/provenance.ts'), 'utf8');
const site = /min:\s*(\d(?:\.\d+)?),\s*\n\s*max:\s*(\d(?:\.\d+)?)/.exec(prov);
is('the site declares a range', !!site, true);
const want = site ? [Number(site[1]), Number(site[2])] : null;

const faB = boundsOf(readFileSync(join(here, 'paste', 'Source Watermark.js'), 'utf8')); // eslint-disable-line
is('Final Assembly still bounds the size', !!faB, true);
is('and agrees with the site', faB, want);

const orchB = boundsOf(body);
is('the orchestrator still bounds it', !!orchB, true);
is('and agrees too', orchB, want);

const remotion = readFileSync(join(root, 'remotion/src/provenance.ts'), 'utf8');
const rem = /min:\s*(\d(?:\.\d+)?),\s*\n\s*max:\s*(\d(?:\.\d+)?)/.exec(remotion);
is('the render declares the same range', rem && [Number(rem[1]), Number(rem[2])], want);

// ---- and the label is a DOCUMENTARY feature ------------------------------
// 2026-09-19, the producer's call, made against the warning in CLAUDE.md that
// a gate telling two kinds of film apart must not trust `category` — `story`
// is the site's default and 8 of 11 researched films in the database carry it.
// The decision stands; what must NOT happen is it becoming silent, so the
// three places that implement it are pinned here together.
const fa = readFileSync(join(here, 'paste', 'Source Watermark.js'), 'utf8');
is(
  'Final Assembly gates the label on the category',
  /showSourceWatermark = opts\.sourceWatermark !== false && isDocumentary/.test(fa),
  true,
);
is(
  "and 'documentary' is the only value that passes",
  /isDocumentary = String\(opts\.category \|\| 'story'\) === 'documentary'/.test(fa),
  true,
);
// The credit is NOT gated. It is a licence obligation, it is decided from the
// provenance rather than from this flag, and no category may reach it.
is(
  'the credit is not gated with it',
  /attributionRequired|credit/.test(fa) === false || !/credit[^\n]*isDocumentary/.test(fa),
  true,
);
// A film that ships unlabelled has to be greppable in the run log afterwards.
is('the log says when a film was skipped for its category', /not a documentary: category=/.test(fa), true);
// And the producer has to be able to see it BEFORE the render, not after —
// the row is dropped on both screens, and Final touches says why.
const finalSettings = readFileSync(join(root, 'platform/components/FinalSettings.tsx'), 'utf8');
is(
  'Final touches drops the row off a documentary',
  /!\(!isDocumentary && o\.key === "sourceWatermark"\)/.test(finalSettings),
  true,
);
is(
  'and says so rather than dropping it silently',
  /No source labels on this film/.test(finalSettings),
  true,
);
is(
  'the brief drops it too',
  /f\.name === "source_watermark" && category !== "documentary"/.test(form),
  true,
);

// The site half of the control, as with the switch above.
is('the brief posts the size', /name="watermark_scale"/.test(form), true);
is('and createProject forwards it', /watermark_scale:/.test(actions), true);
is(
  'derive.ts runs it through the shared refusal',
  /watermarkScale:\s*normalizeWatermarkScale\(opts\.watermarkScale\)/.test(derive),
  true,
);

console.log(`\n${pass}/${pass + fails.length} passed`);
if (fails.length) {
  for (const f of fails) console.log(`  ${f}`);
  process.exit(1);
}
