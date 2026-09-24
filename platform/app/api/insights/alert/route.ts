import { NextResponse } from "next/server";
import { getApiReadings } from "@/lib/data";
import { alertsOf, burnsOf } from "@/lib/insights";

export const dynamic = "force-dynamic";

/**
 * What the strip at the top of every page shows (components/CreditsAlert.tsx):
 * only what will stop a film — a paid service that is out, or nearly out at
 * the recent pace. lib/insights.ts decides both, for this route, the Settings
 * dot and /admin/insights alike.
 *
 * Behind the site password like every page (middleware.ts), so /login never
 * learns a balance. Any failure answers "nothing to say": a strip that cries
 * wolf when the database hiccups would soon be ignored, which is the one thing
 * it must never be.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const data = await getApiReadings(8);
    if (!data.ready) return NextResponse.json({ alerts: [] }, { headers });
    const now = Date.now();
    return NextResponse.json({ alerts: alertsOf(data.latest, burnsOf(data.latest, data.history, now), now) }, { headers });
  } catch {
    return NextResponse.json({ alerts: [] }, { headers });
  }
}
