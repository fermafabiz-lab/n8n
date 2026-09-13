/**
 * Helpers for validating a route's body/query against the schemas in
 * `lib/apiSchemas.ts` and turning a failure into a response.
 *
 * This file imports `next/server` (for `NextResponse`) and is route-only —
 * `lib/data/derive.ts` must never import it, because `derive.ts` is imported
 * by CLIENT components for its values and `next/server` cannot go anywhere
 * near a browser bundle (see the comment in `lib/editingOptionsShape.ts`,
 * which is why the Editing-Options shape check lives there instead of here).
 * The actual schemas live in `lib/apiSchemas.ts`, which has no such
 * constraint and is what `scripts/check-validation.mjs` imports directly.
 */
import { z } from "zod";
import { NextResponse } from "next/server";

export class ValidationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Parse a `Request`/`NextRequest` body as JSON against `schema`, throwing a
 * `ValidationError` (400, or `notJsonStatus` if the body isn't even JSON) on
 * failure. Callers catch this once, at the top of the handler, and turn it
 * into whatever response shape that route already uses — see `zodBad()`
 * below for the common case.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
  opts: { notJsonStatus?: number } = {},
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError(opts.notJsonStatus ?? 400, "body is not JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(400, parsed.error.issues[0]?.message ?? "invalid body");
  }
  return parsed.data;
}

/** Same as `parseJsonBody`, but for a `URLSearchParams` (a GET route). */
export function parseQuery<S extends z.ZodTypeAny>(params: URLSearchParams, schema: S): z.infer<S> {
  const obj = Object.fromEntries(params.entries());
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    throw new ValidationError(400, parsed.error.issues[0]?.message ?? "invalid query");
  }
  return parsed.data;
}

/** The `{ok:false,error}` shape most routes in this repo already use. */
export function zodBad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** The `{error}` shape a few older routes use instead — kept distinct rather
 *  than unifying all 16 onto one envelope, which would be a response-shape
 *  change this pass does not make. */
export function zodBadPlain(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export { EditingOptionsShape, parseEditingOptionsShape } from "./editingOptionsShape";
export * from "./apiSchemas";
