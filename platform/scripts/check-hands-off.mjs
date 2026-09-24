// Hands-off by step (lib/hands-off.ts) — the reading of a film's list pinned
// against fixtures, the whole read path through derive.ts, and the joints on
// the project page that decide where "Auto-accept this step" appears and what
// the chime keeps quiet.
//
// The n8n half — the orchestrator's node body, byte-for-byte additive — is
// db/port/hands-off-steps/check.mjs (`npm run check:hands-off-node`).
//
//   node --experimental-strip-types --no-warnings --import ./scripts/footage-loader.mjs scripts/check-hands-off.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTO_STEPS,
  autoStepsOf,
  describeAutoSteps,
  isEveryStep,
  normalizeAutoSteps,
  withAutoStep,
} from "@/lib/hands-off";
import { STAGE_KEYS } from "@/lib/deep-link";
import { buildProject } from "@/lib/data/derive";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};

// ------------------------------------------------------------ the vocabulary
is("the steps are the project page's own step keys", AUTO_STEPS.every((s) => STAGE_KEYS.includes(s)), true);
is("in pipeline order", [...AUTO_STEPS], ["script", "scenes", "audio", "images", "video", "final"]);

// --------------------------------------------------------------- the reading
is("a list is read in pipeline order, each once", normalizeAutoSteps(["video", "script", "video"]), ["script", "video"]);
is("the brief's comma form too", normalizeAutoSteps(" images , final,bogus"), ["images", "final"]);
is("an empty string is chosen-nothing", normalizeAutoSteps(""), []);
is("not a list at all is no answer", [normalizeAutoSteps(undefined), normalizeAutoSteps(null), normalizeAutoSteps(3)], [null, null, null]);

is("a film with only the old switch on reads as EVERY step", autoStepsOf({ autoApprove: true }), [...AUTO_STEPS]);
is("the list, when there is one, wins over the switch", autoStepsOf({ autoApprove: true, autoApproveSteps: ["images"] }), ["images"]);
is("…even an empty one", autoStepsOf({ autoApprove: true, autoApproveSteps: [] }), []);
is("nothing is nothing", autoStepsOf({}), []);
is("the switch stays strict: a truthy string is not a yes", autoStepsOf({ autoApprove: "true" }), []);
is("no options at all", autoStepsOf(null), []);

is("every step reads as every step", describeAutoSteps([...AUTO_STEPS]), "every step");
is("one", describeAutoSteps(["images"]), "Images");
is("two", describeAutoSteps(["video", "images"]), "Images and Video");
is("three, with the render named plainly", describeAutoSteps(["script", "images", "final"]), "Script, Images and Final render");
is("isEveryStep", [isEveryStep([...AUTO_STEPS]), isEveryStep(["script"])], [true, false]);
is("switching a step on keeps the order", withAutoStep(["video"], "script", true), ["script", "video"]);
is("switching it off leaves the rest", withAutoStep(["script", "video"], "script", false), ["video"]);

// ------------------------------------------------- the whole read path (derive)
const raw = (editing) => ({
  id: "recTEST", name: "x", tone: "Dark", aspectRaw: "16:9", noCaptions: false,
  lengthSeconds: 60, statusRaw: "În Lucru", finalVideoUrl: null,
  editingRaw: JSON.stringify(editing), language: "English", voiceId: "",
  createdAt: null, paceRaw: "Normal",
});
const ed = (e) => {
  const p = buildProject(raw(e)).editing;
  return [p.autoApprove, p.autoApproveSteps];
};
is("an old hands-off film: on, every step", ed({ autoApprove: true }), [true, [...AUTO_STEPS]]);
is("a film that chose two steps", ed({ autoApprove: true, autoApproveSteps: ["images", "video"] }), [true, ["images", "video"]]);
is("a film that chose none", ed({ autoApprove: false, autoApproveSteps: [] }), [false, []]);
is("a film that never said anything", ed({}), [false, []]);

// ------------------------------------------------------------------ the joints
const page = readFileSync(join(root, "app", "projects", "[id]", "page.tsx"), "utf8");
const actions = readFileSync(join(root, "app", "actions.ts"), "utf8");
const form = readFileSync(join(root, "app", "new", "NewVideoForm.tsx"), "utf8");
const pilot = readFileSync(join(root, "components", "AutoPilot.tsx"), "utf8");
const series = readFileSync(join(root, "lib", "series.ts"), "utf8");

is("AutoPilot is handed the film's steps", /<AutoPilot projectId=\{id\} steps=\{project\.editing\.autoApproveSteps\} \/>/.test(page), true);
is("…and names them when they are not every step", /describeAutoSteps\(steps\)/.test(pilot), true);
is("the per-step button offers exactly the steps on screen", /<AutoStepToggle projectId=\{id\} steps=\{autoHere\} on=\{project\.editing\.autoApproveSteps\} \/>/.test(page), true);
is("…and is never offered while a render runs", /\{!renderLocked && project\.statusKind !== "done" && project\.statusKind !== "err" && \(\s*<AutoStepToggle/.test(page), true);
is("the chime is quiet only for a gate that signs itself off", /project\.editing\.autoApproveSteps\.includes\(GATE_STEP\[stage\] as AutoStep\)/.test(page), true);
is("a step switched from the page is validated", /if \(!isAutoStep\(step\)\) return \{ ok: false, message: "Unknown step\." \};/.test(actions), true);
is("the list and the switch are written together, always", /updateEditingOptions\(projectId, \{ autoApproveSteps: steps, autoApprove: steps\.length > 0 \}\)/.test(actions), true);
is("Turn off clears every step", /await writeAutoSteps\(projectId, on \? \[\.\.\.AUTO_STEPS\] : \[\]\);/.test(actions), true);
is("the brief has no Audio chip for a silent film", /AUTO_STEPS\.filter\(\(st\) => !\(silent && st === "audio"\)\)/.test(form), true);
is("…and a list left with only Audio reads as off", /const autoApprove = autoShown\.length > 0;/.test(form), true);
is("an episode starts from its show's choice", /series\?\.autoApproveSteps \?\? \(series\?\.autoApprove \? \[\.\.\.AUTO_STEPS\] : \[\]\)/.test(form), true);
is("a show that froze the old switch keeps meaning it", /stored\.autoApproveSteps \?\? \(stored\.autoApprove === null \? derived\.autoApproveSteps : null\)/.test(series), true);

// Keep this LAST (see check-watermark.mjs).
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
