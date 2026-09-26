// The library's "Recently worked on" order — the ordering itself, pinned
// against fixtures, and the joints it hangs on, pinned against the sources.
//
// The database half (which changes count as activity) is proved on a real
// engine by db/port/activity-order/check-trigger.mjs; it needs PGlite, which
// is not a site dependency, so it cannot live here. What CAN live here is
// everything that silently undoes it: the migration losing its publishing
// exclusion, getProjects no longer selecting the activity, pause forgetting to
// stamp, the grid sorting AFTER scoping (so playlists and tabs would keep the
// old order), or the hold that stops a card moving under a click.
//
//   node --experimental-strip-types --no-warnings scripts/check-activity-order.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};

const { orderLibrary, parseLibraryOrder } = await import(join(root, "lib", "library-order.ts"));
const { PROJECT_ACTIVITY_SQL } = await import(join(root, "lib", "data", "activity-sql.ts"));

const t = (h) => new Date(Date.UTC(2026, 8, 23, h)).toISOString();
// As the server sends it: newest CREATED first.
const LIB = [
  { id: "C", createdAt: t(12), activityAt: t(12) }, // made at noon, untouched since
  { id: "B", createdAt: t(10), activityAt: t(15) }, // older, but worked on at 3pm
  { id: "A", createdAt: t(8), activityAt: t(9) },
];
const ids = (list) => list.map((p) => p.id);

// ------------------------------------------------------------ the choice

check("no cookie means Recently worked on", parseLibraryOrder(undefined), "activity");
check("'created' is Newest first", parseLibraryOrder("created"), "created");
check("anything else falls back to the default", parseLibraryOrder("nonsense"), "activity");

// ------------------------------------------------------------- the order

check("Newest first is the server's order, untouched", ids(orderLibrary(LIB, "created")), ["C", "B", "A"]);
check("Recently worked on puts the last change first", ids(orderLibrary(LIB, "activity")), ["B", "C", "A"]);
check(
  "a tie keeps creation order (newer first)",
  ids(orderLibrary([{ id: "X", createdAt: t(11), activityAt: t(14) }, { id: "Y", createdAt: t(9), activityAt: t(14) }], "activity")),
  ["X", "Y"],
);
check(
  "no activity falls back to creation; neither sorts last",
  ids(orderLibrary([{ id: "N", createdAt: null, activityAt: null }, { id: "K", createdAt: t(7), activityAt: null }, { id: "M", createdAt: t(6), activityAt: t(6) }], "activity")),
  ["K", "M", "N"],
);
check("the input is not mutated", ids(LIB), ["C", "B", "A"]);

// ---------------------------------------------- the hold under the cursor

const shown = ids(orderLibrary(LIB, "activity")); // what is on screen: B, C, A
const later = [
  { id: "C", createdAt: t(12), activityAt: t(16) }, // the pipeline moved C at 4pm
  { id: "B", createdAt: t(10), activityAt: t(15) },
  { id: "A", createdAt: t(8), activityAt: t(9) },
];
check("unheld, the refresh moves C to the top", ids(orderLibrary(later, "activity")), ["C", "B", "A"]);
check("held, every card keeps its place", ids(orderLibrary(later, "activity", shown)), ["B", "C", "A"]);
const withNew = [{ id: "D", createdAt: t(17), activityAt: t(17) }, ...later];
check("held, a film that just appeared goes to the END, shifting nothing", ids(orderLibrary(withNew, "activity", shown)), ["B", "C", "A", "D"]);
check("…and takes its real place once released", ids(orderLibrary(withNew, "activity")), ["D", "C", "B", "A"]);
check("held, a film that vanished simply drops out", ids(orderLibrary(later.filter((p) => p.id !== "C"), "activity", shown)), ["B", "A"]);
check("an empty hold is no hold", ids(orderLibrary(later, "activity", [])), ["C", "B", "A"]);

// -------------------------------------------------------------- the joints

const sql = readFileSync(join(root, "..", "db", "014_project_activity.sql"), "utf8");
const pg = readFileSync(join(root, "lib", "data", "postgres.ts"), "utf8");
const actions = readFileSync(join(root, "app", "actions.ts"), "utf8");
const grid = readFileSync(join(root, "components", "ProjectsGrid.tsx"), "utf8");
const page = readFileSync(join(root, "app", "projects", "page.tsx"), "utf8");
const customize = readFileSync(join(root, "app", "admin", "customize", "page.tsx"), "utf8");

// BOTH sides of the comparison. The first version of this line matched either
// one, and a mutation that dropped the exclusion from the NEW side only —
// which makes every publishing mark count as activity — still passed it.
check(
  "the trigger ignores the Publishing panel, on both sides of the comparison",
  [/coalesce\(new\.editing_options, '\{\}'::jsonb\) - 'publishing'/.test(sql), /coalesce\(old\.editing_options, '\{\}'::jsonb\) - 'publishing'/.test(sql)],
  [true, true],
);
check("…and only it: every other column counts", /to_jsonb\(new\) - array\['updated_at', 'activity_at', 'editing_options'\]/.test(sql), true);
check("an explicit stamp (pause/resume/restart) is let through", /if new\.activity_at is distinct from old\.activity_at then\s+return new;/.test(sql), true);
check(
  "the column is added WITHOUT a default (existing films keep their history)",
  /add column if not exists activity_at timestamptz;/.test(sql) && !/add column if not exists activity_at timestamptz[^;]*default/.test(sql),
  true,
);
check("new films start active at birth", /alter column activity_at set default now\(\)/.test(sql), true);
check("no backfill UPDATE (it would overwrite the history NULL reads)", /^\s*update\s+project\b/im.test(sql), false);

check("the activity reads the film's scenes, chapters and scripts", ["hov.scene", "hov.chapter", "hov.script"].every((tbl) => PROJECT_ACTIVITY_SQL.includes(tbl)), true);
check("…and the row's own stamp, falling back to its last write", /coalesce\(p\.activity_at, p\.updated_at, p\.created_at\)/.test(PROJECT_ACTIVITY_SQL), true);
check("getProjects selects it", /\$\{PROJECT_ACTIVITY_SQL\} as activity_at/.test(pg), true);

/** The source of one exported function, up to the next top-level export. */
const fnBody = (src, fn) => {
  const at = src.indexOf(`export async function ${fn}(`);
  if (at === -1) return "";
  const next = src.indexOf("\nexport ", at + 10);
  return src.slice(at, next === -1 ? undefined : next);
};
check(
  "pause, resume and restart-writing stamp the film (they write nothing else)",
  ["pauseProduction", "resumeProject", "restartScripting"].filter((f) => !/touchProjectActivity\(projectId\)/.test(fnBody(actions, f))),
  [],
);
check("restart = pause + resume, so it inherits both stamps", /pauseProduction\(projectId\)[\s\S]*resumeProject\(projectId\)/.test(fnBody(actions, "restartProduction")), true);
// Every stamp, however many there are (the engine's Pause and Resume added two
// on 2026-09-26): a stamp without its catch would fail the action it decorates.
{
  const stamps = (actions.match(/touchProjectActivity\(projectId\)/g) ?? []).length;
  const caught = (actions.match(/touchProjectActivity\(projectId\)\.catch\(\(\) => \{\}\)/g) ?? []).length;
  check("a failed stamp never fails the action", [stamps >= 3, caught], [true, stamps]);
}

check("the grid orders the WHOLE library before scoping (tabs and playlists follow)", /const scoped = inActive \? ordered\.filter/.test(grid), true);
check("…and holds still while pointing or selecting", /const holding = pointing \|\| manage;/.test(grid), true);
check("both views report the pointer", (grid.match(/onPointerEnter=\{\(\) => setPointing\(true\)\}/g) ?? []).length, 2);
check("the card shows the time the order uses", /order === "activity"\s*\?\s*agoOf\(p\.activityAt\)/.test(grid), true);
check("the projects page reads the per-device choice", /parseLibraryOrder\(\(await cookies\(\)\)\.get\(LIBRARY_ORDER_COOKIE\)/.test(page), true);
check("Settings → Customize offers the switch", /<LibraryOrderPicker initial=\{libraryOrder\} \/>/.test(customize), true);

// Keep this LAST (see check-watermark.mjs).
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
