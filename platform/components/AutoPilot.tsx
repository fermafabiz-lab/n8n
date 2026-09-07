"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { autoApproveTick, setAutoApprove, type ActionResult } from "@/app/actions";

/**
 * The hand of hands-off mode. The flag lives in Editing Options; this is the
 * thing that acts on it: while the page is open it runs `autoApproveTick` on
 * its own interval, which signs off everything currently waiting through the
 * same actions the buttons call.
 *
 * THE INTERVAL IS THIS COMPONENT'S OWN, not AutoRefresh's. `router.refresh()`
 * re-renders server components and RECONCILES client ones — it does not
 * remount them, so a mount-only tick runs exactly once per real page load.
 * That shipped first, and its failure was measured on a live film: the
 * script gate approved on a reload and the nine scene texts that landed
 * 45 seconds later sat unapproved for minutes with the banner up. A mount
 * is not a schedule; the setInterval below is.
 *
 * TWO HONEST LIMITS, both said on the banner:
 * - it works while a tab with this page is open somewhere. The tick is a
 *   server action; nothing on the server schedules it. Close every tab and
 *   production pauses at the next human gate exactly as it always did — it
 *   resumes the moment the page is opened again, so nothing is lost, only
 *   time. A BACKGROUND tab still ticks on purpose — "open somewhere" must
 *   include a tab you are not looking at, so this does not pause on
 *   document.hidden the way AutoRefresh does.
 * - it approves UNSEEN. That is the entire point and the entire trade;
 *   a producer who wants a look at anything turns it off, and every
 *   already-given approval stays.
 *
 * The gap guard is localStorage, not sessionStorage, because sessionStorage
 * is PER TAB: two open tabs would each tick with no knowledge of the other.
 * Approvals are idempotent, but the final-render press is not something to
 * race with itself — the shared timestamp makes tabs alternate instead.
 */
const MIN_GAP_MS = 8_000;
const TICK_MS = 10_000;

export default function AutoPilot({ projectId }: { projectId: string }) {
  const [last, setLast] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const key = `vf-autopilot:${projectId}`;
    let stopped = false;
    let inFlight = false;
    const pass = async () => {
      // Never overlap a slow pass with the next interval firing.
      if (stopped || inFlight) return;
      try {
        const prev = Number(localStorage.getItem(key) ?? 0);
        if (Date.now() - prev < MIN_GAP_MS) return;
        localStorage.setItem(key, String(Date.now()));
      } catch {}
      inFlight = true;
      try {
        const r = await autoApproveTick(projectId);
        if (stopped) return;
        setLast(r);
        // Something was actually approved — show it now rather than at the
        // next scheduled refresh, or the page reads 10s behind its own work.
        if (r.ok && r.message.startsWith("Auto-approved")) router.refresh();
      } finally {
        inFlight = false;
      }
    };
    void pass();
    const id = setInterval(() => void pass(), TICK_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const turnOff = async () => {
    setPending(true);
    const r = await setAutoApprove(projectId, false);
    setLast(r);
    setPending(false);
    router.refresh();
  };

  return (
    <div className="autopilot" role="status">
      <span className="ap-dot" aria-hidden />
      <span className="ap-text">
        <b>Hands-off mode</b> — every gate signs itself off as its asset lands,
        and the final render starts by itself. Nothing waits for you, and
        nothing gets a look first. Keep this page open somewhere; the pipeline
        pauses at the next gate whenever it is closed, and catches up when it
        is reopened.
        {last && !last.ok && (
          <em className="ap-err"> Last pass failed: {last.message}</em>
        )}
      </span>
      <button className="btn" disabled={pending} onClick={turnOff}>
        {pending ? "…" : "Turn off"}
      </button>
    </div>
  );
}
