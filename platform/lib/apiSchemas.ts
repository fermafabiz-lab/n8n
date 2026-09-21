/**
 * The Zod schemas for the API route boundary — see `docs/api-routes-audit.md`
 * for which of the 16 routes this covers and why, and `lib/validation.ts` for
 * the `parseJsonBody`/`parseQuery`/`zodBad` helpers that use these.
 *
 * Split into its own file, with NO `next/server` import, so it can be tested
 * directly by a plain `node` script (`scripts/check-validation.mjs`) without
 * Next's bundler resolving `next/server` — the same reason
 * `editingOptionsShape.ts` is split out of `derive.ts`'s reach. Nothing here
 * needs Next at all; these are pure Zod objects.
 *
 * This is deliberately a THIN layer, the same principle the `normalize*`
 * family in `lib/data/derive.ts` already follows for `Editing Options`:
 * it validates the SHAPE of what arrives at the boundary — replacing scattered
 * ad hoc regex/type checks with one declarative schema per route — and it does
 * NOT replace business logic that already lives downstream. Two concrete
 * examples of what stays untouched on purpose:
 *
 * - `at/[...path]`'s `fields`/`records` bodies carry arbitrary Airtable field
 *   names that vary per table. `hov.at_write`/`at_create` (through
 *   `lib/data/airtable-shim.ts`) already refuse an unmapped field name —
 *   duplicating that field map here in a Zod schema would be a second copy
 *   that can drift from the real one. Only the ENVELOPE (`fields` is an
 *   object, `records` is an array of objects) is validated here.
 * - `archive/suggest`'s per-scene arrays already do their own soft, per-item
 *   filtering (drop a malformed scene, keep going) because a batch from n8n
 *   is allowed to be imperfect. Zod validates the top-level envelope; the
 *   per-item tolerance stays exactly as it was.
 *
 * Every schema here preserves the EXISTING response contract of the route it
 * replaces manual checks in — same status code, same `{ok:false,error}` (or
 * whatever shape that route already used) — because the point of this pass is
 * a safer, more declarative boundary, not a change in what callers see.
 *
 * Not covered: `status` and `footage/providers` (no input at all), and
 * `footage/upload` (multipart/form-data, not JSON — Zod does not apply
 * cleanly and the route's own manual checks stay as they are).
 */
import { z } from "zod";

/** An Airtable-shaped record id — `rec` + 14 alphanumerics, used everywhere. */
export const RecordId = z.string().regex(/^rec[0-9A-Za-z]{14}$/, "not a record id");

/** yt-kit's project id check is looser (5+ chars) than everywhere else — kept as-is. */
export const LooseRecordId = z.string().regex(/^rec[A-Za-z0-9]{5,}$/, "not a record id");

// app/api/expand-brief — soft-fail route: a bad body still answers 200 with
// brief:null (see the route's own header comment), so this schema is
// permissive by design. It replaces the untyped `let body: {...} = {}` with
// something that actually validates and defaults.
export const ExpandBriefBody = z.object({
  tema: z.string().optional().default(""),
  brief: z.string().optional().default(""),
  tone: z.string().optional().default(""),
  language: z.string().optional().default("English"),
});

// app/api/series-next — the episode suggestion. Unlike ExpandBriefBody this
// one REFUSES a bad body (the route answers 200 with nulls either way): the
// whole request is one record id, and a request without a valid one has
// nothing for n8n to look up.
export const SeriesNextBody = z.object({
  series_id: RecordId,
  language: z.string().optional().default("English"),
});

// app/api/archive/search
export const ArchiveSearchQuery = z.object({
  q: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, " "))
    .refine((s) => s.length >= 2, "q must be at least 2 characters")
    .refine((s) => s.length <= 200, "q is too long"),
  type: z.enum(["video", "image", "any"]).optional().default("any"),
  // Clamped, not rejected — an out-of-range limit was always a clamp here,
  // never a 400, and this schema keeps that rather than tightening it.
  limit: z.coerce
    .number()
    .optional()
    .default(12)
    .transform((n) => Math.min(Math.max(Number.isFinite(n) && n > 0 ? n : 12, 1), 40)),
  providers: z.string().optional().default(""),
  library: z.string().optional(),
});

// app/api/archive/suggest — GET
export const ArchiveSuggestQuery = z.object({
  project: RecordId,
});
// POST — the two stages carry genuinely different bodies; only the envelope
// is checked, exactly like archive/search's providers list and unlike a
// route that owns its whole shape, because every per-item field below is
// re-validated and soft-filtered downstream (REC-id regex, per-scene
// try/catch) on purpose — a batch from n8n is allowed to include junk.
export const ArchiveSuggestBody = z.union([
  z.object({ stage: z.literal("search"), scenes: z.array(z.unknown()).optional().default([]) }),
  z.object({
    stage: z.literal("store"),
    project: z.string().optional(),
    processed: z.array(z.unknown()).optional().default([]),
    scenes: z.array(z.unknown()).optional().default([]),
  }),
  // any other/missing stage — the route's own `bad(400, "stage must be search or store")` still fires
  z.object({ stage: z.string().optional() }).transform(() => ({ stage: "" as const })),
]);

// app/api/archive/use
export const ArchiveUseBody = z.object({
  sceneId: RecordId,
  stockId: RecordId,
  offsetSeconds: z.coerce.number().optional(),
  seconds: z.coerce.number().optional(),
});

// app/api/at/[...path]
export const AtListQuery = z.object({
  filterByFormula: z.string().optional(),
  maxRecords: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});
export const AtWriteBody = z.object({
  fields: z.record(z.string(), z.unknown()).optional().default({}),
});
export const AtCreateBody = z.object({
  records: z
    .array(z.object({ fields: z.record(z.string(), z.unknown()).optional().default({}) }))
    .optional()
    .default([]),
});

// app/api/audio-bundle
export const AudioBundleQuery = z.object({
  project: RecordId,
  chapter: z
    .string()
    .trim()
    .regex(/^(all|hook|\d{1,3})$/, "invalid chapter")
    .optional()
    .default("all"),
});

// app/api/footage/import
export const FootageImportBody = z.object({
  url: z.string().trim().min(1, "url is required"),
  confirm: z.boolean().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  eventName: z.string().optional(),
  location: z.string().optional(),
  country: z.string().optional(),
  filmingDate: z.string().optional(),
  rights: z.enum(["cleared", "attribution_required", "manual_review"]).optional(),
  attribution: z.string().optional(),
  notes: z.string().optional(),
});

// app/api/footage/search — GET. `q` may be short/absent only when a valid
// `scene` id is given (the route then builds the request from the scene's
// own narration instead of the typed text) — the object-level `.refine()`
// below is that rule; per-field checks alone cannot express it.
export const FootageSearchQuery = z
  .object({
    q: z
      .string()
      .trim()
      .transform((s) => s.replace(/\s+/g, " "))
      .optional()
      .default(""),
    scene: z.string().optional().default(""),
    type: z.enum(["video", "image", "any"]).optional().default("any"),
    providers: z.string().optional(),
    // Same clamp-not-reject as archive/search: `Math.min(Math.max(limit,1),40)`.
    limit: z.coerce
      .number()
      .optional()
      .default(12)
      .transform((n) => Math.min(Math.max(Number.isFinite(n) && n > 0 ? n : 12, 1), 40)),
    library: z.string().optional(),
    fresh: z.string().optional(),
  })
  .refine((v) => v.q.length <= 200, { message: "q is too long", path: ["q"] })
  .refine((v) => v.q.length >= 2 || RecordId.safeParse(v.scene).success, {
    message: "q must be at least 2 characters (or pass scene=)",
    path: ["q"],
  });
// POST — same "envelope only" principle as archive/suggest: `buildFootageRequest()`
// does the real field-by-field defaulting downstream, so every field here is
// loosely typed and the route's own `!raw.narration && !keywords.length &&
// !queries.length` refusal is expressed as a `.refine()` rather than duplicated.
export const FootageSearchBody = z.object({
  request: z
    .object({
      sceneId: z.string().optional(),
      narration: z.string().optional(),
      queries: z.array(z.string()).optional(),
      topic: z.string().optional(),
      event: z.string().optional(),
      location: z.string().optional(),
      country: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      people: z.array(z.string()).optional(),
      organizations: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional(),
      preferredMediaType: z.enum(["video", "image"]).optional(),
      preferredFootageType: z.enum(["broll", "stockshots", "speech", "interview", "any"]).optional(),
      requireExactEvent: z.boolean().optional(),
    })
    .optional()
    .default({})
    .refine(
      (r) => Boolean(r.narration) || Boolean(r.keywords?.length) || Boolean(r.queries?.length),
      "request needs narration, keywords or queries",
    ),
  providers: z.string().optional(),
  // Same clamp as the GET's `limit`: `Math.min(Math.max(Number(body.top)||12,1),40)`.
  top: z.coerce
    .number()
    .optional()
    .default(12)
    .transform((n) => Math.min(Math.max(Number.isFinite(n) && n > 0 ? n : 12, 1), 40)),
  localOnly: z.boolean().optional(),
  fresh: z.boolean().optional(),
});

// app/api/media/ingest
export const MediaIngestBody = z.discriminatedUnion("field", [
  z.object({
    sceneId: RecordId,
    field: z.enum(["image", "video", "image_version"]),
    url: z.string().regex(/^https?:\/\//i, "bad url"),
    fields: z.record(z.string(), z.unknown()).optional(),
  }),
  // A reference sheet (a character turnaround or portrait, an object sheet, a
  // set plate) — bound to a PROJECT and a name, not a scene, and keyed by the
  // Flow id it carries in Editing Options. Media Generation posts one right
  // after making it, while Flow's signed URL is still alive (db/012).
  z.object({
    field: z.literal("sheet"),
    projectId: RecordId,
    kind: z.enum(["cast", "object", "location"]),
    name: z.string().trim().min(1).max(200),
    flowId: z.string().trim().min(6).max(200),
    url: z.string().regex(/^https?:\/\//i, "bad url"),
  }),
  // The same, several at once: one pass of Media Generation makes up to six
  // cast sheets and up to ten plates, and one request per pass keeps the
  // batch's item count at one for the node that follows. A sheet that fails
  // is reported in the answer, never a failed request — the batch must not
  // die over a picture we merely wanted to keep.
  z.object({
    field: z.literal("sheets"),
    projectId: RecordId,
    items: z
      .array(
        z.object({
          kind: z.enum(["cast", "object", "location"]),
          name: z.string().trim().min(1).max(200),
          flowId: z.string().trim().min(6).max(200),
          url: z.string().regex(/^https?:\/\//i, "bad url"),
        }),
      )
      .min(1)
      .max(24),
  }),
]);

// app/api/media
export const MediaQuery = z.object({
  id: z.string().regex(/^[\w-]{10,}$/, "invalid id"),
  dl: z.string().optional().default(""),
});

// app/api/music — POST is soft-fail (200, {url:null,error}), like expand-brief.
export const MusicShareBody = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .refine((s) => !/[\s"'<>]/.test(s), "bad id"),
});

// app/api/voices — no existing validation at all; every field optional and
// bounded, matching what the route already does with `.get() || ""` defaults.
export const VoicesQuery = z.object({
  q: z.string().optional().default(""),
  page: z.string().regex(/^\d+$/).optional().default("1"),
  ids: z.string().optional(),
  lang: z.string().optional().default(""),
});

// app/api/yt-kit
export const YtKitQuery = z.object({
  project: LooseRecordId,
});
