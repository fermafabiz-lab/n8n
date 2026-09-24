"use client";

import { CLIP_RESHOOT_MINUTES, minutesSince, useWaited } from "@/lib/use-waited";

/**
 * The clock on a clip the batch is making right now.
 *
 * WHY THIS EXISTS. A scene waiting for its clip showed a "Rendering" chip and
 * nothing else — the same pixels in second one and in minute forty. On
 * 2026-09-24 a producer watched two scenes sit like that for an afternoon;
 * the batch was alive and polling a Veo job that was already dead, and the
 * only thing the screen offered was a chip that never changed. The reflex
 * that follows is Stop, then Resume — which is the worst possible move, since
 * it resets the poll counter and starts the wait from zero. That loop, not
 * the dead job, is what turned a ten-minute hiccup into hours.
 *
 * So this says the two things that decide what to do: how long it has been,
 * and that the pipeline gets itself out. It never advises stopping.
 */
export default function ClipWait({ since }: { since: string | null | undefined }) {
  const waited = useWaited(since);
  const mins = minutesSince(since);
  const overdue = mins !== null && mins >= CLIP_RESHOOT_MINUTES;

  return (
    <div style={{ marginTop: 10 }}>
      <span className="chip run" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span className="regenspin" aria-hidden />
        Making the clip
        {waited && <span style={{ opacity: 0.75 }}>· {waited}</span>}
      </span>
      <p style={{ margin: "8px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--dim)" }}>
        {overdue ? (
          <>
            This one is over the {CLIP_RESHOOT_MINUTES}-minute mark, so the
            job is treated as failed and re-shot automatically — up to five
            times before the run gives up on the scene. Nothing is lost while
            you wait.
          </>
        ) : (
          <>
            A clip usually lands in one to three minutes. Past{" "}
            {CLIP_RESHOOT_MINUTES}, n8n stops waiting and re-shoots it by
            itself.
          </>
        )}{" "}
        <b>Don&apos;t stop production to hurry it</b> — that throws the
        generation away and starts the wait from zero.
      </p>
      <style>{`
        .regenspin {
          width: 9px; height: 9px; border-radius: 50%;
          border: 1.5px solid currentColor; border-top-color: transparent;
          animation: regenspin 0.7s linear infinite;
        }
        @keyframes regenspin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .regenspin { animation: none; } }
      `}</style>
    </div>
  );
}
