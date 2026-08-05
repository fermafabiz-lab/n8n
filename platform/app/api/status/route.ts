// Production pulse for the nav ticker: {run, wait, err} project counts.
// Deliberately tiny — the client polls this every 30s from every page.
import { getStatusCounts } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getStatusCounts(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    // The ticker is decoration; a broken Airtable must never surface here.
    return Response.json({ run: 0, wait: 0, err: 0, unavailable: true });
  }
}
