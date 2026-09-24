"use client";

import { useEffect, useState } from "react";

/**
 * "How long has this been going on" — one owner, two badges.
 *
 * AFTER MOUNT, never in the initial render: the server and the client would
 * compute a different "now" and React would report a hydration mismatch on
 * every badge. The first paint shows nothing, and the age appears a tick
 * later.
 *
 * A missing or unparseable timestamp reads as null rather than "just now":
 * rows written before the stamping trigger have none, and claiming they
 * started this instant would be a fabricated reassurance.
 */
export function useWaited(since: string | null | undefined): string | null {
  const [waited, setWaited] = useState<string | null>(null);
  useEffect(() => {
    if (!since) {
      setWaited(null);
      return;
    }
    const started = new Date(since).getTime();
    if (!Number.isFinite(started)) return;
    const tick = () => {
      const mins = Math.max(0, Math.round((Date.now() - started) / 60000));
      setWaited(
        mins < 1 ? "just now" : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`,
      );
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [since]);
  return waited;
}

/** Minutes since a timestamp, or null. For deciding, where the string is for reading. */
export function minutesSince(since: string | null | undefined): number | null {
  if (!since) return null;
  const started = new Date(since).getTime();
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Math.round((Date.now() - started) / 60000));
}

/**
 * What Media Generation waits before it gives up on a clip and re-shoots it:
 * `MAX_POLLS = 20` × 30s in `Check Job Status` / `Check Video Regen`
 * (db/port/clip-wait/). The site quotes this number at the producer, so the
 * two must move together — db/port/clip-wait/check.mjs asserts they do.
 */
export const CLIP_RESHOOT_MINUTES = 10;
