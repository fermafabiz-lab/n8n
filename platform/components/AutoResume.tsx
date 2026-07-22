"use client";

import { useEffect, useRef, useState } from "react";
import { resumeProject, type ActionResult } from "@/app/actions";
import { alarm, markTitle } from "@/components/StageChime";

// How long the stalled state must persist before we act — short gaps between
// n8n executions (orchestrator hand-offs) must not trigger a resume.
const CONFIRM_MS = 45_000;
// Minimum spacing between automatic resumes for the same project, so a
// permanently failing pipeline alarms repeatedly but doesn't spin in a loop.
const COOLDOWN_MS = 4 * 60_000;

/**
 * Watchdog for a project whose production died mid-run: nothing is running
 * in n8n, nothing is waiting on the user, yet the video isn't finished.
 * After the stall persists ~45s it sounds a distinct alarm and presses
 * Resume automatically — the n8n resume flow only regenerates missing
 * pieces, so this is always safe.
 */
export default function AutoResume({
  projectId,
  stalled,
}: {
  projectId: string;
  stalled: boolean;
}) {
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!stalled) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setArmed(false);
      setMsg(null);
      return;
    }
    setArmed(true);
    if (timer.current) return; // already counting down
    timer.current = setTimeout(async () => {
      timer.current = null;
      const k = `vf-auto-resume-${projectId}`;
      const last = Number(sessionStorage.getItem(k) ?? 0);
      alarm();
      markTitle();
      if (Date.now() - last < COOLDOWN_MS) {
        setMsg({
          ok: false,
          message:
            "Still stalled after an automatic resume — check Production health / n8n for a persistent error.",
        });
        return;
      }
      sessionStorage.setItem(k, String(Date.now()));
      setMsg(await resumeProject(projectId));
    }, CONFIRM_MS);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stalled, projectId]);

  if (!armed && !msg) return null;
  return (
    <div
      className="setupnote"
      style={{ borderColor: "rgba(240,101,91,0.4)", marginBottom: 16 }}
    >
      {msg ? (
        <span>{msg.message}</span>
      ) : (
        <span>
          <b>Production looks stalled</b> — nothing is running and nothing is
          waiting on you. Auto-resume kicks in shortly; press ⟳ Resume above to
          skip the wait.
        </span>
      )}
    </div>
  );
}
