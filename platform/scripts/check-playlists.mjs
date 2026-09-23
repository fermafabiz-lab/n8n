// Playlists — the rules, and the four joints where the feature was measured
// to break before it shipped.
//
// The rules live in lib/playlists.ts and are pinned against fixtures here.
// The joints are pinned by reading the real sources, because each one is a
// single line whose removal leaves every screen looking fine:
//
//   1. the name limit exists twice — the TS rule and the table's CHECK — and
//      they have to agree, or the page accepts a name the database refuses;
//   2. every playlist action ends in revalidatePath("/projects"). The first
//      version refreshed from the browser instead, and a refresh fired by one
//      write landed after the next write's: a playlist given three films
//      showed 0 (measured in Chromium, 2026-09-23);
//   3. the select bar wraps. Inside a playlist it holds five controls, and on
//      a 390px phone they ran to x=464 with Cancel off the screen;
//   4. nothing in the playlist code can delete a FILM. The playlist buttons
//      sit one button away from deleteProjects, which does.
//
//   node --experimental-strip-types --no-warnings scripts/check-playlists.mjs

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

const L = await import(join(root, "lib", "playlists.ts"));
const { PLAYLIST_NAME_MAX, normalizePlaylistName, isRecordId, cleanProjectIds, sortPlaylists, films } = L;
const name = (v) => {
  const r = normalizePlaylistName(v);
  return r.ok ? r.name : `REFUSED: ${r.message}`;
};

// ------------------------------------------------------------ the name rule

check("a plain name passes as typed", name("Google Maps"), "Google Maps");
check("ends are trimmed", name("   Google Maps  "), "Google Maps");
check("runs of spaces collapse", name("Google    Maps"), "Google Maps");
check("tabs and newlines become one space, never glue", name("Google\n\tMaps"), "Google Maps");
check("a non-breaking space is a space", name("Google Maps"), "Google Maps");
check("a control character is dropped without leaving two spaces", name("Google \u0007 Maps"), "Google Maps");
check("a NUL (which Postgres refuses outright) is dropped", name("Pip\u0000 the Fox"), "Pip the Fox");
check("a zero-width space is dropped", name("Pip​ the Fox"), "Pip the Fox");
check("…so a name made only of them is empty, and refused", name("​​"), "REFUSED: Give the playlist a name.");
check("the zero-width JOINER survives — it holds a family emoji together", name("Family 👨‍👩‍👧"), "Family 👨‍👩‍👧");
check("an ș typed as s + combining comma is the same name as the single ș", name("Pleșul"), name("Pleșul"));
check("an empty name is refused", name("   "), "REFUSED: Give the playlist a name.");
check("null and undefined are refused, not stringified", [name(null), name(undefined)], ["REFUSED: Give the playlist a name.", "REFUSED: Give the playlist a name."]);
check("60 characters pass", name("x".repeat(60)).length, 60);
check(
  "61 are refused with the count, never clamped",
  name("x".repeat(61)),
  `REFUSED: A playlist name can be at most ${PLAYLIST_NAME_MAX} characters — this one is 61.`,
);
check("an emoji counts once, like Postgres counts it", name("x".repeat(59) + "🎬"), "x".repeat(59) + "🎬");

// ------------------------------------------------ two copies of one limit

const sql = readFileSync(join(root, "..", "db", "013_playlists.sql"), "utf8");
const dbLimit = sql.match(/length\(name\)\s+between\s+1\s+and\s+(\d+)/);
check("the table's CHECK carries a length limit", Boolean(dbLimit), true);
check("…and it is the same number the page enforces", Number(dbLimit?.[1]), PLAYLIST_NAME_MAX);
check("the table refuses an untrimmed name too", /name\s*=\s*btrim\(name\)/.test(sql), true);
check("names are unique ignoring case, as the page checks", /unique index[^;]*on playlist \(lower\(name\)\)/.test(sql), true);
check("deleting a project takes its memberships", /project_id\s+text not null references project\(id\) on delete cascade/.test(sql), true);
check("deleting a playlist takes its memberships", /playlist_id\s+text not null references playlist\(id\) on delete cascade/.test(sql), true);

// ------------------------------------------------------------- ids from outside

check("a record id is recognised", isRecordId("recAbC123xyz09876"), true);
check("anything else is not", ["rec123", "recAbC123xyz0987!", "", null, 42, "RECAbC123xyz09876"].map(isRecordId), [false, false, false, false, false, false]);
check(
  "a batch keeps valid ids once each, in order",
  cleanProjectIds(["recAAAAAAAAAAAAAA", "junk", "recBBBBBBBBBBBBBB", "recAAAAAAAAAAAAAA", 7]),
  ["recAAAAAAAAAAAAAA", "recBBBBBBBBBBBBBB"],
);
check("a batch that is not a list is empty", cleanProjectIds("recAAAAAAAAAAAAAA"), []);
check("and it is capped", cleanProjectIds(Array.from({ length: 5 }, (_, i) => `rec${String(i).padStart(14, "0")}`), 3).length, 3);

// ----------------------------------------------------------------- the order

check(
  "chips sort by name ignoring case and accents, numbers as numbers",
  sortPlaylists([
    { id: "3", name: "episode 10" },
    { id: "1", name: "Zeta" },
    { id: "2", name: "Ăla" },
    { id: "4", name: "Episode 9" },
    { id: "5", name: "alpha" },
  ]).map((p) => p.name),
  ["Ăla", "alpha", "Episode 9", "episode 10", "Zeta"],
);
check("the count word agrees with its number", [films(0), films(1), films(2)], ["0 films", "1 film", "2 films"]);

// ------------------------------------------------------- the four joints

const actions = readFileSync(join(root, "app", "actions.ts"), "utf8");
const grid = readFileSync(join(root, "components", "ProjectsGrid.tsx"), "utf8");
const menu = readFileSync(join(root, "components", "AddToPlaylist.tsx"), "utf8");
const pg = readFileSync(join(root, "lib", "data", "postgres.ts"), "utf8");

/** The source of one exported function, up to the next top-level export. */
const fnBody = (src, fn) => {
  const at = src.indexOf(`export async function ${fn}(`);
  if (at === -1) return "";
  const next = src.indexOf("\nexport ", at + 10);
  return src.slice(at, next === -1 ? undefined : next);
};
const ACTIONS = ["createPlaylist", "addToPlaylist", "removeFromPlaylist", "renamePlaylist", "deletePlaylist"];
check("all five playlist actions exist", ACTIONS.filter((a) => !fnBody(actions, a)), []);
check(
  "every one re-renders the library in its own response (the race fix)",
  ACTIONS.filter((a) => !fnBody(actions, a).includes('revalidatePath("/projects")')),
  [],
);
check("the grid does not refresh from the browser after a write", /router\.refresh\(\)/.test(grid), false);

check("the grid reads ?playlist=, so a playlist can be linked to", /searchParams\.get\("playlist"\)/.test(grid), true);
check("the select bar wraps (the 390px fix)", /className="ptools" style=\{\{ flexWrap: "wrap"/.test(grid), true);
check("the menu measures where it opens rather than hanging off the button", /useLayoutEffect/.test(menu) && /getBoundingClientRect/.test(menu), true);

const pgPlaylists = pg.slice(pg.indexOf("// Playlists (db/013)"));
check("the Postgres playlist section exists", pgPlaylists.length > 1000, true);
check("…and nothing in it can delete a film", /delete\s+from\s+hov\.project\b/i.test(pgPlaylists), false);
check(
  "…and no playlist action calls the film delete",
  ACTIONS.filter((a) => /deleteProjectDeep|deleteProjects/.test(fnBody(actions, a))),
  [],
);

// Keep this LAST: a `process.exit` above it would skip every case below and
// still print a cheerful summary (check-watermark.mjs, once).
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
