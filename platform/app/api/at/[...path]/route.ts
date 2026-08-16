/**
 * An Airtable-shaped API over Postgres.
 *
 * WHY THIS EXISTS
 *
 * Twenty-one nodes across the workflows call `api.airtable.com` by hand rather
 * than through the Airtable node — the node could not do what those steps
 * needed. The first port counted nodes by type, missed all of them, and the
 * first test film died on its second node.
 *
 * Rewriting them was the obvious repair and the wrong one. Several carry
 * request bodies that are IIFEs parsing a model's reply into a fields object —
 * `Write Scene Rewrite` and `IR Write Image` are a hundred characters of
 * regex and recursive search each. Translating those by hand, twenty-one
 * times, in code that gates production, is how this migration would acquire
 * the bugs it has spent days avoiding.
 *
 * So the API moves to us instead. Converting a node becomes a URL swap:
 *
 *     https://api.airtable.com/v0/applPyJjvNzyxJkbv/tblkNIyOUeLnKqako/rec…
 *     http://web:3000/api/at/tblkNIyOUeLnKqako/rec…
 *
 * Method, body, expressions and every downstream `$json.fields[…]` stay
 * exactly as they are.
 *
 * WHAT IT DELIBERATELY IS NOT
 *
 * Not an Airtable clone. It answers the four request shapes these twenty-one
 * nodes actually make, and **throws on anything else** — an unknown table, an
 * unrecognised formula, a verb it does not implement. A shim that guesses is
 * worse than no shim, because the guess fails silently in production.
 */

import { NextRequest } from "next/server";
import { atList, atRead, atWrite, atCreateMany } from "@/lib/data/airtable-shim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INGEST_KEY = process.env.MEDIA_INGEST_KEY;

const fail = (status: number, message: string) =>
  Response.json({ error: { type: "SHIM_ERROR", message } }, { status });

function authed(req: NextRequest): boolean {
  if (!INGEST_KEY) return false;
  // n8n sends it as the header its httpHeaderAuth credential is configured
  // with; Authorization: Bearer is accepted so a node that still carries the
  // Airtable credential shape fails loudly on the key rather than confusingly
  // on the route.
  const header = req.headers.get("x-hov-key");
  if (header === INGEST_KEY) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${INGEST_KEY}`;
}

async function handle(
  req: NextRequest,
  path: string[],
  verb: "GET" | "PATCH" | "POST",
) {
  if (!INGEST_KEY) return fail(500, "MEDIA_INGEST_KEY is not set");
  if (!authed(req)) return fail(401, "bad key");

  const [table, recordId, ...rest] = path;
  if (!table || rest.length) return fail(400, `unsupported path /${path.join("/")}`);

  try {
    if (verb === "GET") {
      if (recordId) return Response.json(await atRead(table, recordId));
      const p = req.nextUrl.searchParams;
      return Response.json(
        await atList(table, {
          filterByFormula: p.get("filterByFormula"),
          maxRecords: p.get("maxRecords") ? Number(p.get("maxRecords")) : null,
          pageSize: p.get("pageSize") ? Number(p.get("pageSize")) : null,
        }),
      );
    }

    const body = (await req.json()) as {
      fields?: Record<string, unknown>;
      records?: Array<{ fields?: Record<string, unknown> }>;
    };

    if (verb === "PATCH") {
      if (!recordId) return fail(400, "PATCH needs a record id");
      return Response.json(await atWrite(table, recordId, body.fields ?? {}));
    }

    // POST is the batch create Save Evidence uses.
    if (recordId) return fail(400, "POST does not take a record id");
    return Response.json(await atCreateMany(table, body.records ?? []));
  } catch (e) {
    const message = (e as Error).message || "shim failed";
    // 422 is what Airtable answers for a bad field, and what the nodes'
    // onError settings were tuned against.
    const status = /unknown table|no .* column mapped|not recognised/i.test(message)
      ? 422
      : /not found/i.test(message)
        ? 404
        : 500;
    return fail(status, message);
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, (await ctx.params).path, "GET");
}
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, (await ctx.params).path, "PATCH");
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, (await ctx.params).path, "POST");
}
