// Calls a handful of the real API route handlers directly — as plain
// functions, not through a running server — to prove the Zod wiring in
// lib/apiSchemas.ts actually reaches production code, not just the schema
// objects in isolation (that's check-validation.mjs's job). A route handler
// exported from route.ts is just an async function; this is what lets it be
// called with a constructed Request/NextRequest and no dev server.
//
// Needs the `next/server` fallback in alias-loader.mjs (a bare `next/<sub>`
// specifier retried as `next/<sub>.js` on failure) — that is the one thing
// standing between "schema-only tests" and "through the real handler".
//
// Deliberately NOT all 16 routes: most already have thorough schema
// coverage in check-validation.mjs, and several need a configured Postgres/
// ElevenLabs backend to get PAST their own auth/service-availability guards
// before ever reaching the Zod boundary (this environment has neither
// configured, which is itself proof those guards still run in their
// original order — see the archive/use case below). This picks routes
// where the 400 is reachable with nothing configured.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/alias-loader.mjs scripts/check-routes.mjs
const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
};

// --- media — id too short -> 400 through the real GET handler --------------
{
  const { GET } = await import("../app/api/media/route.ts");
  const res = await GET(new Request("http://x/api/media?id=short"));
  check("media GET ?id=short -> 400", res.status, 400);
  const body = await res.json();
  check("media GET ?id=short -> error message", body.error, "invalid id");
}

// --- yt-kit — bad project id -> 400 through the real GET handler -----------
{
  const { GET } = await import("../app/api/yt-kit/route.ts");
  const res = await GET(new Request("http://x/api/yt-kit?project=bad"));
  check("yt-kit GET ?project=bad -> 400", res.status, 400);
}

// --- archive/use — the auth/service guard still runs BEFORE the Zod check,
// unchanged, in this environment with no Postgres configured: both a bad
// sceneId and a non-JSON body should answer 503 (backend unavailable), not
// reach validation at all. This is the negative proof that wiring Zod in did
// not reorder or bypass the route's own guards.
{
  const { POST } = await import("../app/api/archive/use/route.ts");
  const bad = new Request("http://x/api/archive/use", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hov-key": "whatever" },
    body: JSON.stringify({ sceneId: "not-a-real-id", stockId: "recABCDEFGHIJKLMN" }),
  });
  const res = await POST(bad);
  check("archive/use POST with bad sceneId, no Postgres configured -> 503 (guard order unchanged)", res.status, 503);
}

// --- media/ingest — bad field enum -> 400, but the key check comes first,
// same guard-ordering point as archive/use above.
{
  const { POST } = await import("../app/api/media/ingest/route.ts");
  const res = await POST(
    new Request("http://x/api/media/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" }, // no x-hov-key
      body: JSON.stringify({ sceneId: "recABCDEFGHIJKLMN", field: "audio", url: "https://x/y" }),
    }),
  );
  check("media/ingest POST with no key configured -> 500 (MEDIA_INGEST_KEY not set)", res.status, 500);
}

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
