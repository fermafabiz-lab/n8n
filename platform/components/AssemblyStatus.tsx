"use client";

import { useEffect, useState } from "react";
import { retryAssembly, type ActionResult } from "@/app/actions";

/**
 * What the final render is doing, in plain language.
 *
 * The render is the one step with no per-scene feedback — the page would
 * otherwise sit silent for minutes with no way to tell "still stitching" from
 * "died and nobody noticed". So this panel reports three things: that a
 * render is running, how long it has been running, and what to do when it
 * stopped.
 */
const STEPS = [
  "Fetching the approved clips and voiceovers",
  "Stitching the timeline, each shot retimed to its narration",
  "Mixing music and sound effects under the voice",
  "Drawing captions, titles and the end screen",
];

function useElapsed(startedAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return null;
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
}

/** How long a trouble signal must persist before it is believed. */
const GRACE_MS = 75_000;

/**
 * True once the trouble signal has been continuously present for GRACE_MS.
 *
 * There are two normal gaps where nothing is running yet everything is fine:
 * between the batch releasing and the orchestrator starting the render, and
 * between the render finishing and the video URL landing in Airtable.
 * Announcing a failure in those windows cried wolf on every healthy project.
 *
 * The first-seen timestamp lives in sessionStorage because the page
 * auto-refreshes every 10s and remounts this component, which would reset a
 * plain timer forever.
 */
function useSettled(projectId: string, trouble: boolean): boolean {
  const key = `vf-assembly-trouble:${projectId}`;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!trouble) {
      try {
        sessionStorage.removeItem(key);
      } catch {}
      return;
    }
    try {
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, String(Date.now()));
      }
    } catch {}
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [trouble, key]);

  if (!trouble) return false;
  try {
    const since = Number(sessionStorage.getItem(key) ?? Date.now());
    return Date.now() - since >= GRACE_MS;
  } catch {
    return true;
  }
}

const mmss = (s: number) =>
  `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;

export default function AssemblyStatus({
  projectId,
  startedAt,
  failure,
  n8nUrl,
  /** Assembly is the current status but n8n reports nothing running. */
  missing,
}: {
  projectId: string;
  startedAt: string | null;
  failure: { message: string; node: string | null } | null;
  n8nUrl: string | null;
  missing: boolean;
}) {
  const elapsed = useElapsed(startedAt);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);
  const settled = useSettled(projectId, missing || !!failure);

  // A render is minutes, not tens of minutes. Past that something is wrong
  // even though n8n still calls the execution "running".
  const slow = elapsed !== null && elapsed > 15 * 60;
  // Only after the signal has held for the grace period — see useSettled.
  const broken = (!!failure || missing) && settled;
  // Which step it is plausibly on — honest pacing, not a fake progress bar:
  // the render reports no intermediate progress, so this is presented as an
  // estimate, never as measured truth.
  const stepIndex =
    elapsed === null ? 0 : Math.min(STEPS.length - 1, Math.floor(elapsed / 75));

  const retry = async () => {
    setPending(true);
    setMsg(await retryAssembly(projectId));
    setPending(false);
  };

  return (
    <div
      className="script"
      style={{
        marginTop: 24,
        border: `1px solid ${broken ? "rgba(255,107,107,0.4)" : "rgba(245,184,65,0.3)"}`,
      }}
    >
      <div className="sechead">
        <h2>
          <span style={{ marginRight: 8 }}>{broken ? "⚠" : "🎬"}</span>
          {broken ? "The render stopped" : "Assembling your video"}
        </h2>
        <span className={`chip ${broken ? "err" : "run"}`}>
          {broken ? "Needs attention" : elapsed !== null ? mmss(elapsed) : "Running"}
        </span>
      </div>

      {msg && <p className={`formmsg ${msg.ok ? "ok" : "err"}`}>{msg.message}</p>}

      {!broken && (
        <>
          <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--soft)" }}>
            All the clips are approved and the final video is being put
            together. This usually takes a few minutes; it appears at the top
            of this page by itself when it&apos;s done.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {STEPS.map((s, i) => {
              const state = i < stepIndex ? "past" : i === stepIndex ? "now" : "next";
              return (
                <div
                  key={s}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    color:
                      state === "now"
                        ? "var(--ink)"
                        : state === "past"
                          ? "var(--soft)"
                          : "var(--dim)",
                  }}
                >
                  <span style={{ width: 16, flex: "none", textAlign: "center" }}>
                    {state === "past" ? "✓" : state === "now" ? "◆" : "·"}
                  </span>
                  {s}
                </div>
              );
            })}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--dim)" }}>
            The steps above are an estimate from elapsed time — the render
            doesn&apos;t report progress while it works.
          </p>
          {slow && (
            <p className="formmsg" style={{ marginTop: 12 }}>
              This is taking much longer than usual ({mmss(elapsed!)}). It may
              still finish, but if nothing changes in the next few minutes it
              is worth restarting the render below.
            </p>
          )}
        </>
      )}

      {broken && (
        <>
          <p style={{ margin: "0 0 10px", fontSize: 13.5, color: "var(--soft)" }}>
            {failure
              ? "The final render failed. Your scenes, voiceovers and clips are all safe — restarting only redoes the stitching."
              : "The project is marked as assembling, but no render is running in n8n. It was most likely interrupted. Restarting picks up the approved clips; nothing gets regenerated."}
          </p>
          {failure && (
            <div
              className="card"
              style={{ padding: "12px 14px", marginBottom: 12, fontSize: 12.5 }}
            >
              {failure.node && (
                <div style={{ color: "var(--dim)", marginBottom: 4 }}>
                  Failed at: <b style={{ color: "var(--soft)" }}>{failure.node}</b>
                </div>
              )}
              <code style={{ color: "var(--amber)", whiteSpace: "pre-wrap" }}>
                {failure.message.slice(0, 500)}
              </code>
            </div>
          )}
        </>
      )}

      {(broken || slow) && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
          <button className="btn gold" disabled={pending} onClick={retry}>
            {pending ? "…" : "↻ Restart the render"}
          </button>
          {n8nUrl && (
            <a className="btn" href={n8nUrl} target="_blank" rel="noreferrer">
              Open in n8n
            </a>
          )}
        </div>
      )}
    </div>
  );
}
