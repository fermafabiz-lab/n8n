"use client";

import { useEffect, useState } from "react";

/**
 * The finished moment: when a project this session watched in production
 * lands its final video, the page flares once with the same warm light leak
 * the films use at chapter boundaries — the site speaking the render's
 * transition language, exactly once.
 *
 * Armed only by seeing the project UNFINISHED first (sessionStorage), so
 * opening an old finished project never flashes. Fired at most once per
 * project per session.
 */
export default function FinishedFlash({
  projectId,
  finished,
}: {
  projectId: string;
  finished: boolean;
}) {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    try {
      const seenKey = `vf-seen-unfinished:${projectId}`;
      const firedKey = `vf-finflash:${projectId}`;
      if (!finished) {
        sessionStorage.setItem(seenKey, "1");
        return;
      }
      if (sessionStorage.getItem(seenKey) && !sessionStorage.getItem(firedKey)) {
        sessionStorage.setItem(firedKey, "1");
        setFlash(true);
        const t = setTimeout(() => setFlash(false), 1500);
        return () => clearTimeout(t);
      }
    } catch {
      // sessionStorage unavailable — no flash, no harm.
    }
  }, [finished, projectId]);

  if (!flash) return null;
  return <div className="finflash" aria-hidden="true" />;
}
