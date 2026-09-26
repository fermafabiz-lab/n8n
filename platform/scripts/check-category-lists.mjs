// The category playlists (lib/category-lists.ts) — the grouping pinned against
// fixtures, and the joints that keep a category list from ever being written
// to as if it were one of the producer's own playlists.
//
// Also the restart door (app/api/ops/restart): same file because the two
// shipped together, and because the one thing worth pinning about the door is
// the same kind of thing — that it stays shut to anything without the key.
// The handler's own answers (500/401/400/409) are exercised through the real
// handler in check-routes.mjs.
//
//   node --experimental-strip-types --no-warnings scripts/check-category-lists.mjs

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

const { CATEGORIES } = await import(join(root, "lib", "categories.ts"));
const { categoryLists, categoryListId, isCategoryListId, resolveCategoryList, CATEGORY_LIST_PREFIX } = await import(
  join(root, "lib", "category-lists.ts")
);
const { isRecordId } = await import(join(root, "lib", "playlists.ts"));

const LIB = [
  { id: "recA", category: "documentary" },
  { id: "recB", category: "story" },
  { id: "recC", category: null }, // made before categories existed
  { id: "recD", category: "kids" },
  { id: "recE", category: "documentary" },
  { id: "recF", category: "no-such-category" }, // a category this site no longer knows
];
const shape = (lists) => lists.map((l) => [l.name, l.projectIds]);

// ------------------------------------------------------------ the grouping

check(
  "one list per category that has a film, in the brief's order",
  shape(categoryLists(LIB, CATEGORIES)),
  [
    ["Story", ["recB", "recC", "recF"]],
    ["Documentary", ["recA", "recE"]],
    ["Kids story", ["recD"]],
  ],
);
check("a category with no films has no chip (Cinematic here)", categoryLists(LIB, CATEGORIES).some((l) => l.categoryId === "cinematic"), false);
check("…and gets one with its first film", categoryLists([...LIB, { id: "recG", category: "cinematic" }], CATEGORIES).find((l) => l.categoryId === "cinematic")?.projectIds, ["recG"]);
check(
  "every film is in exactly one category list",
  categoryLists(LIB, CATEGORIES).flatMap((l) => l.projectIds).sort(),
  LIB.map((f) => f.id).sort(),
);
check("no films, no chips", categoryLists([], CATEGORIES), []);
check("the list carries the category's icon and label", (({ id, name, icon }) => ({ id, name, icon }))(categoryLists(LIB, CATEGORIES)[1]), { id: "category:documentary", name: "Documentary", icon: "🎥" });
check("the first category is Story (where an unfiled film goes)", CATEGORIES[0].id, "story");

// ------------------------------------------------------- the ids and links

check("a category list id is recognised", isCategoryListId(categoryListId("kids")), true);
check("a playlist's record id is not", isCategoryListId("recABCDEFGHIJKLMN"), false);
check("nothing else is either", [null, undefined, 7, "", "story"].map(isCategoryListId), [false, false, false, false, false]);
check(
  "no category list id can ever pass for a record id (no collision with a real playlist)",
  CATEGORIES.map((c) => isRecordId(categoryListId(c.id))),
  CATEGORIES.map(() => false),
);
check("the prefix is what the address carries", CATEGORY_LIST_PREFIX, "category:");
check("an old link to an EMPTY category still resolves (and says so)", resolveCategoryList("category:cinematic", LIB, CATEGORIES)?.projectIds, []);
check("a link to a category this site does not know is stale", resolveCategoryList("category:musicvideo", LIB, CATEGORIES), null);
check("a playlist id is not resolved as a category", resolveCategoryList("recABCDEFGHIJKLMN", LIB, CATEGORIES), null);

// -------------------------------------------------------------- the joints

const grid = readFileSync(join(root, "components", "ProjectsGrid.tsx"), "utf8");
const bar = readFileSync(join(root, "components", "PlaylistBar.tsx"), "utf8");
const route = readFileSync(join(root, "app", "api", "ops", "restart", "route.ts"), "utf8");
const mw = readFileSync(join(root, "middleware.ts"), "utf8");

check("the grid derives the lists from the whole library, every render", /const catLists = categoryLists\(projects, CATEGORIES\);/.test(grid), true);
check("…and hands them to the playlist row", /categories=\{catLists\}/.test(grid), true);
check("a category opens like any playlist (it IS `active`)", /const active: Playlist \| null = isCategoryListId\(listId\)\s*\?\s*activeCategory/.test(grid), true);
check("Remove is never offered inside a category", /\{active && !activeCategory && \(/.test(grid), true);
check("…and could not act there if it were", /if \(!active \|\| activeCategory\) return;/.test(grid), true);
check("an empty category offers no 'Add films to it'", /activeCategory && scoped\.length === 0 \?/.test(grid), true);
check("Add to playlist still lists only the producer's playlists", /<AddToPlaylist\s+playlists=\{pls\}/.test(grid), true);
check("Rename and Delete belong to the producer's own playlists only", [/const own = active !== null && !isCategoryListId\(active\.id\) \? active : null;/.test(bar), /\{own && !renaming && \(/.test(bar)], [true, true]);
check("the row offers All films once there is any chip to leave", /\(playlists\.length > 0 \|\| categories\.length > 0\) && \(/.test(bar), true);

check("the restart door checks the key before anything else", route.indexOf('req.headers.get("x-hov-key") !== key') < route.indexOf("await req.json()"), true);
check("…refuses with no key configured rather than skipping the check", /if \(!key\) return reply\(500/.test(route), true);
check("…takes only record ids, at most ten", /if \(ids\.length === 0 \|\| ids\.length > 10 \|\| !ids\.every\(isRecordId\)\)/.test(route), true);
// One film: exactly the button's restartProduction. Several (2026-09-26):
// restartProductions, which pauses once — two single calls would kill each other.
check(
  "…and runs exactly the button's restartProduction for one film, restartProductions for several",
  /const \{ restartProduction, restartProductions \} = await import\("@\/app\/actions"\);/.test(route) &&
    /if \(ids\.length === 1\) \{\s*const r = await restartProduction\(ids\[0\]\);/.test(route),
  true,
);
// The middleware exemption must sit in the KEY-gated group, never beside the
// unconditional ones above it (/api/media/ingest, /api/at/).
const door = mw.slice(mw.indexOf("if (\n    (req.nextUrl.pathname.startsWith(\"/api/archive/\")"), mw.indexOf("req.cookies.get(\"vf_auth\")"));
check("the middleware lets it past the password gate ONLY with the key", door.includes('"/api/ops/restart"') && door.includes('req.headers.get("x-hov-key") === process.env.MEDIA_INGEST_KEY'), true);
check("…and nowhere unconditionally", mw.split("\n").filter((l) => l.includes("/api/ops/restart") && l.includes("return NextResponse.next()")).length, 0);
// The OpenAI ledger's door (2026-09-26) sits in the same key-gated group.
check("the ledger door is key-gated the same way", door.includes('"/api/insights/openai"'), true);

// Keep this LAST (see check-watermark.mjs).
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
