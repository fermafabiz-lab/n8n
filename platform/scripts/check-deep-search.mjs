// check-deep-search.mjs — the Deep Search status machine, pinned.
//
//     npm run check:deepsearch
//
// WHY THIS EXISTS. The producer asked for one thing above all: *"in the case
// anything stops working I want the thing to become Red so I can tell you to
// solve it."* An alarm is only worth having if it is right in both directions,
// and both directions fail quietly:
//
//   - a MISSED fault is a documentary that silently went unchecked, which is
//     the whole problem this was built to prevent;
//   - a FALSE alarm is worse in slow motion, because a light that cries wolf
//     is a light the producer learns to ignore, and then the real one lands
//     on a page nobody reads any more.
//
// So every branch is asserted here, including the ones that must NOT be red.

import { deepSearchState, deepSearchTone } from "../lib/deep-search.ts";

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`);
  }
};

const finding = (action, verdict = "unsupported") => ({
  quote: "q",
  verdict,
  action,
});

console.log("Nothing to report");
{
  const s = deepSearchState({ report: null, isDocumentary: false, scriptExists: true });
  ok("a story film with no report is off, not broken", s.status === "off" && s.red === false);
}
{
  const s = deepSearchState({ report: null, isDocumentary: true, scriptExists: false });
  ok("a documentary still being written is not late yet", s.status === "working" && s.red === false);
}
{
  // THE HEADLINE CASE. `FC Save Report` runs before `Combine Chapters`, which
  // runs before the script row is written — so a documentary with a script and
  // no report is a fault, never a race.
  const s = deepSearchState({ report: null, isDocumentary: true, scriptExists: true });
  ok("a documentary that reached its script with no report is RED", s.status === "broken" && s.red === true);
  ok("and says what to do about it", /should have one|did not run/i.test(s.detail));
}

console.log("Older than the feature");
{
  // The producer's Google Maps film: a documentary whose script was written an
  // hour before the chain existed. Calling that a fault would light the alarm
  // on history, and the very first thing they saw would be a false one.
  const s = deepSearchState({
    report: null,
    isDocumentary: true,
    scriptExists: true,
    createdAt: "2026-09-18T13:22:50Z",
  });
  ok("a documentary written before Deep Search existed is not a fault", s.status === "off" && s.red === false);
  ok("and says why rather than going quiet", /before Deep Search existed/i.test(s.detail));
}
{
  const s = deepSearchState({
    report: null,
    isDocumentary: true,
    scriptExists: true,
    createdAt: "2026-09-18T16:00:00Z",
  });
  ok("a documentary written after it is still RED", s.status === "broken" && s.red === true);
}
{
  // An unknown age must not become a free pass, or a backend that stops
  // returning the date would switch the alarm off everywhere at once.
  const s = deepSearchState({ report: null, isDocumentary: true, scriptExists: true, createdAt: null });
  ok("an unknown creation date is not an excuse", s.red === true);
}

console.log("Skips");
{
  const s = deepSearchState({
    report: { skipCode: "not-documentary", skipped: "made in Story mode", checked: 0 },
    isDocumentary: false,
    scriptExists: true,
  });
  ok("not-documentary is normal, never red", s.status === "off" && s.red === false);
}
{
  const s = deepSearchState({
    report: { skipCode: "story", skipped: "it tells a story", checked: 0 },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("a documentary whose narration is a story is not a fault", s.status === "off" && s.red === false);
}
{
  for (const code of ["no-mode", "not-researched", "no-pack", "no-chapters", "unknown"]) {
    const s = deepSearchState({
      report: { skipCode: code, skipped: "x", checked: 0 },
      isDocumentary: true,
      scriptExists: true,
    });
    ok(`${code} is RED`, s.status === "broken" && s.red === true);
  }
}
{
  // A code this file has never heard of must fail CLOSED. Otherwise a future
  // workflow could turn the light green by inventing a reason.
  const s = deepSearchState({
    report: { skipCode: "some-future-reason", skipped: "x", checked: 0 },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("an unknown skip code is RED, not silently accepted", s.red === true);
}

console.log("Ran");
{
  const s = deepSearchState({
    report: { checked: 0, findings: [] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("ran and checked nothing at all is RED", s.status === "broken" && s.red === true);
  ok("and does not read as a clean bill", !/all/i.test(s.label));
}
{
  const s = deepSearchState({
    report: { checked: 12, flagged: 0, rewritten: 0, findings: [finding("kept", "supported")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("everything held up is clean", s.status === "clean" && s.red === false);
}
{
  const s = deepSearchState({
    report: { checked: 12, flagged: 2, rewritten: 2, findings: [finding("rewritten"), finding("kept", "supported")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("corrected and nothing left standing is not red", s.status === "corrected" && s.red === false);
  ok("and warns that the script on screen already changed", /corrected/i.test(s.detail));
}
{
  const s = deepSearchState({
    report: { checked: 12, flagged: 3, rewritten: 1, findings: [finding("flagged"), finding("rewritten")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("statements still standing is flagged, NOT red", s.status === "flagged" && s.red === false);
  ok("and counts what stands, not what was found", s.label.startsWith("1 "));
}
{
  const s = deepSearchState({
    report: { checked: 20, rewritten: 0, overwhelmed: true, findings: [finding("flagged")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("the overwhelmed backstop is reported, not alarmed", s.status === "flagged" && s.red === false);
  ok("and says nothing was changed", /nothing was changed/i.test(s.detail));
}
{
  const s = deepSearchState({
    report: { checked: 9, rewritten: 0, refused: "chapter 2 went from 300 to 180 words", findings: [finding("flagged")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("a refused rewrite is the safety valve working, not a fault", s.status === "flagged" && s.red === false);
  ok("and names the refusal so it is not mysterious", s.detail.includes("300 to 180"));
}
{
  // A SENTENCE THAT WAS CUT IS SETTLED, not standing. Left out of the settled
  // set it would light the same warning as an unsourced statement, so a film
  // that was tidied would read as a film with a problem.
  const s = deepSearchState({
    report: { checked: 12, flagged: 1, rewritten: 0, deduped: 1, findings: [finding("cut", "redundant"), finding("kept", "supported")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("a cut repeat is not a problem still standing", s.status === "corrected" && s.red === false);
  ok("and the deletion is said out loud", /repeated something said earlier/i.test(s.detail));
  ok("without claiming a correction to reread", !/corrected 1 sentence/i.test(s.detail));
}
{
  // A repeat the rewrite did NOT remove. The sources back it, so the wording
  // must not call it unsupported — the fault is that the film says it twice.
  const s = deepSearchState({
    report: { checked: 12, flagged: 1, rewritten: 0, findings: [finding("flagged", "redundant")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("an uncut repeat still counts as standing", s.status === "flagged" && s.red === false);
}
{
  // A RE-RUN ON A FILM PAST ITS SCRIPT GATE checks in full and refuses to edit,
  // because the scenes carry their own copy of every line and their own
  // recordings by then. Unsaid, "3 unsupported" on an approved film reads as a
  // correction that is still coming, and none is.
  const s = deepSearchState({
    report: { checked: 14, rewritten: 0, frozen: true, rerun: true, scope: "final", findings: [finding("flagged")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("a frozen re-run is flagged, not red", s.status === "flagged" && s.red === false);
  ok("and says why nothing was corrected", /past its script gate/i.test(s.detail));
  ok("and points at the scenes, which is where the text now lives", /scenes/i.test(s.detail));
}

console.log("A correction that made the film shorter than it was ordered");
{
  // NEVER A REFUSAL AND NEVER RED. `short` says the research does not cover the
  // running time the producer asked for — a decision for them (more research,
  // or a shorter film), not a fault in the chain. It rides along with whatever
  // the report's real verdict is.
  const s = deepSearchState({
    report: {
      checked: 22,
      rewritten: 4,
      short: { words: 137, min: 133 },
      findings: [finding("rewritten"), finding("kept", "supported")],
    },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("a short correction is still a correction", s.status === "corrected" && s.red === false);
  ok("and the producer is told the film came up short", /137 words against the 133/.test(s.detail));
  ok("and told what to do about it", /more|shorter/i.test(s.detail));
}
{
  // The same note has to reach the producer when statements are still standing,
  // which is the case where they are most likely to act on it.
  const s = deepSearchState({
    report: { checked: 22, rewritten: 2, short: { words: 90, min: 133 }, findings: [finding("flagged")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("the shortness note survives a flagged report", /90 words against the 133/.test(s.detail));
}
{
  // ABSENT MEANS NOTHING TO SAY. A report from before `short` existed, and a
  // correction that stayed inside the window, must read identically.
  const s = deepSearchState({
    report: { checked: 22, rewritten: 4, findings: [finding("rewritten")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("no shortness, no sentence about it", !/words against the/.test(s.detail));
}

console.log("Tone");
{
  ok("broken is the error tone", deepSearchTone("broken") === "err");
  ok("flagged is a warning, not an error", deepSearchTone("flagged") === "wait");
  ok("clean is the ok tone", deepSearchTone("clean") === "ok");
}

console.log("");
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All Deep Search status checks passed.");
