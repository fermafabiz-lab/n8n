// db/014 on a real Postgres engine: does a film's activity move for exactly
// the things the producer said count, and for nothing else?
//
// Runs PGlite (Postgres in WebAssembly — see db/port/lib/local-pg.mjs) in
// process with the repo's own migrations 001..014, then drives each case and
// reads the answer back through PROJECT_ACTIVITY_SQL — the very expression the
// site sorts by, imported, not copied.
//
//   LOCAL_PG_DEPS=/tmp/pg node --experimental-strip-types --no-warnings \
//     db/port/activity-order/check-trigger.mjs
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const DEPS = process.env.LOCAL_PG_DEPS || "/tmp/pg";
const esm = async (pkg) => {
  const dir = join(DEPS, "node_modules", pkg);
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  return import(pathToFileURL(join(dir, meta.exports?.["."]?.import?.default ?? meta.main)).href);
};
const { PGlite } = await esm("@electric-sql/pglite");
const { PROJECT_ACTIVITY_SQL } = await import(join(repo, "platform", "lib", "data", "activity-sql.ts"));

const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};

const db = await PGlite.create();
for (const f of readdirSync(join(repo, "db")).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) {
  await db.exec(readFileSync(join(repo, "db", f), "utf8"));
}
// Every statement below is its own transaction, so now() moves between them;
// the pause makes sure it moves by more than the clock's grain.
const tick = () => new Promise((r) => setTimeout(r, 20));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const ms = (v) => (v ? new Date(v).getTime() : null);
const activity = async (id) => ms((await one(`select ${PROJECT_ACTIVITY_SQL} as a from hov.project p where p.id = $1`, [id])).a);
const row = async (id) => {
  const r = await one(`select activity_at, updated_at from hov.project where id = $1`, [id]);
  return { activity: ms(r.activity_at), updated: ms(r.updated_at) };
};
const now = async () => ms((await one(`select now() as n`)).n);

// A film from BEFORE 014: activity_at NULL, a history five days old.
const OLD = "recOLDOLDOLDOLDOL";
await db.query(
  `insert into hov.project (id, name, status, created_at, updated_at, activity_at)
   values ($1, 'Before 014', 'Finalizat', now() - interval '10 days', now() - interval '5 days', null)`,
  [OLD],
);
const fiveDaysAgo = (await row(OLD)).updated;

// A film from AFTER 014, last worked on two days ago, with one scene.
const NEW = "recNEWNEWNEWNEWNE";
await db.query(
  `insert into hov.project (id, name, status, created_at, activity_at)
   values ($1, 'After 014', 'În Lucru', now() - interval '3 days', now() - interval '2 days')`,
  [NEW],
);
await db.query(
  `insert into hov.scene (id, project_id, scene_order, created_at, updated_at)
   values ('recSCENESCENESCEN', $1, 1, now() - interval '3 days', now() - interval '3 days')`,
  [NEW],
);
const twoDaysAgo = (await row(NEW)).activity;

// ------------------------------------------------------------- history
check("a film from before 014 reads its last write as its activity", await activity(OLD), fiveDaysAgo);
check("a film from after 014 reads its own activity_at", await activity(NEW), twoDaysAgo);

// ---------------------------------------------------- publishing: never
await tick();
await db.query(`update hov.project set editing_options = editing_options || '{"publishing":{"state":"posted"}}' where id = $1`, [OLD]);
check("marking an OLD film Posted does not float it", await activity(OLD), fiveDaysAgo);
check("…because the trigger pinned its history before the write", (await row(OLD)).activity, fiveDaysAgo);
check("…while updated_at did move (so it could not be used alone)", (await row(OLD)).updated > fiveDaysAgo, true);
await tick();
await db.query(`update hov.project set editing_options = editing_options || '{"publishing":{"state":"ready"}}' where id = $1`, [NEW]);
check("marking a film Ready to post does not float it either", await activity(NEW), twoDaysAgo);

// ------------------------------------------- the pipeline and people: yes
await tick();
let before = await now();
await db.query(`update hov.project set status = 'Asteapta Aprobare Imagine' where id = $1`, [OLD]);
check("a status change (the pipeline advancing) floats the film", (await activity(OLD)) >= before, true);
await tick();
const settled = await activity(OLD);
await db.query(`update hov.project set status = 'Asteapta Aprobare Imagine' where id = $1`, [OLD]);
check("re-sending the SAME status is not activity", await activity(OLD), settled);
await tick();
before = await now();
await db.query(`update hov.project set editing_options = editing_options || '{"autoApprove":true}' where id = $1`, [NEW]);
check("any other Editing Options change counts (hands-off switched on)", (await activity(NEW)) >= before, true);
await tick();
before = await now();
await db.query(`update hov.scene set scene_approved = true where id = 'recSCENESCENESCEN'`);
check("approving a scene floats its film", (await activity(NEW)) >= before, true);
const projectRowAfterScene = (await row(NEW)).activity;
check("…without writing the project row (no cross-table lock)", projectRowAfterScene < before, true);
await tick();
before = await now();
await db.query(
  `insert into hov.chapter (project_id, ordinal, title) values ($1, 1, 'One')`,
  [OLD],
).catch(async () => db.query(`insert into hov.chapter (project_id, ordinal) values ($1, 1)`, [OLD]));
check("a new chapter (scripting) floats its film", (await activity(OLD)) >= before, true);
await tick();
before = await now();
await db.query(`insert into hov.script (project_id) values ($1)`, [NEW]);
check("a new script floats its film", (await activity(NEW)) >= before, true);

// ------------------------------------------- pause / resume / restart: yes
await tick();
before = await now();
await db.query(`update hov.project set activity_at = now() where id = $1`, [OLD]);
check("an explicit stamp (pause/resume/restart) is honoured", (await row(OLD)).activity >= before, true);

// -------------------------------------------------------- playlists: never
await tick();
const beforePlaylist = await activity(NEW);
await db.query(`insert into hov.playlist (id, name) values ('recPLAYLISTPLAYLI', 'Rome')`);
await db.query(`insert into hov.playlist_project (playlist_id, project_id) values ('recPLAYLISTPLAYLI', $1)`, [NEW]);
await db.query(`update hov.playlist set name = 'Rome, again' where id = 'recPLAYLISTPLAYLI'`);
await db.query(`delete from hov.playlist where id = 'recPLAYLISTPLAYLI'`);
check("adding to, renaming and deleting a playlist never floats a film", await activity(NEW), beforePlaylist);

// -------------------------------------------------------- a new film: yes
before = await now();
await db.query(`insert into hov.project (id, name) values ('recBORNBORNBORNBO', 'Born now')`);
check("a film is active from the moment it is created", (await row("recBORNBORNBORNBO")).activity >= before, true);

// ------------------------------------------- the order the library shows
const order = (await db.query(`select p.name from hov.project p order by ${PROJECT_ACTIVITY_SQL} desc`)).rows.map((r) => r.name);
// The last thing that happened to "Before 014" was the pause stamp, AFTER
// "After 014" got its new script — so it is the more recently worked on of
// the two, whatever their ages. (The first draft of this check expected the
// reverse, reasoning from the films' names instead of their last events.)
check("the library order is by last activity, not by age", order, ["Born now", "Before 014", "After 014"]);

// Keep LAST (see check-watermark.mjs).
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
