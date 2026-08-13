"use client";

import { useState, useTransition } from "react";
import { restartProduction, resumeProject, type ActionResult } from "@/app/actions";
import type { Scene } from "@/lib/data";
import type { ExecutionSummary } from "@/lib/n8n";
import { explainRefusal } from "@/lib/refusals";

/**
 * What production is actually doing, while it does it.
 *
 * The rest of the page shows approvals and a "Regenerating" flag; this panel
 * answers the questions those leave open: is a batch alive in n8n right now,
 * which scene is it plausibly on, did fal/Flow refuse something, and — for
 * projects bigger than one batch — how much of the tail is still waiting for
 * another run.
 *
 * Two documented traps shape it:
 * - Asset counts here are labeled as *generated*, never as pipeline
 *   progress — the stepper above counts approvals, and must keep doing so.
 * - "waiting" in n8n means alive (polling loops live there); the alive list
 *   arrives already zombie-filtered by getAliveProduction().
 */

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/** Same marker the scene cards use to tell a pipeline rejection apart from
 *  the producer's own feedback riding in the same Observații field. */
const REFUSAL = /REJECTED|AUTO-REWRITE|failed|error/i;

/** Mirror of the n8n batch rule: a scene stops eating a batch slot once its
 *  clip exists (or was approved). Checkboxes/assets, not the status text —
 *  the text lags. */
const isPending = (s: Scene) => !s.videoUrl && !s.videoApproved;

export default function ProductionActivity({
  projectId,
  /** Zombie-filtered alive executions; null = the n8n API didn't answer. */
  alive,
  scenes,
  cap,
}: {
  projectId: string;
  alive: ExecutionSummary[] | null;
  scenes: Scene[];
  cap: number;
}) {
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const unfinished = scenes.filter(isPending);
  // The batch n8n would (or did) pick: pending scenes first, in order —
  // the same sort "Sort & Cap Scenes" applies before slicing to the cap.
  const batch = [...scenes]
    .sort((a, b) =>
      isPending(a) === isPending(b) ? a.order - b.order : isPending(a) ? -1 : 1,
    )
    .slice(0, cap);

  // Where inside the batch the work plausibly is. Assets land one scene at
  // a time and in order, so the first scene missing the current stage's
  // asset is the one being worked on — presented as such, not as a fact.
  const noImage = batch.filter((s) => !s.imageUrl);
  const unappImage = batch.filter((s) => !s.imageApproved);
  const noVoice = batch.filter((s) => !s.voiceUrl);
  const unappVoice = batch.filter((s) => !s.voiceApproved);
  const noClip = batch.filter((s) => !s.videoUrl);
  const unappClip = batch.filter((s) => !s.videoApproved);
  // `text` describes a batch that is RUNNING; `idle` the same stage when
  // nothing is. Without the pair the panel said "No batch is running in n8n
  // right now." and "Generating images · 1/8" one line apart — two
  // statements that cannot both be true, on the screen a producer checks
  // precisely to find out whether anything is happening.
  const phase =
    noImage.length > 0
      ? { text: "Generating images", idle: "Next pass starts with images", done: batch.length - noImage.length, current: noImage[0].label, review: false }
      : unappImage.length > 0
        ? { text: "Images ready — reviewing", idle: "Images ready — reviewing", done: batch.length - unappImage.length, current: null, review: true }
        : noVoice.length > 0
          ? { text: "Synthesizing voiceovers", idle: "Next pass starts with the voiceovers", done: batch.length - noVoice.length, current: noVoice[0].label, review: false }
          : unappVoice.length > 0
            ? { text: "Voices ready — reviewing", idle: "Voices ready — reviewing", done: batch.length - unappVoice.length, current: null, review: true }
            : noClip.length > 0
              ? { text: "Generating video clips", idle: "Next pass starts with the clips", done: batch.length - noClip.length, current: noClip[0].label, review: false }
              : unappClip.length > 0
                ? { text: "Clips ready — reviewing", idle: "Clips ready — reviewing", done: batch.length - unappClip.length, current: null, review: true }
                : null;

  // Regenerations in flight, across the whole project (regens ride their own
  // webhooks, so they can run outside the batch).
  const regens = scenes.flatMap((s) => [
    ...(s.regenImage ? [`${s.label} image`] : []),
    ...(s.regenVoice ? [`${s.label} voice`] : []),
    ...(s.regenVideo ? [`${s.label} clip`] : []),
  ]);

  // Content refusals the pipeline wrote back — surfaced here in aggregate so
  // a refused scene is visible without clicking through every card.
  // An AUTO-REWRITE note is a RECORD of something the pipeline already fixed,
  // not a live failure: it rewrote the prompt and regenerated. Once the asset
  // it names has landed, the note is history — and leaving it here put a red
  // panel reading "the video filter refused this scene" above a scene that
  // has its clip, which reads as production being broken when it is not.
  // Scoped to auto-rewrites on purpose: a refusal the pipeline did NOT handle
  // must keep shouting even if some other asset on the scene exists.
  const settled = (s: Scene) =>
    /AUTO-REWRITE-VIDEO/i.test(s.note ?? "")
      ? Boolean(s.videoUrl)
      : /AUTO-REWRITE/i.test(s.note ?? "")
        ? Boolean(s.imageUrl)
        : false;

  const refusals = scenes.filter(
    (s) => !s.videoApproved && s.note && REFUSAL.test(s.note) && !settled(s),
  );

  const aliveKnown = alive !== null;
  const aliveAny = (alive?.length ?? 0) > 0;

  /**
   * How long the oldest live execution has been claiming to work.
   *
   * n8n sometimes creates an execution and never runs a node of it: it reads
   * `running` forever with an empty node stack, and its parent orchestrator
   * stays wedged waiting for a child that will never report. From the API
   * that is INDISTINGUISHABLE from a healthy batch — n8n persists no progress
   * mid-run — so the site must not decide it on its own; deciding it on its
   * own is what once had the page killing its own healthy renders. What it
   * can do is stop hiding the door: past a threshold no honest batch needs,
   * offer the restart and let the producer judge.
   */
  const oldestAliveMin = aliveAny
    ? Math.max(
        ...alive!.map((r) =>
          r.startedAt
            ? Math.floor((Date.now() - new Date(r.startedAt).getTime()) / 60000)
            : 0,
        ),
      )
    : 0;
  const FROZEN_MIN = 12;
  const looksFrozen = aliveAny && oldestAliveMin >= FROZEN_MIN;
  const runsAfterThis = Math.max(0, Math.ceil(unfinished.length / cap) - 1);
  const showCapNote = scenes.length > cap && unfinished.length > 0;
  const showNextBatch = aliveKnown && !aliveAny && unfinished.length > 0;

  const nothingToSay =
    !phase && !aliveAny && regens.length === 0 && refusals.length === 0 && unfinished.length === 0;
  if (nothingToSay) return null;

  const startNext = () =>
    startTransition(async () => setMsg(await resumeProject(projectId)));
  const restart = () =>
    startTransition(async () => setMsg(await restartProduction(projectId)));

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h5>Production activity</h5>

      {aliveKnown && (
        aliveAny ? (
          alive!.map((r) => (
            <div className="kv" key={r.id}>
              <span>
                <b style={{ color: "var(--ink)" }}>{r.workflowName}</b>
                {r.startedAt && <> · started {ago(r.startedAt)}</>}
              </span>
              <span className="chip run">
                {r.status === "waiting" ? "working (in a wait step)" : "running"}
              </span>
            </div>
          ))
        ) : (
          <div className="kv">
            <span>No batch is running in n8n right now.</span>
          </div>
        )
      )}

      {phase && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--soft)" }}>
          {(aliveAny ? phase.text : (phase.idle ?? phase.text))} ·{" "}
          {phase.done}/{batch.length}
          {phase.current && aliveAny && (
            <>
              {" "}— likely on <b style={{ color: "var(--ink)" }}>{phase.current}</b>
              <span style={{ color: "var(--dim)" }}>
                {" "}(estimated from what has landed; the batch doesn&apos;t
                report scene-by-scene)
              </span>
            </>
          )}
        </p>
      )}

      {regens.length > 0 && (
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--soft)" }}>
          Regenerating: {regens.join(", ")}
        </p>
      )}

      {refusals.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {refusals.map((s) => {
            const why = explainRefusal(s.note!);
            return (
              <div key={s.id} className="formmsg err" style={{ margin: "6px 0 0" }}>
                <b>{s.label}</b> —{" "}
                {s.note!.length > 160 ? s.note!.slice(0, 160).trimEnd() + "…" : s.note}
                {why && (
                  // The raw code says what failed; this says what to DO.
                  <span style={{ display: "block", marginTop: 5, color: "var(--soft)", fontSize: 12 }}>
                    {why.cause}. {why.advice}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCapNote && (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--soft)" }}>
          {aliveAny ? (
            <>
              This pass covers{" "}
              <b style={{ color: "var(--ink)" }}>
                {Math.min(cap, unfinished.length)} of {unfinished.length}
              </b>{" "}
              unfinished scenes — a pass takes at most {cap} at a time
              {runsAfterThis > 0
                ? `, so it runs ${runsAfterThis} more pass${runsAfterThis > 1 ? "es" : ""} after this one. That happens on its own; nothing to press.`
                : "."}
            </>
          ) : (
            <>
              <b style={{ color: "var(--ink)" }}>{unfinished.length}</b> scene
              {unfinished.length > 1 ? "s" : ""} still unfinished, and nothing
              is running — start the next pass below. It works {cap} scenes at
              a time and continues by itself from there.
            </>
          )}
        </p>
      )}

      {showNextBatch && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
          <button className="btn gold" disabled={pending} onClick={startNext}>
            {pending ? "Starting…" : "▶ Generate the remaining scenes"}
          </button>
          <span style={{ fontSize: 12, color: "var(--dim)" }}>
            Picks up only the unfinished scenes — nothing already made is
            regenerated — and keeps going until every scene has a clip.
          </span>
        </div>
      )}

      {looksFrozen && (
        // The one exit from "n8n says it is working and nothing is moving".
        // Deliberately manual and deliberately explicit about the cost: the
        // site cannot tell a wedged execution from a slow one, but the
        // producer can — they are looking at whether anything appeared.
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--soft)" }}>
            This pass has been running for {oldestAliveMin} minutes.{" "}
            <b style={{ color: "var(--ink)" }}>
              If nothing new has appeared in that time, it is wedged
            </b>{" "}
            — n8n does sometimes open an execution and never actually run it,
            and from the outside that looks exactly like work in progress.
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn" disabled={pending} onClick={restart}>
              {pending ? "Restarting…" : "⟳ Restart this pass"}
            </button>
            <span style={{ fontSize: 12, color: "var(--dim)" }}>
              Stops what n8n thinks is running and starts the pass again.
              Every image, take and clip already made is kept — only the
              missing pieces are generated.
            </span>
          </div>
        </div>
      )}

      {msg && (
        <p className={`formmsg ${msg.ok ? "ok" : "err"}`} style={{ marginTop: 10 }}>
          {msg.message}
        </p>
      )}
    </div>
  );
}
