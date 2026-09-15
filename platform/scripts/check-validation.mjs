// Fixtures for the API-route Zod schemas in lib/apiSchemas.ts — one rejected
// and one passing case per schema, run through the real schema objects
// (`.safeParse`), not a reimplementation. See docs/api-routes-audit.md for
// which routes these cover and lib/apiSchemas.ts's own header for why the
// schemas live in a file with no `next/server` import (so this script can
// import them directly with plain `node`, the same reason
// check-normalize.mjs needs the alias-loader but not the footage mocks).
//
//   node --experimental-strip-types --no-warnings scripts/check-validation.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemas = await import(join(root, "lib", "apiSchemas.ts"));
// editingOptionsShape.ts has zero imports beyond `zod` (no `@/` alias), so it
// needs no loader — that is the whole point of keeping it separate from
// derive.ts's other imports, and this import is proof it actually holds.
const { parseEditingOptionsShape } = await import(join(root, "lib", "editingOptionsShape.ts"));
const {
  RecordId,
  LooseRecordId,
  ExpandBriefBody,
  ArchiveSearchQuery,
  ArchiveSuggestQuery,
  ArchiveSuggestBody,
  ArchiveUseBody,
  AtListQuery,
  AtWriteBody,
  AtCreateBody,
  AudioBundleQuery,
  FootageImportBody,
  FootageSearchQuery,
  FootageSearchBody,
  MediaIngestBody,
  MediaQuery,
  MusicShareBody,
  VoicesQuery,
  YtKitQuery,
} = schemas;

const results = [];
const REC = "recABCDEFGHIJKLMN"; // a well-formed rec-id fixture, 14 chars after "rec"

const pass = (name, schema, input) => {
  const r = schema.safeParse(input);
  const ok = r.success;
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} (expected to PASS) -> ${ok ? "passed" : JSON.stringify(r.error.issues[0])}`);
};
const reject = (name, schema, input) => {
  const r = schema.safeParse(input);
  const ok = !r.success;
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} (expected to REJECT) -> ${ok ? "rejected" : "PASSED, should have been rejected"}`);
};

// --- RecordId / LooseRecordId ---------------------------------------------
pass("RecordId: well-formed", RecordId, REC);
reject("RecordId: too short", RecordId, "recABC");
pass("LooseRecordId: 5+ chars after rec", LooseRecordId, "recABCDE");
reject("LooseRecordId: too short", LooseRecordId, "rec123");

// --- expand-brief -----------------------------------------------------------
pass("ExpandBriefBody: full", ExpandBriefBody, { tema: "cars", brief: "b", tone: "Dark", language: "Romanian" });
pass("ExpandBriefBody: empty object still passes (soft-fail route)", ExpandBriefBody, {});

// --- archive/search ---------------------------------------------------------
pass("ArchiveSearchQuery: q present", ArchiveSearchQuery, { q: "apollo 11 launch" });
reject("ArchiveSearchQuery: missing q", ArchiveSearchQuery, {});
reject("ArchiveSearchQuery: q too short (1 char)", ArchiveSearchQuery, { q: "a" });
reject("ArchiveSearchQuery: q too long (201 chars)", ArchiveSearchQuery, { q: "a".repeat(201) });
{
  const r = ArchiveSearchQuery.safeParse({ q: "apollo", limit: "999" });
  const ok = r.success && r.data.limit === 40;
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ArchiveSearchQuery: limit clamps to 40, does not reject -> ${JSON.stringify(r.success ? r.data.limit : r.error.issues[0])}`);
}

// --- archive/suggest --------------------------------------------------------
pass("ArchiveSuggestQuery: valid project", ArchiveSuggestQuery, { project: REC });
reject("ArchiveSuggestQuery: bad project", ArchiveSuggestQuery, { project: "nope" });
pass("ArchiveSuggestBody: search stage", ArchiveSuggestBody, { stage: "search", scenes: [{ id: REC, queries: ["x"] }] });
pass("ArchiveSuggestBody: store stage", ArchiveSuggestBody, { stage: "store", processed: [REC], scenes: [] });
pass("ArchiveSuggestBody: unknown stage falls to the route's own 400 (schema itself never rejects)", ArchiveSuggestBody, {
  stage: "bogus",
});

// --- archive/use --------------------------------------------------------------
pass("ArchiveUseBody: valid", ArchiveUseBody, { sceneId: REC, stockId: REC });
reject("ArchiveUseBody: bad sceneId", ArchiveUseBody, { sceneId: "bad", stockId: REC });
reject("ArchiveUseBody: missing stockId", ArchiveUseBody, { sceneId: REC });

// --- at/[...path] --------------------------------------------------------------
pass("AtListQuery: empty is fine (all optional)", AtListQuery, {});
pass("AtListQuery: with formula and numbers", AtListQuery, { filterByFormula: "{x}=1", maxRecords: "10", pageSize: "5" });
pass("AtWriteBody: valid fields", AtWriteBody, { fields: { "Aprobare Imagine": true } });
pass("AtCreateBody: valid records", AtCreateBody, { records: [{ fields: { a: 1 } }] });

// --- audio-bundle --------------------------------------------------------------
pass("AudioBundleQuery: valid, chapter defaults to all", AudioBundleQuery, { project: REC });
reject("AudioBundleQuery: bad chapter", AudioBundleQuery, { project: REC, chapter: "bogus" });
reject("AudioBundleQuery: missing project", AudioBundleQuery, { chapter: "hook" });

// --- footage/import --------------------------------------------------------------
pass("FootageImportBody: valid url", FootageImportBody, { url: "https://commons.wikimedia.org/wiki/File:x" });
reject("FootageImportBody: missing url", FootageImportBody, {});

// --- footage/search --------------------------------------------------------------
pass("FootageSearchQuery: q present", FootageSearchQuery, { q: "ceuta migrants" });
pass("FootageSearchQuery: scene present, no q", FootageSearchQuery, { scene: REC });
reject("FootageSearchQuery: neither q nor a valid scene", FootageSearchQuery, {});
reject("FootageSearchQuery: q too short and scene invalid", FootageSearchQuery, { q: "a", scene: "bogus" });
pass("FootageSearchBody: request has narration", FootageSearchBody, { request: { narration: "a man walks" } });
reject("FootageSearchBody: request has nothing usable", FootageSearchBody, { request: {} });
reject("FootageSearchBody: missing request entirely", FootageSearchBody, {});

// --- media/ingest --------------------------------------------------------------
pass("MediaIngestBody: valid", MediaIngestBody, { sceneId: REC, field: "image", url: "https://fal.media/x.png" });
reject("MediaIngestBody: bad field enum", MediaIngestBody, { sceneId: REC, field: "audio", url: "https://fal.media/x.png" });
reject("MediaIngestBody: non-http url", MediaIngestBody, { sceneId: REC, field: "image", url: "ftp://x" });

// --- media --------------------------------------------------------------------
pass("MediaQuery: valid id", MediaQuery, { id: "1AbCdEfGhIjKlM" });
reject("MediaQuery: id too short", MediaQuery, { id: "short" });

// --- music --------------------------------------------------------------------
pass("MusicShareBody: valid id", MusicShareBody, { id: "drive-file-123" });
reject("MusicShareBody: id with a quote", MusicShareBody, { id: 'bad"id' });
reject("MusicShareBody: empty id", MusicShareBody, { id: "" });

// --- voices --------------------------------------------------------------------
pass("VoicesQuery: empty object, everything defaults", VoicesQuery, {});
pass("VoicesQuery: full", VoicesQuery, { q: "warm", page: "3", ids: "a,b", lang: "ro" });
reject("VoicesQuery: non-numeric page", VoicesQuery, { page: "abc" });

// --- yt-kit --------------------------------------------------------------------
pass("YtKitQuery: valid (loose, 5+ chars)", YtKitQuery, { project: "recABC12" });
reject("YtKitQuery: too short", YtKitQuery, { project: "rec12" });

// --- Editing Options shape check (lib/editingOptionsShape.ts), used by
// derive.ts's parseEditing() ---------------------------------------------
const checkShape = (name, input, want) => {
  const got = parseEditingOptionsShape(input, "check-validation fixture");
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)} (want ${JSON.stringify(want)})`);
};
checkShape("editing options: absent -> {}", undefined, {});
checkShape("editing options: null -> {}", null, {});
checkShape("editing options: empty string -> {}", "", {});
checkShape("editing options: real object passes through", { speed: 0.9 }, { speed: 0.9 });
checkShape("editing options: valid JSON string is parsed", '{"sfxLevel":0.5}', { sfxLevel: 0.5 });
checkShape("editing options: a JSON ARRAY is not a usable shape -> {} (logged)", "[1,2,3]", {});
checkShape("editing options: a bare number is not a usable shape -> {} (logged)", 42, {});
checkShape("editing options: unparseable string is not a usable shape -> {} (logged)", "not json at all {{{", {});

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
