// Asserts the 3D house's routing table against the app it is supposed to
// navigate — in BOTH directions, which is the whole point.
//
// A clickable object in the scene is a named mesh from the GLB bound to a
// route (see lib/house.ts). Nothing type-checks across that seam: a GLB is
// data, and a route is a directory on disk. So the two ways it rots are
//
//   1. a mesh points at a route that no longer exists — a door into a wall;
//   2. a route exists that no mesh reaches — a room with no door.
//
// (2) is the one that actually happens, and it has already happened once
// without any 3D involved: `/series` has no link in the desktop nav at all
// today, only in the phone menu. A check that only looked at meshes would
// have been perfectly happy about that.
//
// Routes are read off the filesystem rather than listed here, so adding a
// page is enough to fail this until the house acknowledges it. The pipeline's
// stages are read out of `app/projects/[id]/page.tsx` textually, for the same
// reason the sheet-style check parses its table instead of importing it —
// that page is a server component and importing it would drag Postgres in.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/alias-loader.mjs scripts/check-house.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { BENCH, HOTSPOTS, MESH_NAME, MESH_PREFIXES, NOT_A_DOOR } from "@/lib/house.ts";

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, "..", "app");

const results = [];
const check = (name, ok, detail) => {
  results.push(!!ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` -> ${detail}` : ""}`);
};

// --- the app's real routes, off the filesystem ----------------------------
// Every page.tsx is a route; its path is the directory relative to app/.
// Route groups — (name) — contribute nothing to the URL, so they are dropped
// the way Next drops them. There are none today; this is here so that adding
// one does not silently invent a route called "/(marketing)".
const routes = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "api") continue; // handlers, not pages — check:routes owns those
      walk(full);
    } else if (entry === "page.tsx") {
      const rel = relative(APP, dir).split("/").filter((s) => !/^\(.*\)$/.test(s));
      routes.push("/" + rel.join("/"));
    }
  }
})(APP);
routes.sort();
// Deliberately not "at least 13": a hardcoded count is a second copy of the
// route list that rots the first time a page is legitimately removed. The
// coverage assertions below are what actually hold this together; this only
// catches a walker that found nothing at all.
check("found the app's routes", routes.length > 0, `${routes.length} routes`);

// --- mesh names --------------------------------------------------------
const meshes = [...HOTSPOTS.map((h) => h.mesh), ...BENCH.map((b) => b.mesh)];
const badName = meshes.filter((m) => !MESH_NAME.test(m));
check(
  "every mesh name follows the convention",
  badName.length === 0,
  badName.length ? badName.join(", ") : `${meshes.length} names, prefixes: ${MESH_PREFIXES.join("|")}`,
);

const dupes = meshes.filter((m, i) => meshes.indexOf(m) !== i);
check("mesh names are unique", dupes.length === 0, dupes.length ? [...new Set(dupes)].join(", ") : "no duplicates");

// --- a hotspot is a door or a behaviour, never both and never neither -----
const confused = HOTSPOTS.filter((h) => !!h.route === !!h.action);
check(
  "every hotspot has exactly one of route/action",
  confused.length === 0,
  confused.length ? confused.map((h) => h.mesh).join(", ") : `${HOTSPOTS.length} hotspots`,
);

// --- direction 1: no mesh points at a route that does not exist -----------
const resolves = (route) => routes.includes(route);
const live = HOTSPOTS.filter((h) => h.route && !h.planned);
const intoAWall = live.filter((h) => !resolves(h.route));
check(
  "every live door opens onto a real route",
  intoAWall.length === 0,
  intoAWall.length ? intoAWall.map((h) => `${h.mesh} -> ${h.route}`).join(", ") : `${live.length} doors`,
);

// A planned door must NOT resolve. When someone builds the route, this is
// what says so, instead of leaving a door marked "not built yet" standing in
// front of a room that has quietly existed for months.
const planned = HOTSPOTS.filter((h) => h.planned);
const arrived = planned.filter((h) => resolves(h.route));
check(
  "planned doors are still unbuilt",
  arrived.length === 0,
  arrived.length
    ? `${arrived.map((h) => `${h.route} exists now — drop 'planned' on ${h.mesh}`).join(", ")}`
    : `${planned.length} planned: ${planned.map((h) => h.route).join(", ") || "none"}`,
);

// --- direction 2: no route is unreachable from the house ------------------
const reached = new Set(live.map((h) => h.route));
const excused = new Map(NOT_A_DOOR.map((e) => [e.route, e.why]));
const orphans = routes.filter((r) => !reached.has(r) && !excused.has(r));
check(
  "every route is reachable, or excused with a reason",
  orphans.length === 0,
  orphans.length ? orphans.join(", ") : `${reached.size} reached, ${excused.size} excused`,
);

// An excuse for a route that no longer exists is stale documentation, and
// stale documentation about why something is missing is worse than none.
const staleExcuse = [...excused.keys()].filter((r) => !routes.includes(r));
check(
  "no excuse names a route that is gone",
  staleExcuse.length === 0,
  staleExcuse.length ? staleExcuse.join(", ") : `${excused.size} excuses, all live`,
);

// A route that is both reached and excused is contradictory bookkeeping, and
// it is how the excuse list rots: the excuse goes on claiming the room has no
// door long after someone put one in. Found by a control run — `/admin/customize`
// was excused as "not a door off the hall" while `lamp_theme` routed to it, and
// the orphan check above was quite happy either way.
const bothWays = routes.filter((r) => reached.has(r) && excused.has(r));
check(
  "no route is both reached and excused",
  bothWays.length === 0,
  bothWays.length ? bothWays.join(", ") : "no contradictions",
);

const emptyWhy = NOT_A_DOOR.filter((e) => !e.why || e.why.trim().length < 20);
check(
  "every excuse gives an actual reason",
  emptyWhy.length === 0,
  emptyWhy.length ? emptyWhy.map((e) => e.route).join(", ") : "all reasons written out",
);

// --- the bench matches the pipeline --------------------------------------
// STAGE_KEYS is a module-level const in a server component, so it is read as
// text. Add a stage to the pipeline and the bench must grow a station for it.
const pageSrc = readFileSync(join(APP, "projects", "[id]", "page.tsx"), "utf8");
const block = pageSrc.match(/const STAGE_KEYS = \[([\s\S]*?)\] as const;/);
check("found STAGE_KEYS in the project page", !!block, block ? "parsed" : "regex did not match");

if (block) {
  const stages = [...block[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  const benchStages = BENCH.map((b) => b.stage);
  check(
    "the bench has a station per stage, in order",
    JSON.stringify(stages) === JSON.stringify(benchStages),
    JSON.stringify(stages) === JSON.stringify(benchStages)
      ? `${stages.length} stages: ${stages.join(" -> ")}`
      : `pipeline ${JSON.stringify(stages)} vs bench ${JSON.stringify(benchStages)}`,
  );
}

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
