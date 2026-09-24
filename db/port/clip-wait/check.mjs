#!/usr/bin/env node
//
// check.mjs — the two video poll ceilings, run against fixtures.
//
//     node db/port/clip-wait/check.mjs
//
// WHY THIS EXISTS. These two nodes decide how long the pipeline waits before
// it admits a clip is not coming. The number was an hour, unmeasured, and the
// producer paid for it in whole afternoons (see README). A check is the only
// thing that keeps a measured number from drifting back into a guess, and
// that keeps the batch's copy and the regeneration's copy in step.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, 'paste', f), 'utf8');
const BATCH = read('Check Job Status.js');
const REGEN = read('Check Video Regen.js');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
};

// Each body is an n8n Code node reading $json, $('Current Scene') and the
// workflow's static data. `polls` is handed in so a fixture can put the node
// at any point in a scene's poll sequence.
function run(body, { json = {}, polls = 0, sceneId = 'recScene1' } = {}) {
  // The batch counts in sd.polls, the regeneration in sd.regenPolls —
  // separate counters on purpose (one pass resets the batch's, the gate
  // owns the regen's), so a fixture seeds both.
  const sd = { polls: { [sceneId]: polls }, regenPolls: { [sceneId]: polls } };
  const logs = [];
  const fn = new Function('$input', '$json', '$', '$getWorkflowStaticData', 'console', body);
  const out = fn(
    { first: () => ({ json }), all: () => [{ json }] },
    json,
    (name) => {
      // The batch asks 'Current Scene'; the regeneration asks its own
      // self-contained 'Prep Video Regen' (db/port/video-regen-webhook).
      if (name !== 'Current Scene' && name !== 'Prep Video Regen') {
        throw new Error(`No node called "${name}"`);
      }
      return { first: () => ({ json: { id: sceneId, scene_id: sceneId } }) };
    },
    () => sd,
    { log: (...a) => logs.push(a.join(' ')) },
  );
  return { ...out[0].json, polls: sd.polls[sceneId], logs };
}

const WAIT_SECONDS = 30; // 'Wait Video' / 'Wait Video Regen'
const ceiling = (body) => Number(/MAX_POLLS\s*=\s*(\d+)/.exec(body)[1]);

console.log('The ceiling is a measured number, not a guess');
ok('the batch waits 10 minutes for a clip, not an hour',
  ceiling(BATCH) * WAIT_SECONDS === 600, `${(ceiling(BATCH) * WAIT_SECONDS) / 60} min`);
ok('the regeneration waits exactly as long', ceiling(REGEN) === ceiling(BATCH));
// 391 s is the worst legitimate clip ever recorded here (2026-09-18 A/B).
// The ceiling has to clear it with room, or a slow-but-fine clip is thrown
// away and re-shot for nothing.
ok('…which clears the worst clip ever measured (6m31) with margin',
  ceiling(BATCH) * WAIT_SECONDS > 391 * 1.4, `${ceiling(BATCH) * WAIT_SECONDS}s vs 547s`);
// Five resubmits per scene (Resubmit Guard), so this is the real worst case
// a producer can sit through on one scene.
ok('…and one scene can no longer eat five hours',
  (ceiling(BATCH) * WAIT_SECONDS * 5) / 60 <= 60, `${(ceiling(BATCH) * WAIT_SECONDS * 5) / 60} min`);
ok('the batch body records what was measured', /391 s \(6m31\)/.test(BATCH));

console.log('A finished job is still finished');
const done = run(BATCH, { json: { status: 'completed' } });
ok('a completed job is done', done.done === true && done.jobFailed === false);
const byUrl = run(BATCH, { json: { status: 'pending', video: 'https://flow-content.google/video/x.mp4' } });
ok('…and so is one recognised only by its URL', byUrl.done === true);

console.log('A dead job is given up on at the ceiling, not before');
const justUnder = run(BATCH, { json: { status: 'pending' }, polls: ceiling(BATCH) - 1 });
ok('one poll short of the ceiling it keeps waiting',
  justUnder.done === false && justUnder.jobFailed === false);
const atCeiling = run(BATCH, { json: { status: 'pending' }, polls: ceiling(BATCH) });
ok('one poll past it the job is failed, so Resubmit Guard re-shoots it',
  atCeiling.jobFailed === true);
ok('…and it says so, with the count', atCeiling.logs.some((l) => /still not done after 20 polls/.test(l)));
ok('…and carries a reason a human can read', /polling timed out/.test(String(atCeiling.error)));

console.log('Explicit failures still short-circuit');
for (const status of ['failed', 'error', 'cancelled']) {
  ok(`a ${status} job does not wait out the ceiling`,
    run(BATCH, { json: { status } }).jobFailed === true);
}
ok('the regeneration path behaves the same at its ceiling',
  run(REGEN, { json: { status: 'pending' }, polls: ceiling(REGEN) }).jobFailed === true);

// The site half. The ceiling is only half the fix: the other half is that a
// producer can SEE the wait, so the reflex stops being Stop → Resume (which
// resets the counter and starts the hour again). Greps, because what is being
// guarded is that somebody quietly deleted the clock.
const site = (f) => readFileSync(join(here, '..', '..', '..', 'platform', f), 'utf8');
const clock = site('components/ClipWait.tsx');
const board = site('components/SceneBoard.tsx');
const waited = site('lib/use-waited.ts');

console.log('The producer can see the wait');
ok('the scene panel draws the clock', /<ClipWait since=\{active\.updatedAt\}/.test(board));
ok('…only while a clip is actually being made',
  /!active\.videoUrl &&\s*\n\s*!active\.regenVideo/.test(board));
ok('the clock says how long', /useWaited\(since\)/.test(clock));
ok('…and tells the producer not to stop production', /Don&apos;t stop production/.test(clock));
// Comments are not copy: the docstring explains the Stop-then-Resume loop
// this exists to break, and grepping the raw file would fail on its own
// history. Strip comments first, exactly as check-fact-check does.
const spoken = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('…and never advises Pause or Resume to the producer',
  !/\bPause\b|\bResume\b/.test(spoken(clock)));

console.log('The number the site quotes is the number the pipeline uses');
const quoted = Number(/CLIP_RESHOOT_MINUTES = (\d+)/.exec(waited)[1]);
ok('the site quotes the real ceiling', quoted * 60 === ceiling(BATCH) * WAIT_SECONDS,
  `site ${quoted} min vs n8n ${(ceiling(BATCH) * WAIT_SECONDS) / 60} min`);
ok('…and the clock reads it rather than hard-coding a number',
  /CLIP_RESHOOT_MINUTES/.test(clock) && !/\b10-minute\b/.test(clock));
ok('the age logic has ONE owner, shared with the regen badge',
  /useWaited/.test(site('components/RegenBadge.tsx')));

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll clip-wait checks passed.');
process.exit(failures ? 1 : 0);
