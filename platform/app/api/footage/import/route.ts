/**
 * Universal URL import.
 *
 *   POST /api/footage/import  { url }                       → the extracted asset, unsaved, with warnings
 *   POST /api/footage/import  { url, confirm: true, ... }   → filed in the library; answers the row
 *
 * Two steps on purpose: the person sees what the page actually stated —
 * title, date, rights, whether a media file was even exposed — before it
 * becomes a library row, and an asset whose rights are MANUAL REVIEW says so
 * in the preview rather than after. The confirm step may carry overrides
 * (title, description, event, location, date, rights) for what the page
 * got wrong or left out; the page's own text is kept as `rightsText`.
 *
 * What it will not do is in lib/footage/urlImport.ts: no DRM, no paywalls,
 * no logins, no platform streams.
 */

import { NextRequest, NextResponse } from "next/server";
import { footageAuthorized, footageUsable } from "@/lib/footage/auth";
import { ImportRefused, importFootageFromUrl } from "@/lib/footage/urlImport";
import { validateRights } from "@/lib/footage/rights";
import { saveStockCandidates, updateStockMedia } from "@/lib/data/stock";
import type { NormalizedFootageAsset } from "@/lib/footage/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

const text = (v: unknown, cap = 400): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, cap) : null;
};

export async function POST(req: NextRequest) {
  if (!footageAuthorized(req)) return bad(401, "unauthorized");
  if (!footageUsable()) return bad(503, "the footage library needs the Postgres backend");
  let body: {
    url?: string;
    confirm?: boolean;
    title?: string;
    description?: string;
    eventName?: string;
    location?: string;
    country?: string;
    filmingDate?: string;
    rights?: "cleared" | "attribution_required" | "manual_review";
    attribution?: string;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return bad(400, "body is not JSON");
  }
  const url = String(body.url ?? "").trim();
  if (!url) return bad(400, "url is required");

  let imported;
  try {
    imported = await importFootageFromUrl(url, { signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    if (e instanceof ImportRefused) return bad(422, e.message);
    return bad(502, `Could not read the page: ${(e as Error).message}`);
  }
  const rights = validateRights(imported.asset);

  if (!body.confirm) {
    return NextResponse.json({ ok: true, saved: false, via: imported.via, asset: imported.asset, rights, warnings: imported.warnings });
  }

  // Overrides: only what a person typed, and only the fields they may set.
  // A rights DOWNGRADE is honoured; an upgrade to cleared/attribution on an
  // asset the page marked restricted is not — a licence that says no stays no.
  const a: NormalizedFootageAsset = { ...imported.asset };
  if (text(body.title, 200)) a.title = text(body.title, 200)!;
  if (body.description !== undefined) a.description = text(body.description, 2000);
  if (body.eventName !== undefined) a.eventName = text(body.eventName, 200);
  if (body.location !== undefined) a.location = text(body.location, 200);
  if (body.country !== undefined) a.country = text(body.country, 80);
  if (body.filmingDate !== undefined) a.filmingDate = text(body.filmingDate, 40);
  if (a.reviewStatus !== "rejected" && body.rights) {
    if (body.rights === "cleared" || body.rights === "attribution_required") {
      a.reviewStatus = "auto_approved";
      a.reviewReason = null;
      a.attributionRequired = body.rights === "attribution_required";
      if (a.rightsStatus === "unknown") a.rightsStatus = "other_free";
      a.commercialUse = "allowed";
      a.modifications = "allowed";
      a.rightsText = [a.rightsText, "Rights confirmed by the producer at import."].filter(Boolean).join(" · ");
    } else {
      a.reviewStatus = "manual_review";
    }
  }
  if (text(body.attribution, 300)) a.credit = text(body.attribution, 300);
  a.searchableText = [a.title, a.description, a.eventName, a.location, a.country, a.creator, a.credit, (a.categories ?? []).join(" ")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .slice(0, 4000);

  const filed = await saveStockCandidates([a], `import:${a.title.slice(0, 120)}`);
  const row = filed.get(`${a.provider}:${a.providerAssetId}`);
  if (!row) return bad(500, "the asset could not be filed in the library");
  // A confirmed import is a person's act: a manual-review row they confirmed
  // is `approved`, and a note travels with it.
  const status = a.reviewStatus === "auto_approved" && body.rights ? "approved" : row.status;
  const saved = await updateStockMedia(row.id, { ...(text(body.notes, 1000) ? { notes: text(body.notes, 1000) } : {}) }, "Imported from URL by the producer.");
  if (status !== row.status) {
    const { setStockStatus } = await import("@/lib/data/stock");
    await setStockStatus(row.id, status);
  }
  return NextResponse.json({ ok: true, saved: true, via: imported.via, asset: saved ?? row, rights: validateRights(saved ?? row), warnings: imported.warnings });
}
