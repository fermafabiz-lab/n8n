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

import { readFileSync } from "node:fs";
import { deepSearchState, deepSearchTone, scriptChangesIn } from "../lib/deep-search.ts";

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

console.log("The top-up — sourced sentences added back");
{
  // ADDED WORDS ARE A CHANGE TO THE TEXT, so a report whose only change is an
  // addition must not read as "All checked": the producer is about to approve
  // a script with sentences in it the judge has not read.
  const s = deepSearchState({
    report: {
      checked: 12,
      rewritten: 0,
      filled: { sentences: 2, words: 31, added: [{ chapter: 1, sentence: "x", ref: "LIVE" }] },
      findings: [finding("kept", "supported")],
    },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("an addition alone is a change, not a clean bill", s.status === "corrected" && s.red === false);
  ok("and the chip counts what was added", s.label === "2 added");
  ok("and the detail says so, and that each names its source", /2 sourced sentences were added/.test(s.detail) && /names its source/.test(s.detail));
}
{
  // ALONGSIDE A CORRECTION the correction keeps the chip; the addition is said
  // in the detail rather than lost.
  const s = deepSearchState({
    report: {
      checked: 12,
      rewritten: 3,
      filled: { sentences: 1, words: 15 },
      findings: [finding("rewritten")],
    },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("a correction keeps its own label", s.label === "3 fixes");
  ok("and the addition rides in the detail", /1 sourced sentence was added/.test(s.detail));
}
{
  // STILL SHORT, AND WHY — from the MEASURED gap, with "nothing more to add"
  // only when the model actually said it ran out.
  const exhausted = deepSearchState({
    report: { checked: 12, rewritten: 3, filled: { sentences: 0, words: 0, shortBy: 48, exhausted: true }, findings: [finding("rewritten")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("a film still short is told how short", /about 48 words shorter than it was before Deep Search/.test(exhausted.detail));
  ok("and that its sources had nothing more, when that was said", /nothing more to add that its sources back/.test(exhausted.detail));
  const notSaid = deepSearchState({
    report: { checked: 12, rewritten: 3, filled: { sentences: 1, words: 15, shortBy: 30 }, findings: [finding("rewritten")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("but never claims the sources ran out when nobody said so", /30 words shorter/.test(notSaid.detail) && !/nothing more to add/.test(notSaid.detail));
  // THE FIRST LIVE PRESS: "exhausted" with no search behind it. The guard no
  // longer believes it, and the panel says the one true thing — nobody looked.
  const unlooked = deepSearchState({
    report: { checked: 12, rewritten: 2, filled: { sentences: 1, words: 15, shortBy: 44, looked: false }, findings: [finding("rewritten")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("a gap nobody searched for says so, and points at the button", /web was not searched for more/.test(unlooked.detail) && /Re-check may find some/.test(unlooked.detail) && !/nothing more to add/.test(unlooked.detail));
  const small = deepSearchState({
    report: { checked: 12, rewritten: 3, filled: { sentences: 1, words: 15, shortBy: 12 }, findings: [finding("rewritten")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("a gap under a sentence or two is not worth a line", !/shorter than it was/.test(small.detail));
  const both = deepSearchState({
    report: { checked: 12, rewritten: 3, short: { words: 90, min: 133 }, filled: { sentences: 0, words: 0, shortBy: 60 }, findings: [finding("rewritten")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("and never on top of `short`, which already says more", /90 words against the 133/.test(both.detail) && !/shorter than it was before/.test(both.detail));
}
{
  // A report from before the top-up existed must read exactly as it did.
  const s = deepSearchState({
    report: { checked: 12, rewritten: 0, findings: [finding("kept", "supported")] },
    isDocumentary: true,
    scriptExists: true,
  });
  ok("no `filled`, no mention of it", s.status === "clean" && !/added|shorter than it was/.test(s.detail));
}

console.log("What makes the page reload after a re-check");
{
  // THE BUTTON'S RELOAD DECISION. `ScriptReview` seeds its textarea once, so
  // any change to the text needs a real reload — and it used to be read off
  // `rewritten` alone, so a press that only cut a repeat left the old wording
  // on screen under "Nothing needed changing". Every kind of change counts.
  ok("nothing changed, no reload", scriptChangesIn({ checked: 5, rewritten: 0 }) === 0);
  ok("a correction reloads", scriptChangesIn({ rewritten: 2 }) === 2);
  ok("a cut repeat alone reloads", scriptChangesIn({ rewritten: 0, deduped: 1 }) === 1);
  ok("an addition alone reloads", scriptChangesIn({ filled: { sentences: 2, words: 30 } }) === 2);
  ok("all three add up", scriptChangesIn({ rewritten: 1, deduped: 1, filled: { sentences: 1, words: 15 } }) === 3);
  ok("no report, no reload", scriptChangesIn(null) === 0);
}
{
  // The button must be handed that sum, not `rewritten`.
  const panel = readFileSync(new URL("../components/DeepSearchPanel.tsx", import.meta.url), "utf8");
  const button = readFileSync(new URL("../components/DeepSearchRerun.tsx", import.meta.url), "utf8");
  ok("the panel hands the button every change", panel.includes("changed={scriptChangesIn(report)}"));
  ok("and the button reloads on it", button.includes("if ((changed ?? 0) > 0) {") && !/rewritten\s*\?\?\s*0\)\s*>\s*0/.test(button));
  ok("the panel lists what was added, with its source", panel.includes("function Addition(") && panel.includes("found by a web search"));
  ok("and the all-clear no longer claims the judge read the additions", panel.includes("came\n              after the check"));
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
