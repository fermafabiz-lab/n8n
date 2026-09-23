// A real Postgres engine for the SITE, from inside a Claude Code web session.
//
// A web session cannot reach the `hov` database (CLAUDE.md: it reaches GitHub
// and nothing else), and the site's demo mode has no database at all — so a
// site feature that WRITES Postgres used to be verifiable only by reading its
// SQL, or by shipping it. This closes that gap: PGlite is Postgres compiled
// to WebAssembly (installable from npm, which the session CAN reach), and
// pglite-socket serves it over the ordinary wire protocol, so the site's
// unmodified `pg` Pool talks to it exactly as it talks to the box.
//
// It applies every db/NNN_*.sql in file order — the repo's own migrations,
// not a copy — seeds a small library, and listens. First used for the
// playlists (db/port/playlists/README.md), where it caught nothing in the SQL
// and three things in the page that no amount of reading would have.
//
//   mkdir -p /tmp/pg && cd /tmp/pg && npm init -y >/dev/null \
//     && npm i @electric-sql/pglite @electric-sql/pglite-socket
//   LOCAL_PG_DEPS=/tmp/pg node db/port/lib/local-pg.mjs      # (from the repo root)
//
// (The two packages stay OUT of the repo on purpose — a WASM Postgres is a
// tool for verifying, not a dependency of the site. So they are loaded from
// wherever they were installed, by path.)
//
//   cd platform && DATA_BACKEND=postgres \
//     DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npx next dev -p 3211
//
// Then psql (installed) reads what the page wrote:
//   PGPASSWORD=postgres psql -h 127.0.0.1 -p 55432 -U postgres -d postgres
//
// In-memory: stop it and everything is gone. Nothing here can reach the box.
//
// Two traps, both hit while building this: `pkill -f "node local-pg.mjs"`
// from a Bash tool call kills the tool's own shell (its command line contains
// the pattern) — kill by pid instead. And `next build` shares `.next/` with a
// running `next dev`: stop the dev server first.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEPS = process.env.LOCAL_PG_DEPS || "/tmp/pg";
/** A package's ESM entry, by path — its export map's `import`, not `require`. */
const esm = async (pkg) => {
  const dir = join(DEPS, "node_modules", pkg);
  const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const entry = meta.exports?.["."]?.import?.default ?? meta.module ?? meta.main;
  return import(pathToFileURL(join(dir, entry)).href);
};
const { PGlite } = await esm("@electric-sql/pglite");
const { PGLiteSocketServer } = await esm("@electric-sql/pglite-socket");

const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.LOCAL_PG_PORT || 55432);

const db = await PGlite.create();
for (const f of readdirSync(DB_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) {
  try {
    await db.exec(readFileSync(join(DB_DIR, f), "utf8"));
    console.log(`applied ${f}`);
  } catch (e) {
    console.log(`FAILED ${f}: ${e.message}`);
    process.exit(1);
  }
}

// A library with every status bucket in it, three categories, two with
// diacritics, and more than one page (the grid shows 15), so paging and
// selection across pages are exercised.
const FILMS = [
  ["How Google Maps was built", "Finalizat", "documentary", "Dan"],
  ["The ZipDash deal nobody remembers", "Finalizat", "documentary", "Ana"],
  ["Where 2 Technologies — the two brothers", "Asteapta Aprobare Script", "documentary", "Dan"],
  ["Keyhole and the CIA's money", "Generare Video", "documentary", "Ana"],
  ["Street View's first car", "Finalizat", "documentary", "Dan"],
  ["Pip the Fox and the lost acorn", "Finalizat", "kids", "Mara"],
  ["Pip the Fox learns to swim", "Asteapta Aprobare Imagine", "kids", "Mara"],
  ["Pip the Fox and the winter moon", "Generare Imagine", "kids", "Mara"],
  ["The last lighthouse keepers", "Finalizat", "story", "Ana"],
  ["Cities that never woke up", "Eroare", "story", "Dan"],
  ["How Rome fed a million people", "Finalizat", "documentary", "Ionuț"],
  ["The Burj Al Arab, one island at a time", "Finalizat", "documentary", "Ionuț"],
  ["Peking to Paris, 1907", "Asteapta Aprobare Video", "story", "Ana"],
  ["Tupac's last interview", "Setari Finale", "documentary", "Dan"],
  ["Night drive through Tokyo", "Finalizat", "cinematic", "Ionuț"],
  ["Rain on a Bucharest tram", "Generare Voce", "cinematic", "Mara"],
  ["Castelul Peleș, camera cu camera", "Finalizat", "documentary", "Ionuț"],
  ["The snail and the turtle", "Asamblare", "kids", "Mara"],
  ["A storm over the Carpathians", "Planificat", "cinematic", "Dan"],
  ["Why the Titanic's lookouts had no binoculars", "Finalizat", "documentary", "Ana"],
  ["Death coming to take someone into the underworld", "Finalizat", "story", "Dan"],
  ["The engine that would not stop", "Asteapta Aprobare Voce", "story", "Ionuț"],
];
const now = Date.now();
for (let i = 0; i < FILMS.length; i++) {
  const [name, status, category, createdBy] = FILMS[i];
  await db.query(
    `insert into hov.project (name, status, tone, length_seconds, editing_options, created_at, updated_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, $6)`,
    [
      name,
      status,
      category === "kids" ? "Childish" : category === "documentary" ? "Documentary" : "Epic",
      60 + (i % 5) * 60,
      JSON.stringify({ category, createdBy }),
      new Date(now - (FILMS.length - i) * 3_600_000).toISOString(),
    ],
  );
}
console.log(`seeded ${FILMS.length} projects`);

// maxConnections: PGlite is single-connection; the socket server multiplexes
// so the site's Pool (max 8) and psql can all be connected at once.
const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 10 });
await server.start();
console.log(`listening on 127.0.0.1:${PORT}`);
process.on("SIGTERM", async () => {
  await server.stop();
  await db.close();
  process.exit(0);
});
