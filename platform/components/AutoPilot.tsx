"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { autoApproveTick, setAutoApprove, type ActionResult } from "@/app/actions";

/**
 * The hand of hands-off mode. The flag lives in Editing Options; this is the
 * thing that acts on it: on every mount (the page remounts itself every 10s
 * via AutoRefresh) it runs one `autoApproveTick`, which signs off everything
 * currently waiting through the same actions the buttons call.
 *
 * TWO HONEST LIMITS, both said on the banner:
 * - it works while a tab with this page is open somewhere. The tick is a
 *   server action; nothing on the server schedules it. Close every tab and
 *   production pauses at the next human gate exactly as it always did — it
 *   resumes the moment the page is opened again, so nothing is lost, only
 *   time.
 * - it approves UNSEEN. That is the entire point and the entire trade;
 *   a producer who wants a look at anything turns it off, and every
 *   already-given approval stays.
 *
 * The gap guard exists because AutoRefresh REMOUNTS this component: a mount
 * is not a schedule, so two mounts seconds apart (navigation + refresh)
 * must not run two overlapping passes — approvals are idempotent, but the
 * final-render press is not something to race with itself.
 */
const MIN_GAP_MS = 8_000;

export default function AutoPilot({ projectId }: { projectId: string }) {
  const [last, setLast] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const ran = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const key = `vf-autopilot:${projectId}`;
    try {
      const prev = Number(sessionStorage.getItem(key) ?? 0);
      if (Date.now() - prev < MIN_GAP_MS) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {}
    autoApproveTick(projectId).then((r) => {
      setLast(r);
      // Something was actually approved — show it now rather than at the
      // next scheduled refresh, or the page reads 10s behind its own work.
      if (r.ok && r.message.startsWith("Auto-approved")) router.refresh();
    });
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
