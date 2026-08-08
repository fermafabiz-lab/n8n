"use client";

import { useState, useTransition } from "react";
import {
  pauseProduction,
  restartScripting,
  resumeProject,
  type ActionResult,
} from "@/app/actions";

/**
 * One toggle for the whole factory line:
 *  - work running  → "⏸ Pause" stops the running n8n executions (assets
 *    already produced stay in Airtable/Drive, nothing is lost);
 *  - nothing running → "⟳ Resume" re-enters the pipeline, which skips every
 *    scene that already has its image/clip, so only missing pieces are made.
 *
 * Before any scene exists the pipeline is still WRITING, and resuming
 * production would enter at media generation and find nothing to do. In that
 * phase the same toggle restarts the writing instead — which is the state
 * that previously had no way out at all: Pause could stop a broken scripting
 * run, and then nothing could start it again.
 */
export default function ResumeButton({
  projectId,
  running,
  phase = "production",
  hasScenes = false,
}: {
  projectId: string;
  running: boolean;
  /** "scripting" until the first scenes are approved; "production" after. */
  phase?: "scripting" | "production";
  /** Scenes already exist — restarting the writing would replace them. */
  hasScenes?: boolean;
}) {
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  const scripting = phase === "scripting";
  // Restarting the writing REPLACES the scenes. Before any are approved that
  // is exactly what a half-finished split needs, but it would also throw away
  // text the producer had already edited — so once scenes exist the button
  // asks once before doing it.
  const needsConfirm = scripting && hasScenes && !running;

  const act = () => {
    if (needsConfirm && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    startTransition(async () =>
      setMsg(
        await (running
          ? pauseProduction(projectId)
          : scripting
            ? restartScripting(projectId)
            : resumeProject(projectId)),
      ),
    );
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button className="btn" disabled={pending} onClick={act}>
        {pending
          ? running
            ? "Pausing…"
            : scripting
              ? "Restarting…"
              : "Resuming…"
          : running
            ? scripting
              ? "⏸ Pause writing"
              : "⏸ Pause production"
            : scripting
              ? armed
                ? "⟳ Replace the scenes — sure?"
                : "⟳ Restart writing"
              : "⟳ Resume production"}
      </button>
      {armed && !msg && (
        <span className="formmsg" style={{ margin: 0 }}>
          This rewrites the script and every scene. Click again to confirm.
        </span>
      )}
      {msg && (
        <span className={`formmsg ${msg.ok ? "ok" : "err"}`} style={{ margin: 0 }}>
          {msg.message}
        </span>
      )}
    </div>
  );
}
