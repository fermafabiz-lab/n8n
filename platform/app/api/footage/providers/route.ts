/**
 * The providers, with their health — for the picker's filter and the admin
 * page's status strip.
 *
 *   GET /api/footage/providers
 */

import { NextRequest, NextResponse } from "next/server";
import { footageAuthorized } from "@/lib/footage/auth";
import { allProviders } from "@/lib/footage/registry";
import { heldBack, providerStats } from "@/lib/footage/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!footageAuthorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const stats = await providerStats();
  const byId = new Map(stats.map((s) => [s.provider, s]));
  return NextResponse.json({
    ok: true,
    providers: allProviders().map((p) => ({
      id: p.id,
      displayName: p.displayName,
      enabled: p.enabled,
      disabledReason: p.disabledReason,
      priority: p.priority,
      categories: p.categories,
      searchCapabilities: p.searchCapabilities,
      heldBack: heldBack(p.id),
      stats: byId.get(p.id) ?? null,
    })),
  });
}
