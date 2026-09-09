/**
 * Who may call the footage routes: the producer's browser (the site cookie)
 * and n8n (the same `x-hov-key` it uses for /api/media/ingest and /api/at).
 * middleware.ts lets the key past the login redirect for /api/footage/ and
 * /api/archive/; every route checks again here so it is safe on its own.
 */

import type { NextRequest } from "next/server";

export function footageAuthorized(req: NextRequest): boolean {
  const key = process.env.MEDIA_INGEST_KEY;
  if (key && req.headers.get("x-hov-key") === key) return true;
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return true;
  return req.cookies.get("vf_auth")?.value === expected;
}

export const footageUsable = (): boolean => process.env.DATA_BACKEND === "postgres";
