"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Pulse {
  run: number;
  wait: number;
  err: number;
  unavailable?: boolean;
}

/**
 * The factory's pulse, in the middle of the nav pill: one glance from any
 * page says whether production needs you. Amber (pulsing) when something
 * waits on a review, blue when the line is just working, dim when quiet.
 * Clicking it goes home, where the waiting projects are.
 */
export default function ProductionTicker() {
  const [pulse, setPulse] = useState<Pulse | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Pulse;
        if (alive && !data.unavailable) setPulse(data);
      } catch {
        // Leave the last known value on screen; the ticker never errors.
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!pulse) return null;
  const parts: string[] = [];
  if (pulse.wait > 0) parts.push(`${pulse.wait} NEED${pulse.wait === 1 ? "S" : ""} YOU`);
  if (pulse.run > 0) parts.push(`${pulse.run} RENDERING`);
  if (pulse.err > 0) parts.push(`${pulse.err} FAILED`);
  const dot =
    pulse.wait > 0 ? "amber" : pulse.err > 0 ? "red" : pulse.run > 0 ? "blue" : "";

  return (
    <Link href="/" className="ticker" title="Production status — click for the floor">
      <span className={`tdot ${dot}`} />
      {parts.length ? parts.join(" · ") : "ALL QUIET"}
    </Link>
  );
}
