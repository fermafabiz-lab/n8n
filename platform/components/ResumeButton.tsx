"use client";

import { useState, useTransition } from "react";
import { pauseProduction, resumeProject, type ActionResult } from "@/app/actions";

/**
 * One toggle for the whole factory line:
 *  - work running  → "⏸ Pause" stops the running n8n executions (assets
 *    already produced stay in Airtable/Drive, nothing is lost);
 *  - nothing running → "⟳ Resume" re-enters the pipeline, which skips every
 *    scene that already has its image/clip, so only missing pieces are made.
 */
export default function ResumeButton({
  projectId,
  running,
}: {
  projectId: string;
  running: boolean;
}) {
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const act = () =>
    startTransition(async () =>
      setMsg(await (running ? pauseProduction(projectId) : resumeProject(projectId))),
    );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button className="btn" disabled={pending} onClick={act}>
        {pending
          ? running
            ? "Pausing…"
            : "Resuming…"
          : running
            ? "⏸ Pause production"
            : "⟳ Resume production"}
      </button>
      {msg && (
        <span className={`formmsg ${msg.ok ? "ok" : "err"}`} style={{ margin: 0 }}>
          {msg.message}
        </span>
      )}
    </div>
  );
}
