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
  regenInFlight = 0,
}: {
  projectId: string;
  running: boolean;
  /** "scripting" until the first scenes are approved; "production" after. */
  phase?: "scripting" | "production";
  /** Scenes already exist — restarting the writing would replace them. */
  hasScenes?: boolean;
  /**
   * How many scenes are waiting on a regeneration right now.
   *
   * Pause stops the only thing that can deliver one, and the Veo generation
   * in flight dies with it — see `pauseProduction`. Measured 2026-09-17 on
   * one film: four batches in four hours, each stopped four to seven minutes
   * in, one of them 42 seconds after it had written to the very scene the
   * producer was waiting on. Nothing on screen made that press look
   * expensive, so it stopped being one.
   */
  regenInFlight?: number;
}) {
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  const scripting = phase === "scripting";
  // Restarting the writing REPLACES the scenes. Before any are approved that
  // is exactly what a half-finished split needs, but it would also throw away
  // text the producer had already edited — so once scenes exist the button
  // asks once before doing it.
  const needsConfirmRestart = scripting && hasScenes && !running;
  // Pausing while a regeneration is out is the expensive press, and the one a
  // producer makes by reflex when a badge has looked unchanged for minutes.
  // Two-step rather than refused: a genuinely wedged run still has to be
  // stoppable, and Pause is its only cure.
  const needsConfirmPause = running && regenInFlight > 0;
  const needsConfirm = needsConfirmRestart || needsConfirmPause;

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
          {needsConfirmPause
            ? `${regenInFlight} scene${regenInFlight === 1 ? "" : "s"} ${
                regenInFlight === 1 ? "is" : "are"
              } mid-regeneration. A re-shoot running on its own job survives this — Pause leaves those alone since 2026-09-17 — but anything the batch itself picked up is thrown away, not held. Click again if you mean to.`
            : "This rewrites the script and every scene. Click again to confirm."}
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
