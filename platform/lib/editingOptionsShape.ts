/**
 * The thin Editing-Options shape check, split out of `lib/validation.ts` into
 * its own file with NO `next/server` import.
 *
 * Why it has to be separate: `lib/data/derive.ts` is imported by CLIENT
 * components for its VALUES (not just types) — `HOOK_STYLES`, the
 * `normalize*` family, etc. — which is exactly the shape of the bug CLAUDE.md
 * documents under "HookPanel, a client component, imported the style list as
 * a VALUE from `lib/data`, which drags the Postgres adapter into the browser
 * bundle." `lib/validation.ts` imports `NextResponse` from `next/server` for
 * its route-only helpers, and `next/server` is not something a browser
 * bundle can include. So the ONE thing `derive.ts` needs from the validation
 * layer — the shape check for `parseEditing()` — lives here instead, with
 * zero Next.js imports, and `lib/validation.ts` re-exports it for route
 * callers that want it alongside `parseJsonBody`/`parseQuery`.
 */
import { z } from "zod";

/**
 * The loosest possible check on the raw `Editing Options` blob: is it even a
 * JSON object (a record), as opposed to an array, a bare string, a number, or
 * something a corrupted row or a bad migration left behind? This is NOT
 * field-level validation — every individual key is still the `normalize*`
 * family's job in `lib/data/derive.ts`, which already refuses/clamps each
 * field on its own and must stay the single owner of that behaviour.
 */
export const EditingOptionsShape = z.record(z.string(), z.unknown());

/**
 * Used by `parseEditing()` in derive.ts, which — unlike a route boundary —
 * must never throw: `Editing Options` is read on every project page render,
 * and a single corrupted row must degrade to `{}` (exactly like every
 * `normalize*` reader already degrades on a bad individual field), not take
 * the whole page down. What this buys over the old silent `catch { return {} }`
 * is a clear, greppable log line naming what was actually found, so "a row is
 * corrupted" stops being invisible until a producer notices.
 */
export function parseEditingOptionsShape(raw: unknown, context?: string): Record<string, unknown> {
  const asObject = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : safeJsonParse(raw);
  if (asObject === null) {
    console.warn(
      `Editing Options: not a usable object${context ? ` (${context})` : ""} — got ${describeShape(raw)}. Reading as {}.`,
    );
    return {};
  }
  const parsed = EditingOptionsShape.safeParse(asObject);
  if (!parsed.success) {
    console.warn(
      `Editing Options: failed the shape check${context ? ` (${context})` : ""} — ${parsed.error.issues[0]?.message}. Reading as {}.`,
    );
    return {};
  }
  return parsed.data;
}

function safeJsonParse(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function describeShape(raw: unknown): string {
  if (raw === null) return "null";
  if (raw === undefined) return "undefined";
  if (Array.isArray(raw)) return `an array of ${raw.length}`;
  return `a ${typeof raw}${typeof raw === "string" ? ` (${raw.slice(0, 40)}${raw.length > 40 ? "…" : ""})` : ""}`;
}
